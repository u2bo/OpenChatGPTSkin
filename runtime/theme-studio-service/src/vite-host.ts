import { randomBytes } from "node:crypto";
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { THEME_CORE_VERSION } from "@open-chatgpt-skin/theme-core";
import type { StudioRuntimeStatus } from "@open-chatgpt-skin/theme-studio-core";
import { OPEN_CHATGPT_SKIN_REPOSITORY_URL } from "@open-chatgpt-skin/theme-studio-core";
import { createServer as createViteServer } from "vite";
import { startThemeStudioServer } from "./server.js";
import type { ThemeStudioWorkspace } from "./workspace.js";

const STUDIO_APP_ROOT = fileURLToPath(
  new URL("../../../apps/theme-studio/", import.meta.url),
);

export interface StudioMiddleware {
  handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean>;
  close(): Promise<void>;
}

export interface RunningThemeStudioDevHost {
  readonly origin: string;
  readonly bootstrapUrl: string;
  close(): Promise<void>;
}

export interface ThemeStudioDevHostDependencies {
  readonly createMiddleware?: (
    server: Server,
    cspNonce: string,
  ) => Promise<StudioMiddleware>;
  readonly runtimeStatus: () => Promise<StudioRuntimeStatus>;
  readonly workspace?: ThemeStudioWorkspace;
}

async function createDefaultMiddleware(
  server: Server,
  cspNonce: string,
): Promise<StudioMiddleware> {
  const vite = await createViteServer({
    root: STUDIO_APP_ROOT,
    appType: "spa",
    html: { cspNonce },
    server: { middlewareMode: true, hmr: { server } },
  });

  return {
    handle(request, response) {
      return new Promise<boolean>((resolveHandled, rejectHandled) => {
        let settled = false;
        const settle = (callback: () => void) => {
          if (settled) return;
          settled = true;
          response.off("finish", onFinish);
          response.off("close", onClose);
          callback();
        };
        const onFinish = () => settle(() => resolveHandled(true));
        const onClose = () => settle(() => resolveHandled(true));

        response.once("finish", onFinish);
        response.once("close", onClose);
        vite.middlewares(request, response, (error?: unknown) => {
          if (error) {
            settle(() => rejectHandled(error));
            return;
          }
          settle(() => resolveHandled(false));
        });
      });
    },
    close: () => vite.close(),
  };
}

export async function startThemeStudioDevHost(
  dependencies: ThemeStudioDevHostDependencies,
): Promise<RunningThemeStudioDevHost> {
  const cspNonce = randomBytes(18).toString("base64");
  let middleware: StudioMiddleware | null = null;
  const server = await startThemeStudioServer({
    studioVersion: THEME_CORE_VERSION,
    repositoryUrl: process.env.OPEN_CHATGPT_SKIN_REPOSITORY_URL ??
      OPEN_CHATGPT_SKIN_REPOSITORY_URL,
    runtimeStatus: dependencies.runtimeStatus,
    ...(dependencies.workspace ? { workspace: dependencies.workspace } : {}),
    indexHtml: "<!doctype html><title>Theme Studio</title>",
    cspNonce,
    fallback: (request, response) => middleware
      ? middleware.handle(request, response)
      : Promise.resolve(false),
  });

  try {
    middleware = await (
      dependencies.createMiddleware ?? createDefaultMiddleware
    )(server.httpServer, cspNonce);
    const runningMiddleware = middleware;
    let closePromise: Promise<void> | null = null;
    return {
      origin: server.origin,
      bootstrapUrl: server.bootstrapUrl,
      close: () => {
        if (closePromise) return closePromise;
        closePromise = (async () => {
          try {
            await runningMiddleware.close();
          } finally {
            await server.close();
          }
        })();
        return closePromise;
      },
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}
