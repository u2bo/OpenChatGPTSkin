#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { THEME_CORE_VERSION } from "@open-chatgpt-skin/theme-core";
import { StudioError } from "@open-chatgpt-skin/theme-studio-core";
import {
  prepareProductionRuntimePaths,
  RuntimeError,
  type RuntimePaths,
} from "@open-chatgpt-skin/windows-runtime";
import {
  applyProductionRuntimeTheme,
  readProductionRuntimeStatus,
  restoreProductionRuntimeTheme,
} from "./runtime-status.js";
import { startThemeStudioProductionHost } from "./production-host.js";
import { ThemeStudioWorkspace } from "./workspace.js";

interface CliOptions {
  readonly development: boolean;
  readonly openBrowser: boolean;
}

interface StartupFailure {
  readonly code: string;
  readonly message: string;
  readonly nextAction: string;
}

const STUDIO_VERSION = process.env.OPEN_CHATGPT_SKIN_VERSION ??
  THEME_CORE_VERSION;

function parseOptions(args: readonly string[]): CliOptions {
  const allowed = new Set(["--dev", "--no-open"]);
  const unsupported = args.find((argument) => !allowed.has(argument));
  if (unsupported) {
    throw new StudioError("INTERNAL", `Unsupported Studio option: ${unsupported}`);
  }
  return {
    development: args.includes("--dev"),
    openBrowser: !args.includes("--no-open") && !args.includes("--dev"),
  };
}

async function openSystemBrowser(url: string): Promise<void> {
  const command = process.platform === "win32"
    ? { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
    : { file: "open", args: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function startupFailure(error: unknown): StartupFailure {
  if (error instanceof StudioError) {
    return {
      code: error.code,
      message: error.message,
      nextAction: error.nextAction ??
        "Review the startup log and retry OpenChatGPTSkin.",
    };
  }
  if (error instanceof RuntimeError) {
    return {
      code: error.code,
      message: "The OpenChatGPTSkin Runtime environment is not ready.",
      nextAction: error.nextAction ??
        "Review the startup log and retry OpenChatGPTSkin.",
    };
  }
  return {
    code: "INTERNAL",
    message: "Theme Studio failed to start.",
    nextAction: "Review the startup log and report this error code if retry still fails.",
  };
}

function publicStartupLogPath(): string {
  return process.platform === "win32"
    ? "%LOCALAPPDATA%\\OpenChatGPTSkin\\runtime\\logs\\theme-studio.jsonl"
    : "~/Library/Application Support/OpenChatGPTSkin/runtime/logs/theme-studio.jsonl";
}

async function writeFailure(
  error: unknown,
  paths?: RuntimePaths,
): Promise<void> {
  const failure = startupFailure(error);
  let log: string | undefined;
  let logWriteFailed = false;
  if (paths) {
    try {
      await mkdir(paths.logDirectory, { recursive: true });
      await appendFile(join(paths.logDirectory, "theme-studio.jsonl"), `${JSON.stringify({
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        event: "studio-startup-error",
        studioVersion: STUDIO_VERSION,
        errorCode: failure.code,
      })}\n`, "utf8");
      log = publicStartupLogPath();
    } catch {
      logWriteFailed = true;
    }
  }
  process.stderr.write(`${JSON.stringify({
    error: {
      ...failure,
      ...(log ? { log } : {}),
      ...(logWriteFailed ? { logWriteFailed: true } : {}),
    },
  })}\n`);
}

async function main(): Promise<void> {
  let paths: RuntimePaths | undefined;
  try {
    const options = parseOptions(process.argv.slice(2));
    paths = await prepareProductionRuntimePaths();
    const workspace = new ThemeStudioWorkspace({
      paths,
      runtimeStatus: readProductionRuntimeStatus,
      applyRuntimeTheme: applyProductionRuntimeTheme,
      restoreRuntimeTheme: restoreProductionRuntimeTheme,
    });
    await workspace.initialize();
    const host = options.development
      ? await import("./vite-host.js").then(({ startThemeStudioDevHost }) =>
        startThemeStudioDevHost({
          runtimeStatus: readProductionRuntimeStatus,
          workspace,
        }))
      : await startThemeStudioProductionHost({
          indexHtmlPath: join(
            paths.installRoot,
            "apps",
            "theme-studio",
            "dist",
            "index.html",
          ),
          runtimeStatus: readProductionRuntimeStatus,
          workspace,
          studioVersion: STUDIO_VERSION,
    });
    process.stdout.write(`${JSON.stringify({ url: host.bootstrapUrl })}\n`);
    if (options.openBrowser) {
      try {
        await openSystemBrowser(host.bootstrapUrl);
      } catch {
        await host.close();
        throw new StudioError(
          "INTERNAL",
          "The system browser could not be opened.",
          "Open the startup URL in your default browser or retry OpenChatGPTSkin.",
        );
      }
    }

    let closePromise: Promise<void> | null = null;
    const close = () => {
      if (closePromise) return closePromise;
      closePromise = host.close().catch((error: unknown) => {
        process.exitCode = 1;
        return writeFailure(error, paths);
      });
      return closePromise;
    };
    process.once("SIGINT", () => { void close(); });
    process.once("SIGTERM", () => { void close(); });
  } catch (error) {
    process.exitCode = 1;
    await writeFailure(error, paths);
  }
}

void main();
