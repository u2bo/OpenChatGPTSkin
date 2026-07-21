import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { THEME_CORE_VERSION } from "@open-chatgpt-skin/theme-core";
import { RuntimeControlDispatcher } from "../control/dispatcher.js";
import { ControllerLock } from "../control/controller-lock.js";
import { sendControlRequest } from "../control/pipe-client.js";
import {
  startSecureControlServer,
  type SecureControlServer,
} from "../control/secure-control-server.js";
import { controlEndpointForIdentity } from "../control/protocol.js";
import { TrustedInstallStore } from "../discovery/trusted-cache.js";
import { RUNTIME_ERROR_CODES, RuntimeError, runtimeErrorCode } from "../errors.js";
import {
  activateManagedCodexWindow,
  launchManagedCodex,
  waitForManagedPort,
} from "../launcher/launcher.js";
import { RuntimeLogger } from "../logging.js";
import { createProductionRuntimePaths, type RuntimePaths } from "../paths.js";
import { RuntimeStateStore } from "../state.js";
import { RuntimeThemeRepository } from "../themes/runtime-theme-repository.js";
import { createProductionDesktopProvider } from "../platform/provider-factory.js";
import type { DesktopRuntimeProvider } from "../types.js";
import type { RuntimeCliDependencies } from "../cli/run.js";
import { connectRuntimePage } from "./page-session.js";
import { recoverRuntimeController } from "./recovery.js";
import {
  RuntimeController,
  type RuntimeControllerDependencies,
} from "./runtime-controller.js";
import { ThemeEngine } from "./theme-engine.js";

const STARTUP_TIMEOUT_MS = 20_000;
const MAX_STARTUP_LINE_BYTES = 8 * 1024;
export const RUNTIME_VERSION = process.env.OPEN_CHATGPT_SKIN_VERSION ??
  THEME_CORE_VERSION;

const RuntimeControllerStartupResponseSchema = z.object({
  startupId: z.string().uuid(),
  ready: z.boolean(),
  errorCode: z.enum(RUNTIME_ERROR_CODES).optional(),
}).strict().superRefine((value, context) => {
  if (value.ready && value.errorCode !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ready startup responses cannot include an error code",
    });
  }
});

export type RuntimeControllerStartupResponse = z.infer<
  typeof RuntimeControllerStartupResponseSchema
>;

export interface ProductionRuntimeController {
  close(): Promise<void>;
}

function startupUnavailable(): RuntimeError {
  return new RuntimeError(
    "RUNTIME_CONTROL_UNAVAILABLE",
    "Runtime controller startup acknowledgement is unavailable",
    "Retry the OpenChatGPTSkin command.",
  );
}

function detachedCliPath(): string {
  return fileURLToPath(new URL("../cli.js", import.meta.url));
}

function stopHelperProcess(child: ChildProcess): void {
  if (child.exitCode === null && !child.killed) child.kill();
}

