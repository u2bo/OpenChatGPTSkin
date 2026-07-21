import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { lstat, rename } from "node:fs/promises";
import { RuntimeError } from "./errors.js";

const PRODUCT_DATA_DIRECTORY = "OpenChatGPTSkin";
export const OPEN_CHATGPT_SKIN_INSTALL_ROOT =
  "OPEN_CHATGPT_SKIN_INSTALL_ROOT";
// Compatibility-only source for the one-time pre-rename data migration.
const LEGACY_PRODUCT_DATA_DIRECTORY = "OpenCodexSkin";

export interface RuntimePaths {
  readonly dataRoot: string;
  readonly installRoot: string;
  readonly runtimeDirectory: string;
  readonly installDirectory: string;
  readonly sessionFile: string;
  readonly pendingProbeFile: string;
  readonly installCache: string;
  readonly logDirectory: string;
  readonly themesRoot: string;
  readonly themeStoreDirectory: string;
  readonly controllerLockFile: string;
  readonly acceptanceSessionFile: string;
  readonly acceptanceEvidenceDirectory: string;
  readonly themeStudioDraftDirectory: string;
}

export function createRuntimePaths(dataRoot: string, installRoot: string): RuntimePaths {
  return {
    dataRoot,
    installRoot,
    runtimeDirectory: join(dataRoot, "runtime"),
    installDirectory: join(dataRoot, "install"),
    sessionFile: join(dataRoot, "runtime", "session.json"),
    pendingProbeFile: join(dataRoot, "runtime", "pending-probe.json"),
    installCache: join(dataRoot, "install", "trusted-codex.json"),
    logDirectory: join(dataRoot, "runtime", "logs"),
    themesRoot: join(installRoot, "themes"),
    themeStoreDirectory: join(dataRoot, "theme-store"),
    controllerLockFile: join(dataRoot, "runtime", "controller.lock"),
    acceptanceSessionFile: join(dataRoot, "runtime", "acceptance-session.json"),
    acceptanceEvidenceDirectory: join(installRoot, "docs", "runtime-acceptance"),
    themeStudioDraftDirectory: join(dataRoot, "theme-studio", "drafts"),
  };
}

export interface ProductionRuntimeEnvironment {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
  readonly installRoot?: string;
}

function productionInstallRoot(
  metaUrl: string,
  environment: ProductionRuntimeEnvironment,
): string {
  const configured = environment.installRoot ??
    environment.env?.[OPEN_CHATGPT_SKIN_INSTALL_ROOT] ??
    process.env[OPEN_CHATGPT_SKIN_INSTALL_ROOT];
  if (configured !== undefined) {
    if (!isAbsolute(configured) || configured.includes("\0")) {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "OpenChatGPTSkin install root must be an absolute path",
        "Start OpenChatGPTSkin from its packaged launcher or remove the invalid install-root override.",
      );
    }
    return resolve(configured);
  }
  return resolve(dirname(fileURLToPath(metaUrl)), "../../..");
}

function productionDataRootFor(
  environment: ProductionRuntimeEnvironment,
  directoryName: string,
): string {
  const platform = environment.platform ?? process.platform;
  const env = environment.env ?? process.env;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (!localAppData) {
      throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "LOCALAPPDATA is not defined");
    }
    return join(localAppData, directoryName);
  }
  if (platform === "darwin") {
    const home = environment.homeDirectory ?? env.HOME ?? homedir();
    if (!home) {
      throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "macOS home directory is unavailable");
    }
    return join(home, "Library", "Application Support", directoryName);
  }
  throw new RuntimeError(
    "RUNTIME_ENVIRONMENT_INVALID",
    `Unsupported desktop platform: ${platform}`,
    "Use OpenChatGPTSkin on Windows or macOS.",
  );
}

function productionDataRoot(environment: ProductionRuntimeEnvironment): string {
  return productionDataRootFor(environment, PRODUCT_DATA_DIRECTORY);
}

export function createProductionRuntimePaths(
  metaUrl: string = import.meta.url,
  environment: ProductionRuntimeEnvironment = {},
): RuntimePaths {
  const installRoot = productionInstallRoot(metaUrl, environment);
  return createRuntimePaths(productionDataRoot(environment), installRoot);
}

async function existingDirectory(path: string): Promise<"directory" | "unsafe" | "missing"> {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink() ? "directory" : "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/**
 * Atomically adopts pre-rename user data only when the new product directory
 * does not exist. Existing new-brand data is always authoritative; directories
 * are never merged or overwritten.
 */
export async function prepareProductionRuntimePaths(
  metaUrl: string = import.meta.url,
  environment: ProductionRuntimeEnvironment = {},
): Promise<RuntimePaths> {
  const paths = createProductionRuntimePaths(metaUrl, environment);
  const legacyDataRoot = productionDataRootFor(
    environment,
    LEGACY_PRODUCT_DATA_DIRECTORY,
  );
  const [currentState, legacyState] = await Promise.all([
    existingDirectory(paths.dataRoot),
    existingDirectory(legacyDataRoot),
  ]);
  if (currentState !== "missing" || legacyState === "missing") return paths;
  if (legacyState === "unsafe") {
    throw new RuntimeError(
      "RUNTIME_ENVIRONMENT_INVALID",
      "Previous installation data is not a regular directory",
      "Review the previous data directory before starting OpenChatGPTSkin.",
    );
  }

  try {
    await rename(legacyDataRoot, paths.dataRoot);
  } catch (error) {
    // Another new-brand process may have won the same one-time migration race.
    if (await existingDirectory(paths.dataRoot) === "directory" &&
      await existingDirectory(legacyDataRoot) === "missing") {
      return paths;
    }
    throw new RuntimeError(
      "RUNTIME_ENVIRONMENT_INVALID",
      error instanceof Error ? error.message : "Previous installation data migration failed",
      "Quit all OpenChatGPTSkin processes and retry.",
    );
  }
  return paths;
}
