import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { THEME_CORE_VERSION } from "@open-chatgpt-skin/theme-core";
import type { StudioRuntimeStatus } from "@open-chatgpt-skin/theme-studio-core";
import {
  OPEN_CHATGPT_SKIN_REPOSITORY_URL,
  STUDIO_CSP_NONCE_PLACEHOLDER,
  StudioError,
} from "@open-chatgpt-skin/theme-studio-core";
import {
  startThemeStudioServer,
  type RunningThemeStudioServer,
} from "./server.js";
import type { ThemeStudioWorkspace } from "./workspace.js";

export interface ThemeStudioProductionHostDependencies {
  readonly indexHtmlPath: string;
  readonly runtimeStatus: () => Promise<StudioRuntimeStatus>;
  readonly workspace?: ThemeStudioWorkspace;
  readonly studioVersion?: string;
  readonly repositoryUrl?: string | null;
}

export async function startThemeStudioProductionHost(
  dependencies: ThemeStudioProductionHostDependencies,
): Promise<RunningThemeStudioServer> {
  const template = await readFile(dependencies.indexHtmlPath, "utf8");
  if (!template.includes(STUDIO_CSP_NONCE_PLACEHOLDER)) {
    throw new StudioError(
      "INTERNAL",
      "Production Theme Studio is missing its CSP nonce placeholder",
      "Rebuild the Theme Studio release assets before starting OpenChatGPTSkin.",
    );
  }

  const cspNonce = randomBytes(18).toString("base64");
  const indexHtml = template.replaceAll(
    STUDIO_CSP_NONCE_PLACEHOLDER,
    cspNonce,
  );

  return startThemeStudioServer({
    studioVersion: dependencies.studioVersion ?? THEME_CORE_VERSION,
    repositoryUrl: dependencies.repositoryUrl ??
      process.env.OPEN_CHATGPT_SKIN_REPOSITORY_URL ??
      OPEN_CHATGPT_SKIN_REPOSITORY_URL,
    runtimeStatus: dependencies.runtimeStatus,
    ...(dependencies.workspace ? { workspace: dependencies.workspace } : {}),
    indexHtml,
    cspNonce,
  });
}
