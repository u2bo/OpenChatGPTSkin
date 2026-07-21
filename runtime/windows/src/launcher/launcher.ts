import { RuntimeError } from "../errors.js";
import { discoverCodexInstall } from "../discovery/discover.js";
import type { TrustedInstallStore } from "../discovery/trusted-cache.js";
import type {
  PortInspection,
  ProcessIdentity,
  VerifiedCodexInstall,
  DesktopRuntimeProvider,
} from "../types.js";
import { pickLoopbackPort } from "./port.js";

export interface LaunchReceipt {
  readonly install: VerifiedCodexInstall;
  readonly root: ProcessIdentity;
  readonly cdp: {
    readonly host: "127.0.0.1";
    readonly port: number;
  };
  readonly launchedAt: string;
}

export interface LaunchManagedCodexOptions {
  readonly provider: DesktopRuntimeProvider;
  readonly cache: TrustedInstallStore;
  readonly allocatePort?: () => Promise<number>;
}

export interface LaunchReadinessOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

const DEFAULT_PORT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_WINDOW_ACTIVATION_TIMEOUT_MS = 20_000;

function readinessBounds(
  options: LaunchReadinessOptions,
  defaultTimeoutMs = DEFAULT_PORT_READY_TIMEOUT_MS,
): {
  readonly timeoutMs: number;
  readonly intervalMs: number;
} {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const intervalMs = options.intervalMs ?? 100;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
    !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 1_000) {
    throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "readiness bounds are invalid");
  }
  return { timeoutMs, intervalMs };
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

function isTransientProcessInspectionError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError && error.code === "PROCESS_INSPECTION_DENIED";
}

function sameRoot(
  left: ProcessIdentity,
  right: ProcessIdentity,
  platform: DesktopRuntimeProvider["platform"],
): boolean {
  return left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    sameExecutablePath(left.executablePath, right.executablePath, platform);
}

function sameExecutablePath(
  left: string,
  right: string,
  platform: DesktopRuntimeProvider["platform"],
): boolean {
  const normalizePath = platform === "darwin"
    ? (value: string) => value.replaceAll("\\", "/")
    : (value: string) => value.replaceAll("/", "\\").toLowerCase();
  return normalizePath(left) === normalizePath(right);
}

function withManagedRoot(
  receipt: LaunchReceipt,
  root: ProcessIdentity,
  platform: DesktopRuntimeProvider["platform"],
): LaunchReceipt {
  if (sameRoot(receipt.root, root, platform)) return receipt;
  return { ...receipt, root };
}

function isTrustedActivationRoot(
  receipt: LaunchReceipt,
  root: ProcessIdentity,
  platform: DesktopRuntimeProvider["platform"],
): boolean {
  if (!sameExecutablePath(root.executablePath, receipt.install.entryPath, platform)) return false;
  if (sameRoot(root, receipt.root, platform)) return true;
  const launchedAt = Date.parse(receipt.launchedAt);
  const startedAt = Date.parse(root.startedAt);
  return Number.isFinite(launchedAt) && Number.isFinite(startedAt) &&
    startedAt >= launchedAt - 1_000;
}

export async function launchManagedCodex(
  options: LaunchManagedCodexOptions,
): Promise<LaunchReceipt> {
  const discovery = await discoverCodexInstall(options.provider, options.cache);
  if (discovery.runningRoot) {
    throw new RuntimeError(
      "CODEX_ALREADY_RUNNING_UNMANAGED",
      "A normal Codex instance is already running",
      "Close Codex normally and run OpenChatGPTSkin Launcher again.",
    );
  }

  const port = await (options.allocatePort ?? pickLoopbackPort)();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RuntimeError("CODEX_LAUNCH_FAILED", "port allocator returned an invalid port");
  }
  const launchedAt = new Date().toISOString();
  const root = await options.provider.launch(discovery.install.entryPath, [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ]);
  return {
    install: discovery.install,
    root,
    cdp: { host: "127.0.0.1", port },
    launchedAt,
  };
}

export async function waitForManagedPort(
  provider: DesktopRuntimeProvider,
  receipt: LaunchReceipt,
  options: LaunchReadinessOptions = {},
): Promise<PortInspection> {
  const { timeoutMs, intervalMs } = readinessBounds(options);
  const deadline = Date.now() + timeoutMs;
  let inspectionError: RuntimeError | null = null;
  while (Date.now() < deadline) {
    let inspection: PortInspection | null;
    try {
      inspection = await provider.inspectPort(receipt.cdp.port);
    } catch (error) {
      if (!isTransientProcessInspectionError(error)) throw error;
      inspectionError = error;
      await delay(intervalMs);
      continue;
    }
    if (inspection) {
      if (inspection.host !== "127.0.0.1" ||
        inspection.port !== receipt.cdp.port ||
        !inspection.ancestors.includes(receipt.root.pid)) {
        throw new RuntimeError(
          "CDP_PROCESS_MISMATCH",
          "CDP listener does not belong to the managed Codex process tree",
        );
      }
      return inspection;
    }
    await delay(intervalMs);
  }
  if (inspectionError) throw inspectionError;
  throw new RuntimeError("CDP_NOT_READY", "Managed Codex CDP listener did not become ready");
}

export async function activateManagedCodexWindow(
  provider: DesktopRuntimeProvider,
  receipt: LaunchReceipt,
  options: LaunchReadinessOptions = {},
): Promise<LaunchReceipt> {
  const { timeoutMs, intervalMs } = readinessBounds(
    options,
    DEFAULT_WINDOW_ACTIVATION_TIMEOUT_MS,
  );
  await provider.activateCodexApplication();
  const deadline = Date.now() + timeoutMs;
  let inspectionError: RuntimeError | null = null;
  while (Date.now() < deadline) {
    let roots: readonly ProcessIdentity[];
    try {
      roots = await provider.listCodexRoots();
    } catch (error) {
      if (!isTransientProcessInspectionError(error)) throw error;
      inspectionError = error;
      await delay(intervalMs);
      continue;
    }
    inspectionError = null;
    if (roots.some((root) => !isTrustedActivationRoot(receipt, root, provider.platform))) {
      throw new RuntimeError(
        "CODEX_WINDOW_ACTIVATION_FAILED",
        "Application activation created an untrusted Codex root",
      );
    }
    if (roots.length !== 1) {
      await delay(intervalMs);
      continue;
    }
    const activatedReceipt = withManagedRoot(receipt, roots[0]!, provider.platform);
    let windows: Awaited<ReturnType<DesktopRuntimeProvider["inspectManagedWindows"]>>;
    try {
      windows = await provider.inspectManagedWindows(
        activatedReceipt.root.pid,
        activatedReceipt.root.startedAt,
      );
    } catch (error) {
      if (!isTransientProcessInspectionError(error)) throw error;
      inspectionError = error;
      await delay(intervalMs);
      continue;
    }
    inspectionError = null;
    if (!windows.rootExists) {
      throw new RuntimeError(
        "CODEX_WINDOW_ACTIVATION_FAILED",
        "Managed Codex root exited during application activation",
      );
    }
    if (windows.activationReady) {
      await waitForManagedPort(provider, activatedReceipt, { timeoutMs, intervalMs });
      return activatedReceipt;
    }
    await delay(intervalMs);
  }
  if (inspectionError) throw inspectionError;
  throw new RuntimeError(
    "CODEX_WINDOW_ACTIVATION_FAILED",
    "Managed Codex application activation did not become ready",
    "Quit Codex completely and retry once. If it repeats, report the installed Codex version.",
  );
}
