import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { RuntimeError } from "../errors.js";
import type {
  InstallInspection,
  ManagedWindowInspection,
  PortInspection,
  ProcessIdentity,
  WindowsRuntimeProvider,
} from "../types.js";
import {
  type CommandRunner,
  nodeCommandRunner,
} from "./command-runner.js";
import { POWERSHELL_SCRIPT } from "./powershell-script.js";
import { WINDOWS_POWERSHELL } from "./powershell-path.js";

const POWERSHELL_REQUEST_ENV = "OPEN_CHATGPT_SKIN_REQUEST_JSON";
const POWERSHELL_STDIN_COMMAND =
  "& ([scriptblock]::Create([Console]::In.ReadToEnd()))";

function arrayOf<T>(value: T | readonly T[] | null): readonly T[] {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value as T];
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

function assertProcessIdentity(rootPid: number, startedAt: string): void {
  if (!Number.isInteger(rootPid) || rootPid < 1) {
    throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Process ID must be a positive integer");
  }
  if (!startedAt.endsWith("Z") || !Number.isFinite(Date.parse(startedAt))) {
    throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Process start time is invalid");
  }
}

function remoteDebuggingArguments(value: unknown): {
  readonly hasRemoteDebuggingAddress: boolean;
  readonly hasRemoteDebuggingPort: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("PROCESS_INSPECTION_DENIED", "Debug argument inspection was invalid");
  }
  const result = value as Readonly<Record<string, unknown>>;
  if (Object.keys(result).length !== 2 ||
    typeof result.hasRemoteDebuggingAddress !== "boolean" ||
    typeof result.hasRemoteDebuggingPort !== "boolean") {
    throw new RuntimeError("PROCESS_INSPECTION_DENIED", "Debug argument inspection was invalid");
  }
  return {
    hasRemoteDebuggingAddress: result.hasRemoteDebuggingAddress,
    hasRemoteDebuggingPort: result.hasRemoteDebuggingPort,
  };
}

export function windowsPathsEqual(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("/", "\\").toLowerCase();
  return normalize(left) === normalize(right);
}

export class PowerShellWindowsProvider implements WindowsRuntimeProvider {
  readonly platform = "win32" as const;
  constructor(
    private readonly runner: CommandRunner = nodeCommandRunner,
    private readonly dataRoot?: string,
  ) {}