async function waitForStartup(
  child: ChildProcess,
  startupId: string,
): Promise<void> {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) throw startupUnavailable();
  stderr.resume();

  await new Promise<void>((resolveReady, rejectReady) => {
    let settled = false;
    let received = "";
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      callback();
    };
    const fail = (error: Error) => settle(() => rejectReady(error));
    const onError = () => fail(startupUnavailable());
    const onExit = () => fail(startupUnavailable());
    const onData = (chunk: Buffer | string) => {
      received += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (Buffer.byteLength(received, "utf8") > MAX_STARTUP_LINE_BYTES) {
        fail(startupUnavailable());
        return;
      }

      const newline = received.indexOf("\n");
      if (newline < 0) return;
      if (received.slice(newline + 1) !== "") {
        fail(startupUnavailable());
        return;
      }

      let parsed: RuntimeControllerStartupResponse;
      try {
        parsed = RuntimeControllerStartupResponseSchema.parse(
          JSON.parse(received.slice(0, newline)),
        );
      } catch {
        fail(startupUnavailable());
        return;
      }
      if (parsed.startupId !== startupId) {
        fail(startupUnavailable());
        return;
      }
      if (!parsed.ready) {
        fail(new RuntimeError(
          parsed.errorCode ?? "RUNTIME_CONTROL_UNAVAILABLE",
          "Runtime controller did not become ready",
        ));
        return;
      }
      settle(resolveReady);
    };
    const timeout = setTimeout(() => fail(startupUnavailable()), STARTUP_TIMEOUT_MS);

    stdout.setEncoding("utf8");
    stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function startDetachedRuntimeController(
  mode: "new" | "recover",
): Promise<void> {
  const startupId = randomUUID();
  const child = spawn(
    process.execPath,
    [detachedCliPath(), "serve", "--mode", mode, "--startup-id", startupId],
    {
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForStartup(child, startupId);
  } catch (error) {
    stopHelperProcess(child);
    throw error;
  }

  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

export function createProductionRuntimeCliDependencies(): RuntimeCliDependencies {
  const paths = createProductionRuntimePaths();
  const provider = createProductionDesktopProvider(paths);
  const state = new RuntimeStateStore(paths.sessionFile);
  return {
    themes: new RuntimeThemeRepository(paths.themesRoot, paths.themeStoreDirectory),
    state,
    currentUserSid: () => provider.currentUserSid(),
    send: (sid, request, responseTimeoutMs) => sendControlRequest(
      responseTimeoutMs === undefined
        ? { sid, request, endpoint: controlEndpointForIdentity(sid, process.platform) }
        : {
            sid,
            request,
            responseTimeoutMs,
            endpoint: controlEndpointForIdentity(sid, process.platform),
          },
    ),
    startController: startDetachedRuntimeController,
    newRequestId: randomUUID,
  };
}

async function secureControllerDirectories(
  provider: DesktopRuntimeProvider,
  paths: RuntimePaths,
): Promise<void> {
  await provider.secureDirectory(paths.runtimeDirectory);
  await provider.secureDirectory(paths.installDirectory);
  await provider.secureDirectory(paths.themeStoreDirectory);
}

export async function serveProductionRuntimeController(
  mode: "new" | "recover",
): Promise<ProductionRuntimeController> {
  const paths = createProductionRuntimePaths();
  const provider = createProductionDesktopProvider(paths);
  await secureControllerDirectories(provider, paths);

  const startedAt = await provider.inspectProcessStartedAt(process.pid);
  if (!startedAt) {
    throw new RuntimeError(
      "PROCESS_INSPECTION_DENIED",
      "Runtime controller process identity could not be verified",
    );
  }
  const lock = await ControllerLock.acquire(
    paths.controllerLockFile,
    { pid: process.pid, startedAt },
    (pid) => provider.inspectProcessStartedAt(pid),
  );

  const state = new RuntimeStateStore(paths.sessionFile);
  const cache = new TrustedInstallStore(paths.installCache);
  const logger = new RuntimeLogger(join(paths.logDirectory, "runtime.jsonl"));
  const repository = new RuntimeThemeRepository(
    paths.themesRoot,
    paths.themeStoreDirectory,
  );
  const themes = new ThemeEngine(repository);
  let controller: RuntimeController | null = null;
  let control: SecureControlServer | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        await controller?.close();
      } finally {
        try {
          await control?.close();
        } finally {
          await lock.release();
        }
      }
    })();
    return shutdownPromise;
  };

  const dependencies: RuntimeControllerDependencies = {
    paths,
    provider,
    state,
    themes,
    launchManaged: () => launchManagedCodex({ provider, cache }),
    waitForPort: (receipt) => waitForManagedPort(provider, receipt),
    activateWindow: (receipt) => activateManagedCodexWindow(provider, receipt),
    connectPage: connectRuntimePage,
    secureRuntimeDirectories: () => secureControllerDirectories(provider, paths),
    now: () => new Date().toISOString(),
    runtimeIdentity: { pid: process.pid, startedAt },
    newSessionId: randomUUID,
    onStopped: shutdown,
  };

  try {
    controller = mode === "recover"
      ? await recoverRuntimeController({ ...dependencies, cache })
      : new RuntimeController(dependencies);
    const dispatcher = new RuntimeControlDispatcher(controller, state);
    control = await startSecureControlServer({
      platform: provider.platform ?? process.platform,
      userIdentity: await provider.currentUserSid(),
      dispatch: (request) => dispatcher.dispatch(request),
    });
    if (!control.securityVerified) throw startupUnavailable();
    if (mode === "recover") {
      await logger.write({
        schemaVersion: 1,
        timestamp: dependencies.now(),
        event: "runtime-recovered",
        runtimeVersion: RUNTIME_VERSION,
      });
    }
    return { close: shutdown };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

export function startupFailureResponse(
  startupId: string,
  error: unknown,
): RuntimeControllerStartupResponse {
  return RuntimeControllerStartupResponseSchema.parse({
    startupId,
    ready: false,
    errorCode: runtimeErrorCode(error),
  });
}

export function startupReadyResponse(startupId: string): RuntimeControllerStartupResponse {
  return RuntimeControllerStartupResponseSchema.parse({ startupId, ready: true });
}
