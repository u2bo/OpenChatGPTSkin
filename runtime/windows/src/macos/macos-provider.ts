import { posix } from "node:path";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import { RuntimeError } from "../errors.js";
import type {
  DesktopRuntimeProvider,
  InstallInspection,
  ManagedWindowInspection,
  PortInspection,
  ProcessIdentity,
} from "../types.js";
import {
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
  nodeCommandRunner,
} from "../windows/command-runner.js";
import {
  MACOS_CODEX_BUNDLE_ID,
  MACOS_CODEX_ENTRY_POINT,
  MACOS_CODEX_IDENTITY_NAME,
  MACOS_CODEX_NOTARIZATION_AUTHORITY,
  MACOS_CODEX_RESOURCE_SIGNER,
  MACOS_CODEX_TEAM_ID,
  macOsEntryRelativePath,
} from "./identity.js";

const COMMAND_TIMEOUT_MS = 10_000;
const PROCESS_POLL_INTERVAL_MS = 100;
const PROCESS_LAUNCH_TIMEOUT_MS = 10_000;
const MACOS_SYSTEM_APPLICATION = "/Applications/Codex.app";

export interface MacOsRuntimeProviderOptions {
  readonly runner?: CommandRunner;
  readonly dataRoot?: string;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly currentUid?: number;
  readonly inspectBundlePath?: (path: string) => Promise<{
    readonly isDirectory: () => boolean;
    readonly isSymbolicLink: () => boolean;
  }>;
}

interface ProcessRow extends ProcessIdentity {
  readonly command: string;
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

function runtimeEnvironmentError(message: string): RuntimeError {
  return new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", message);
}

function inspectionError(message: string): RuntimeError {
  return new RuntimeError("PROCESS_INSPECTION_DENIED", message);
}

function validatePid(pid: number): void {
  if (!Number.isInteger(pid) || pid < 1) {
    throw runtimeEnvironmentError("Process ID must be a positive integer");
  }
}

function validateStartedAt(startedAt: string): void {
  if (!startedAt.endsWith("Z") || !Number.isFinite(Date.parse(startedAt))) {
    throw runtimeEnvironmentError("Process start time is invalid");
  }
}

function normalizePackageVersion(value: string): string {
  const parts = value.trim().split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new RuntimeError("CODEX_IDENTITY_INVALID", "Codex bundle version is invalid");
  }
  return [...parts, ...Array<string>(4 - parts.length).fill("0")].join(".");
}

function parseProcessRows(value: string): readonly ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([\s\S]+)$/.exec(line);
    if (!match) throw inspectionError("macOS process inspection returned an invalid row");
    const startedAtValue = Date.parse(match[3]!);
    if (!Number.isFinite(startedAtValue)) {
      throw inspectionError("macOS process start time is invalid");
    }
    const startedAt = new Date(startedAtValue).toISOString();
    rows.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      startedAt,
      executablePath: match[4]!.trim(),
      command: match[4]!.trim(),
    });
  }
  return rows;
}

function parseLsof(value: string, port: number): {
  readonly owningPid: number;
  readonly host: string;
} | null {
  const listeners: Array<{ owningPid: number; host: string }> = [];
  let pid: number | null = null;
  for (const line of value.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      const candidate = Number(line.slice(1));
      pid = Number.isInteger(candidate) && candidate > 0 ? candidate : null;
      continue;
    }
    if (!line.startsWith("n") || pid === null) continue;
    const endpoint = line.slice(1);
    const suffix = `:${port}`;
    if (!endpoint.endsWith(suffix)) continue;
    listeners.push({ owningPid: pid, host: endpoint.slice(0, -suffix.length) });
  }
  if (listeners.length === 0) return null;
  if (listeners.length !== 1) throw inspectionError("CDP port has multiple listening owners");
  return listeners[0]!;
}

