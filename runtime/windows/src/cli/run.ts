import { runtimeErrorCode, RuntimeError, type RuntimeErrorCode } from "../errors.js";
import {
  CONTROL_PROTOCOL_VERSION,
  type ControlRequest,
  type ControlResponse,
  type RuntimeStatusView,
} from "../control/protocol.js";
import type { RuntimeSessionState, RuntimeStateStore } from "../state.js";
import type { RuntimeThemeRepository } from "../themes/runtime-theme-repository.js";
import { parseRuntimeArguments, type RuntimeCliCommand } from "./arguments.js";

export const RUNTIME_CLI_EXIT = {
  ok: 0,
  usage: 64,
  validation: 65,
  unavailable: 69,
  internal: 70,
  filesystem: 73,
} as const;

export interface RuntimeCliDependencies {
  readonly themes: Pick<RuntimeThemeRepository, "list" | "importFile">;
  readonly state: Pick<RuntimeStateStore, "read">;
  readonly currentUserSid: () => Promise<string>;
  readonly send: (
    sid: string,
    request: ControlRequest,
    responseTimeoutMs?: number,
  ) => Promise<ControlResponse>;
  readonly startController: (mode: "new" | "recover") => Promise<void>;
  readonly newRequestId: () => string;
}

export interface RuntimeCliIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export interface RunRuntimeCliOptions {
  readonly startupTimeoutMs?: number;
}

export type RuntimeControlCliCommand = Exclude<RuntimeCliCommand, {
  readonly kind: "list-themes" | "import" | "serve";
}>;

const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const MUTATION_RESPONSE_TIMEOUT_MS = 60_000;

function stoppedStatus(): RuntimeStatusView {
  return {
    status: "stopped",
    controllerAvailable: false,
    selectedTheme: null,
    appliedTheme: null,
    skinApplied: false,
    packageVersion: null,
    operation: null,
    nextAction: "Launch one of the built-in themes.",
  };
}

function writeJson(write: (value: string) => void, value: unknown): void {
  write(`${JSON.stringify(value, null, 2)}\n`);
}

function isRuntimeCode(error: unknown, code: RuntimeErrorCode): boolean {
  return runtimeErrorCode(error) === code;
}

function exitForError(error: unknown): number {
  if (error instanceof RuntimeError) {
    switch (error.code) {
      case "THEME_NOT_FOUND":
      case "THEME_NOT_READY":
      case "THEME_RUNTIME_TOO_LARGE":
      case "RUNTIME_SESSION_STALE":
      case "RUNTIME_INVALID_STATE":
        return RUNTIME_CLI_EXIT.validation;
      case "RUNTIME_ENVIRONMENT_INVALID":
      case "CODEX_NOT_INSTALLED":
      case "CODEX_DISCOVERY_REQUIRES_BOOTSTRAP":
      case "CODEX_IDENTITY_INVALID":
      case "CODEX_ALREADY_RUNNING_UNMANAGED":
      case "CODEX_LAUNCH_FAILED":
      case "CODEX_WINDOW_ACTIVATION_FAILED":
      case "PROCESS_INSPECTION_DENIED":
      case "CDP_NOT_READY":
      case "CDP_ENDPOINT_UNSAFE":
      case "CDP_PROCESS_MISMATCH":
      case "CDP_TARGET_NOT_FOUND":
      case "CDP_TARGET_AMBIGUOUS":
      case "ADAPTER_INCOMPATIBLE":
      case "RUNTIME_BUSY":
      case "RUNTIME_CONTROL_UNAVAILABLE":
      case "RESTORE_AWAITING_EXIT":
        return RUNTIME_CLI_EXIT.unavailable;
      default:
        return RUNTIME_CLI_EXIT.internal;
    }
  }

  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (typeof code === "string" && ["EACCES", "EEXIST", "EIO", "ENOENT", "ENOSPC", "EPERM"]
    .includes(code)) {
    return RUNTIME_CLI_EXIT.filesystem;
  }
  return RUNTIME_CLI_EXIT.internal;
}

function errorOutput(error: unknown): { readonly error: { readonly code: RuntimeErrorCode } } {
  return { error: { code: runtimeErrorCode(error) } };
}

