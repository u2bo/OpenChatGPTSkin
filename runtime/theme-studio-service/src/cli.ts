#!/usr/bin/env node
import { StudioError } from "@open-chatgpt-skin/theme-studio-core";
import { prepareProductionRuntimePaths } from "@open-chatgpt-skin/windows-runtime";
import {
  applyProductionRuntimeTheme,
  readProductionRuntimeStatus,
  restoreProductionRuntimeTheme,
} from "./runtime-status.js";
import { startThemeStudioDevHost } from "./vite-host.js";
import { ThemeStudioWorkspace } from "./workspace.js";

function writeFailure(error: unknown): void {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: error instanceof StudioError ? error.code : "INTERNAL",
    },
  })}\n`);
}

async function main(): Promise<void> {
  try {
    const workspace = new ThemeStudioWorkspace({
      paths: await prepareProductionRuntimePaths(),
      runtimeStatus: readProductionRuntimeStatus,
      applyRuntimeTheme: applyProductionRuntimeTheme,
      restoreRuntimeTheme: restoreProductionRuntimeTheme,
    });
    await workspace.initialize();
    const host = await startThemeStudioDevHost({
      runtimeStatus: readProductionRuntimeStatus,
      workspace,
    });
    process.stdout.write(`${JSON.stringify({ url: host.bootstrapUrl })}\n`);

    let closePromise: Promise<void> | null = null;
    const close = () => {
      if (closePromise) return closePromise;
      closePromise = host.close().catch((error: unknown) => {
        process.exitCode = 1;
        writeFailure(error);
      });
      return closePromise;
    };
    process.once("SIGINT", () => { void close(); });
    process.once("SIGTERM", () => { void close(); });
  } catch (error) {
    process.exitCode = 1;
    writeFailure(error);
  }
}

void main();