function commandHasFlag(command: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:=|\\s|$)`).test(command);
}

function descendantPids(rows: readonly ProcessRow[], rootPid: number): ReadonlySet<number> {
  const result = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!result.has(row.pid) && result.has(row.parentPid)) {
        result.add(row.pid);
        changed = true;
      }
    }
  }
  return result;
}

function ancestorPids(rows: readonly ProcessRow[], pid: number): readonly number[] {
  const byPid = new Map(rows.map((row) => [row.pid, row] as const));
  const result: number[] = [];
  const seen = new Set<number>();
  let current: number | undefined = pid;
  while (current && !seen.has(current)) {
    seen.add(current);
    result.push(current);
    current = byPid.get(current)?.parentPid;
  }
  return result;
}

function bundleRootFromExecutable(executablePath: string): string {
  const normalized = executablePath.replaceAll("\\", "/");
  const match = /^(.*\/Codex\.app)\/Contents\/MacOS\/[^/]+$/.exec(normalized);
  if (!match) {
    throw new RuntimeError("CODEX_IDENTITY_INVALID", "Codex executable is outside Codex.app");
  }
  return match[1]!;
}

function parseSigningIdentity(output: string): {
  readonly teamId: string;
  readonly signer: string;
} {
  const teamId = /^TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim();
  const signer = /^Authority=Developer ID Application:\s*(.+?)\s*\([A-Z0-9]+\)$/m.exec(output)?.[1]?.trim();
  if (!teamId || !signer) {
    throw new RuntimeError("CODEX_IDENTITY_INVALID", "Codex code-signing identity is unavailable");
  }
  return { teamId, signer };
}

export class MacOsRuntimeProvider implements DesktopRuntimeProvider {
  readonly platform = "darwin" as const;
  private readonly runner: CommandRunner;
  private readonly dataRoot: string | undefined;
  private readonly homeDirectory: string;
  private readonly uid: number;
  private readonly inspectBundlePath: NonNullable<MacOsRuntimeProviderOptions["inspectBundlePath"]>;

  constructor(options: MacOsRuntimeProviderOptions = {}) {
    const platform = options.platform ?? process.platform;
    if (platform !== "darwin") {
      throw runtimeEnvironmentError("MacOsRuntimeProvider requires macOS");
    }
    const uid = options.currentUid ?? process.getuid?.();
    if (typeof uid !== "number" || !Number.isInteger(uid) || uid < 0) {
      throw runtimeEnvironmentError("macOS user ID is unavailable");
    }
    this.runner = options.runner ?? nodeCommandRunner;
    this.dataRoot = options.dataRoot;
    this.homeDirectory = options.homeDirectory ?? homedir();
    this.uid = uid;
    this.inspectBundlePath = options.inspectBundlePath ?? lstat;
  }

  private async run(
    executable: string,
    args: readonly string[],
    options: { readonly allowNonZero?: boolean; readonly env?: Readonly<Record<string, string>> } = {},
  ): Promise<CommandResult> {
    let result: CommandResult;
    try {
      const request: CommandRequest = {
        executable,
        args,
        stdin: "",
        timeoutMs: COMMAND_TIMEOUT_MS,
        shell: false,
        ...(options.env ? { env: options.env } : {}),
      };
      result = await this.runner.run(request);
    } catch (error) {
      throw inspectionError(error instanceof Error ? error.message : String(error));
    }
    if (result.exitCode !== 0 && !options.allowNonZero) {
      throw inspectionError(result.stderr.trim() || `${executable} exited ${result.exitCode}`);
    }
    return result;
  }

  private async processRows(commandColumn: "comm" | "command" = "comm"): Promise<readonly ProcessRow[]> {
    const result = await this.run(
      "/bin/ps",
      ["-ww", "-axo", `pid=,ppid=,lstart=,${commandColumn}=`],
      { env: { LC_ALL: "C" } },
    );
    return parseProcessRows(result.stdout);
  }

  async currentUserPackageRoots(): Promise<readonly string[]> {
    const candidates = [
      MACOS_SYSTEM_APPLICATION,
      posix.resolve(this.homeDirectory, "Applications", "Codex.app"),
    ];
    const roots: string[] = [];
    for (const candidate of candidates) {
      try {
        const info = await this.inspectBundlePath(candidate);
        if (info.isDirectory() && !info.isSymbolicLink()) roots.push(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw inspectionError(error instanceof Error ? error.message : String(error));
        }
      }
    }
    return [...new Set(roots)];
  }

  async listCodexRoots(): Promise<readonly ProcessIdentity[]> {
    const roots = await this.currentUserPackageRoots();
    const executablePaths = new Set<string>();
    for (const root of roots) {
      const executable = (await this.readPlistValue(root, "CFBundleExecutable")).trim();
      if (executable) executablePaths.add(posix.resolve(root, macOsEntryRelativePath(executable)));
    }
    if (executablePaths.size === 0) return [];
    const identities: ProcessIdentity[] = [];
    for (const row of await this.processRows("command")) {
      const entryPath = [...executablePaths].find((candidate) =>
        row.command === candidate || row.command.startsWith(`${candidate} `)
      );
      if (!entryPath) continue;
      identities.push({
        pid: row.pid,
        parentPid: row.parentPid,
        startedAt: row.startedAt,
        executablePath: entryPath,
      });
    }
    return identities;
  }

  private async readPlistValue(bundleRoot: string, key: string): Promise<string> {
    const plist = posix.resolve(bundleRoot, "Contents", "Info.plist");
    const result = await this.run(
      "/usr/bin/plutil",
      ["-extract", key, "raw", "-o", "-", plist],
      { allowNonZero: true },
    );
    const value = result.stdout.trim();
    if (result.exitCode !== 0 || !value) {
      throw new RuntimeError("CODEX_IDENTITY_INVALID", `Codex ${key} is unavailable`);
    }
    return value;
  }

  async inspectInstall(packageRoot: string): Promise<InstallInspection> {
    const root = posix.resolve(packageRoot);
    let rootInfo: Awaited<ReturnType<NonNullable<MacOsRuntimeProviderOptions["inspectBundlePath"]>>>;
    try {
      rootInfo = await this.inspectBundlePath(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new RuntimeError("CODEX_NOT_INSTALLED", "Codex.app was not found");
      }
      throw inspectionError(error instanceof Error ? error.message : String(error));
    }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new RuntimeError("CODEX_IDENTITY_INVALID", "Codex.app must be a regular app bundle");
    }
    const [bundleId, executableName, rawVersion, verify, display, assessment] = await Promise.all([
      this.readPlistValue(root, "CFBundleIdentifier"),
      this.readPlistValue(root, "CFBundleExecutable"),
      this.readPlistValue(root, "CFBundleVersion"),
      this.run("/usr/bin/codesign", ["--verify", "--deep", "--strict", root], { allowNonZero: true }),
      this.run("/usr/bin/codesign", ["-dv", "--verbose=4", root], { allowNonZero: true }),
      this.run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", root], { allowNonZero: true }),
    ]);
    if (verify.exitCode !== 0 || display.exitCode !== 0 || assessment.exitCode !== 0 ||
      bundleId !== MACOS_CODEX_BUNDLE_ID) {
      throw new RuntimeError("CODEX_IDENTITY_INVALID", "Codex bundle identity or signature is invalid");
    }
    const signing = parseSigningIdentity(`${display.stdout}\n${display.stderr}`);
    const assessmentText = `${assessment.stdout}\n${assessment.stderr}`;
    if (signing.teamId !== MACOS_CODEX_TEAM_ID ||
      signing.signer !== MACOS_CODEX_RESOURCE_SIGNER ||
      !assessmentText.includes(`source=${MACOS_CODEX_NOTARIZATION_AUTHORITY}`)) {
      throw new RuntimeError("CODEX_IDENTITY_INVALID", "Codex signer or notarization is invalid");
    }
    const entryRelativePath = macOsEntryRelativePath(executableName);
    return {
      packageRoot: root,
      entryPath: posix.resolve(root, entryRelativePath),
      identityName: MACOS_CODEX_IDENTITY_NAME,
      packageVersion: normalizePackageVersion(rawVersion),
      packagePublisher: MACOS_CODEX_TEAM_ID,
      appId: MACOS_CODEX_BUNDLE_ID,
      entryRelativePath,
      entryPoint: MACOS_CODEX_ENTRY_POINT,
      packageSignatureStatus: "Valid",
      packageSignerCommonName: MACOS_CODEX_TEAM_ID,
      catalogSignatureStatus: "Valid",
      catalogSignerCommonName: MACOS_CODEX_NOTARIZATION_AUTHORITY,
      entryBlockMapValid: true,
      resourceSignatureStatus: "Valid",
      resourceSignerCommonName: MACOS_CODEX_RESOURCE_SIGNER,
    };
  }

  async inspectPort(port: number): Promise<PortInspection | null> {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw runtimeEnvironmentError("Port must be between 1 and 65535");
    }
    const result = await this.run(
      "/usr/sbin/lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"],
      { allowNonZero: true },
    );
    if (result.exitCode !== 0 && !result.stdout.trim()) return null;
    const listener = parseLsof(result.stdout, port);
    if (!listener) return null;
    if (listener.host !== "127.0.0.1") {
      throw new RuntimeError("CDP_ENDPOINT_UNSAFE", "CDP listener is not bound to IPv4 loopback");
    }
    const rows = await this.processRows("comm");
    return {
      host: listener.host,
      port,
      owningPid: listener.owningPid,
      ancestors: ancestorPids(rows, listener.owningPid),
    };
  }

  async inspectProcessStartedAt(pid: number): Promise<string | null> {
    validatePid(pid);
    return (await this.processRows("comm")).find((row) => row.pid === pid)?.startedAt ?? null;
  }

  async inspectRemoteDebuggingArguments(
    rootPid: number,
    startedAt: string,
  ): Promise<{ readonly hasRemoteDebuggingAddress: boolean; readonly hasRemoteDebuggingPort: boolean }> {
    validatePid(rootPid);
    validateStartedAt(startedAt);
    const rows = await this.processRows("command");
    const root = rows.find((row) => row.pid === rootPid && row.startedAt === startedAt);
    if (!root) throw inspectionError("Managed Codex process identity changed");
    const descendants = descendantPids(rows, rootPid);
    const commands = rows.filter((row) => descendants.has(row.pid)).map((row) => row.command);
    return {
      hasRemoteDebuggingAddress: commands.some((command) => commandHasFlag(command, "--remote-debugging-address")),
      hasRemoteDebuggingPort: commands.some((command) => commandHasFlag(command, "--remote-debugging-port")),
    };
  }

  async measureProcessCpuPercent(
    rootPid: number,
    startedAt: string,
    sampleMs: number,
  ): Promise<number> {
    validatePid(rootPid);
    validateStartedAt(startedAt);
    if (!Number.isInteger(sampleMs) || sampleMs < 1_000 || sampleMs > 5_000) {
      throw runtimeEnvironmentError("CPU sample duration must be between one and five seconds");
    }
    if (await this.inspectProcessStartedAt(rootPid) !== startedAt) {
      throw inspectionError("Managed Codex process identity changed");
    }
    await delay(sampleMs);
    const result = await this.run(
      "/bin/ps",
      ["-p", String(rootPid), "-o", "%cpu="],
      { env: { LC_ALL: "C" } },
    );
    if (await this.inspectProcessStartedAt(rootPid) !== startedAt) {
      throw inspectionError("Managed Codex process identity changed");
    }
    const value = Number(result.stdout.trim());
    if (!Number.isFinite(value) || value < 0) throw inspectionError("CPU inspection was invalid");
    return value;
  }

  async activateCodexApplication(): Promise<void> {
    const result = await this.run(
      "/usr/bin/open",
      ["-b", MACOS_CODEX_BUNDLE_ID],
      { allowNonZero: true },
    );
    if (result.exitCode !== 0) {
      throw new RuntimeError(
        "CODEX_WINDOW_ACTIVATION_FAILED",
        result.stderr.trim() || "Codex bundle activation failed",
        "Open Codex once from Applications, quit it normally, then retry.",
      );
    }
  }

  async inspectManagedWindows(
    rootPid: number,
    startedAt: string,
  ): Promise<ManagedWindowInspection> {
    const rootExists = await this.inspectProcessStartedAt(rootPid) === startedAt;
    // macOS window enumeration requires Accessibility consent. The controller already
    // verifies activation plus the owned CDP process tree, so avoid broad OS permission.
    return {
      rootExists,
      visibleWindowCount: 0,
      activationReady: rootExists,
    };
  }

  async launch(executablePath: string, args: readonly string[]): Promise<ProcessIdentity> {
    const bundleRoot = bundleRootFromExecutable(posix.resolve(executablePath));
    const requestedAt = Date.now();
    const result = await this.run(
      "/usr/bin/open",
      ["-n", bundleRoot, "--args", ...args],
      { allowNonZero: true },
    );
    if (result.exitCode !== 0) {
      throw new RuntimeError(
        "CODEX_LAUNCH_FAILED",
        result.stderr.trim() || "macOS failed to launch Codex",
      );
    }
    const deadline = Date.now() + PROCESS_LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const candidates = (await this.listCodexRoots()).filter((root) =>
        posix.resolve(root.executablePath) === posix.resolve(executablePath) &&
        Date.parse(root.startedAt) >= requestedAt - 1_000
      );
      if (candidates.length === 1) return candidates[0]!;
      if (candidates.length > 1) {
        throw new RuntimeError("CODEX_LAUNCH_FAILED", "multiple new Codex root processes appeared");
      }
      await delay(PROCESS_POLL_INTERVAL_MS);
    }
    throw new RuntimeError("CODEX_LAUNCH_FAILED", "Codex root process did not appear");
  }

  async waitForExit(rootPid: number, startedAt: string, timeoutMs: number): Promise<boolean> {
    validatePid(rootPid);
    validateStartedAt(startedAt);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.inspectProcessStartedAt(rootPid) !== startedAt) return true;
      await delay(PROCESS_POLL_INTERVAL_MS);
    }
    return false;
  }

  async currentUserSid(): Promise<string> {
    return `uid:${this.uid}`;
  }

  async secureDirectory(path: string): Promise<void> {
    if (!this.dataRoot) {
      throw runtimeEnvironmentError("MacOsRuntimeProvider requires a configured data root");
    }
    const root = posix.resolve(this.dataRoot);
    const target = posix.resolve(path);
    const child = posix.relative(root, target);
    if (child.startsWith("../") || child === ".." || posix.isAbsolute(child) || child.includes("/")) {
      throw runtimeEnvironmentError("Runtime directories must be the data root or one direct child");
    }
    const rejectUnsafeExistingDirectory = async (candidate: string): Promise<void> => {
      try {
        const info = await lstat(candidate);
        if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== this.uid) {
          throw runtimeEnvironmentError("macOS Runtime directory ownership is invalid");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    };
    await rejectUnsafeExistingDirectory(root);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await rejectUnsafeExistingDirectory(target);
    await mkdir(target, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    await chmod(target, 0o700);
    const [rootInfo, targetInfo, canonicalRoot, canonicalTarget] = await Promise.all([
      lstat(root),
      lstat(target),
      realpath(root),
      realpath(target),
    ]);
    const canonicalChild = posix.relative(canonicalRoot, canonicalTarget);
    const rootMode = rootInfo.mode & 0o777;
    const targetMode = targetInfo.mode & 0o777;
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.uid !== this.uid ||
      !targetInfo.isDirectory() || targetInfo.isSymbolicLink() || targetInfo.uid !== this.uid ||
      rootMode !== 0o700 || targetMode !== 0o700 || canonicalChild.startsWith("../") ||
      canonicalChild === ".." || posix.isAbsolute(canonicalChild)) {
      throw runtimeEnvironmentError("macOS Runtime directory ownership or permissions are invalid");
    }
  }
}