function requestFor(command: RuntimeControlCliCommand, requestId: string): ControlRequest {
  const base = { protocolVersion: CONTROL_PROTOCOL_VERSION, requestId } as const;
  switch (command.kind) {
    case "launch":
      return {
        ...base,
        command: "launch",
        params: command.themeVersion
          ? { themeId: command.themeId, themeVersion: command.themeVersion }
          : { themeId: command.themeId },
      };
    case "status":
      return { ...base, command: "status", params: {} };
    case "switch":
      return {
        ...base,
        command: "switch",
        params: command.themeVersion
          ? { themeId: command.themeId, themeVersion: command.themeVersion }
          : { themeId: command.themeId },
      };
    case "pause":
      return { ...base, command: "pause", params: {} };
    case "resume":
      return { ...base, command: "resume", params: {} };
    case "restore":
      return { ...base, command: "restore", params: {} };
  }
}

async function sendCommand(
  dependencies: RuntimeCliDependencies,
  request: ControlRequest,
): Promise<ControlResponse> {
  const sid = await dependencies.currentUserSid();
  if (request.command === "status") return dependencies.send(sid, request);
  return dependencies.send(sid, request, MUTATION_RESPONSE_TIMEOUT_MS);
}

async function waitForControllerStart(
  startController: RuntimeCliDependencies["startController"],
  mode: "new" | "recover",
  timeoutMs: number,
): Promise<void> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Runtime startup timeout is invalid");
  }
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      startController(mode),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RuntimeError(
          "RUNTIME_CONTROL_UNAVAILABLE",
          "Runtime controller did not become ready in time",
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function executeControlCommand(
  command: RuntimeControlCliCommand,
  dependencies: RuntimeCliDependencies,
  options: Required<RunRuntimeCliOptions>,
): Promise<ControlResponse | RuntimeStatusView> {
  const request = requestFor(command, dependencies.newRequestId());
  try {
    return await sendCommand(dependencies, request);
  } catch (error) {
    if (!isRuntimeCode(error, "RUNTIME_CONTROL_UNAVAILABLE")) throw error;
  }

  const state: RuntimeSessionState | null = await dependencies.state.read();
  if (command.kind === "status" && state === null) return stoppedStatus();

  let mode: "new" | "recover";
  if (state !== null) {
    mode = "recover";
  } else if (command.kind === "launch") {
    mode = "new";
  } else {
    throw new RuntimeError(
      "RUNTIME_CONTROL_UNAVAILABLE",
      "Runtime controller is not running",
    );
  }

  try {
    await waitForControllerStart(dependencies.startController, mode, options.startupTimeoutMs);
  } catch (error) {
    if (!isRuntimeCode(error, "RUNTIME_CONTROL_UNAVAILABLE") &&
      !isRuntimeCode(error, "RUNTIME_BUSY")) throw error;
  }
  return sendCommand(dependencies, request);
}

export async function executeRuntimeControlCommand(
  command: RuntimeControlCliCommand,
  dependencies: RuntimeCliDependencies,
  options: RunRuntimeCliOptions = {},
): Promise<ControlResponse | RuntimeStatusView> {
  return executeControlCommand(command, dependencies, {
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
  });
}

function outputResponse(response: ControlResponse | RuntimeStatusView): {
  readonly ok: boolean;
  readonly body: unknown;
  readonly error?: RuntimeErrorCode;
} {
  if (!("protocolVersion" in response)) return { ok: true, body: response };
  if (response.ok) return { ok: true, body: response.result };
  return { ok: false, body: { error: response.error }, error: response.error.code };
}

export async function runRuntimeCli(
  args: readonly string[],
  dependencies: RuntimeCliDependencies,
  io: RuntimeCliIo,
  options: RunRuntimeCliOptions = {},
): Promise<number> {
  let command: Exclude<RuntimeCliCommand, { readonly kind: "serve" }>;
  try {
    command = parseRuntimeArguments(args);
  } catch (error) {
    writeJson(io.stderr, errorOutput(error));
    return RUNTIME_CLI_EXIT.usage;
  }

  const resolvedOptions: Required<RunRuntimeCliOptions> = {
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
  };
  try {
    if (command.kind === "list-themes") {
      writeJson(io.stdout, { themes: await dependencies.themes.list() });
      return RUNTIME_CLI_EXIT.ok;
    }
    if (command.kind === "import") {
      writeJson(io.stdout, { theme: await dependencies.themes.importFile(command.themeFile) });
      return RUNTIME_CLI_EXIT.ok;
    }

    const response = outputResponse(await executeControlCommand(command, dependencies, resolvedOptions));
    if (response.ok) {
      writeJson(io.stdout, response.body);
      return RUNTIME_CLI_EXIT.ok;
    }
    writeJson(io.stderr, response.body);
    return exitForError(new RuntimeError(response.error!, "Runtime command failed"));
  } catch (error) {
    writeJson(io.stderr, errorOutput(error));
    return exitForError(error);
  }
}