  private async invoke<T>(request: Readonly<Record<string, unknown>>): Promise<T> {
    let result;
    try {
      const requestJson = JSON.stringify(request);
      result = await this.runner.run({
        executable: WINDOWS_POWERSHELL,
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          POWERSHELL_STDIN_COMMAND,
        ],
        shell: false,
        stdin: POWERSHELL_SCRIPT,
        env: { [POWERSHELL_REQUEST_ENV]: requestJson },
        timeoutMs: 10_000,
      });
    } catch (error) {
      throw new RuntimeError(
        "PROCESS_INSPECTION_DENIED",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (result.exitCode !== 0) {
      throw new RuntimeError(
        "PROCESS_INSPECTION_DENIED",
        result.stderr.trim() || `PowerShell inspection exited ${result.exitCode}`,
      );
    }
    const text = result.stdout.trim();
    return (text ? JSON.parse(text) : null) as T;
  }

  async listCodexRoots(): Promise<readonly ProcessIdentity[]> {
    return arrayOf(await this.invoke<ProcessIdentity | readonly ProcessIdentity[] | null>({
      action: "listCodexRoots",
    }));
  }

  async currentUserPackageRoots(): Promise<readonly string[]> {
    return arrayOf(await this.invoke<string | readonly string[] | null>({
      action: "currentUserPackageRoots",
    }));
  }

  inspectInstall(packageRoot: string): Promise<InstallInspection> {
    return this.invoke<InstallInspection>({ action: "inspectInstall", packageRoot });
  }

  inspectPort(port: number): Promise<PortInspection | null> {
    return this.invoke<PortInspection | null>({ action: "inspectPort", port });
  }

  async inspectProcessStartedAt(pid: number): Promise<string | null> {
    if (!Number.isInteger(pid) || pid < 1) {
      throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Process ID must be a positive integer");
    }
    const startedAt = await this.invoke<unknown>({ action: "inspectProcessStartedAt", pid });
    if (startedAt === null) return null;
    if (typeof startedAt !== "string" || !startedAt.endsWith("Z") ||
      !Number.isFinite(Date.parse(startedAt))) {
      throw new RuntimeError("PROCESS_INSPECTION_DENIED", "Process start time inspection was invalid");
    }
    return startedAt;
  }

  async inspectRemoteDebuggingArguments(
    rootPid: number,
    startedAt: string,
  ): Promise<{
    readonly hasRemoteDebuggingAddress: boolean;
    readonly hasRemoteDebuggingPort: boolean;
  }> {
    assertProcessIdentity(rootPid, startedAt);
    return remoteDebuggingArguments(await this.invoke<unknown>({
      action: "inspectRemoteDebuggingArguments",
      rootPid,
      startedAt,
    }));
  }

  async measureProcessCpuPercent(
    rootPid: number,
    startedAt: string,
    sampleMs: number,
  ): Promise<number> {
    assertProcessIdentity(rootPid, startedAt);
    if (!Number.isInteger(sampleMs) || sampleMs < 1_000 || sampleMs > 5_000) {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "CPU sample duration must be between one and five seconds",
      );
    }
    const value = await this.invoke<unknown>({
      action: "measureProcessCpuPercent",
      rootPid,
      startedAt,
      sampleMs,
    });
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RuntimeError("PROCESS_INSPECTION_DENIED", "CPU inspection was invalid");
    }
    return value;
  }

  async activateCodexApplication(): Promise<void> {
    let result: { readonly activated: true };
    try {
      result = await this.invoke<{ readonly activated: true }>({
        action: "activateCodexApplication",
      });
    } catch (error) {
      throw new RuntimeError(
        "CODEX_WINDOW_ACTIVATION_FAILED",
        error instanceof Error ? error.message : String(error),
        "Start Codex from the Windows Start menu, then Quit from the Codex menu.",
      );
    }
    if (result.activated !== true) {
      throw new RuntimeError(
        "CODEX_WINDOW_ACTIVATION_FAILED",
        "Codex AUMID activation did not report success",
        "Start Codex from the Windows Start menu, then Quit from the Codex menu.",
      );
    }
  }

  async inspectManagedWindows(
    rootPid: number,
    startedAt: string,
  ): Promise<ManagedWindowInspection> {
    const value = await this.invoke<Pick<ManagedWindowInspection, "rootExists" | "visibleWindowCount">>({
      action: "inspectManagedWindows",
      rootPid,
      startedAt,
    });
    if (typeof value.rootExists !== "boolean" || !Number.isInteger(value.visibleWindowCount) ||
      value.visibleWindowCount < 0) {
      throw new RuntimeError("PROCESS_INSPECTION_DENIED", "Window inspection was invalid");
    }
    return {
      ...value,
      activationReady: value.rootExists && value.visibleWindowCount > 0,
    };
  }

  currentUserSid(): Promise<string> {
    return this.invoke<string>({ action: "currentUserSid" });
  }

  async secureDirectory(path: string): Promise<void> {
    if (!this.dataRoot) {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "PowerShellWindowsProvider requires a configured data root",
      );
    }
    const root = resolve(this.dataRoot);
    const target = resolve(path);
    const child = relative(root, target);
    if (child.startsWith("..") || isAbsolute(child)) {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "refusing to secure a directory outside the Runtime data root",
      );
    }
    await mkdir(target, { recursive: true });
    await this.invoke<{ readonly secured: true }>({ action: "secureDirectory", path: target });
  }

  async launch(executablePath: string, args: readonly string[]): Promise<ProcessIdentity> {
    const requestedAt = Date.now();
    await new Promise<void>((resolveLaunch, reject) => {
      const child = spawn(executablePath, [...args], {
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolveLaunch();
      });
    }).catch((error: unknown) => {
      throw new RuntimeError(
        "CODEX_LAUNCH_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const candidates = (await this.listCodexRoots()).filter((processInfo) =>
        windowsPathsEqual(processInfo.executablePath, executablePath) &&
        Date.parse(processInfo.startedAt) >= requestedAt - 1_000
      );
      if (candidates.length === 1) return candidates[0]!;
      if (candidates.length > 1) {
        throw new RuntimeError("CODEX_LAUNCH_FAILED", "multiple new Codex root processes appeared");
      }
      await wait(100);
    }
    throw new RuntimeError("CODEX_LAUNCH_FAILED", "Codex root process did not appear");
  }

  async waitForExit(rootPid: number, startedAt: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.invoke<{ readonly exists: boolean }>({
        action: "processExists",
        pid: rootPid,
        startedAt,
      });
      if (!status.exists) return true;
      await wait(100);
    }
    return false;
  }
}
