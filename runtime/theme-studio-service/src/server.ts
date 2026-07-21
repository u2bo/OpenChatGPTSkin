import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  STUDIO_PROTOCOL_VERSION,
  StudioBootstrapSchema,
  StudioCreateDraftInputSchema,
  StudioDeleteThemeInputSchema,
  StudioDraftCommandInputSchema,
  StudioError,
  StudioEventSchema,
  StudioImportThemeInputSchema,
  StudioThemeRefSchema,
  StudioUpdateDraftInputSchema,
  StudioUploadAssetInputSchema,
  type StudioErrorCode,
  type StudioRuntimeStatus,
} from "@open-chatgpt-skin/theme-studio-core";
import { z, ZodError } from "zod";
import {
  assertExactOrigin,
  readBoundedBytes,
  readBoundedJson,
  writeBytes,
  writeJson,
} from "./http.js";
import {
  createStudioSession,
  STUDIO_COOKIE_NAME,
} from "./session.js";
import type { ThemeStudioWorkspace } from "./workspace.js";

const SessionExchangeSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const RUNTIME_EVENT_INTERVAL_MS = 5_000;
const SESSION_JSON_LIMIT_BYTES = 16 * 1024;
const IMAGE_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const ARCHIVE_UPLOAD_LIMIT_BYTES = 32 * 1024 * 1024;

export interface ThemeStudioServerDependencies {
  readonly studioVersion: string;
  readonly repositoryUrl?: string | null;
  readonly runtimeStatus: () => Promise<StudioRuntimeStatus>;
  readonly workspace?: ThemeStudioWorkspace;
  readonly indexHtml: string;
  readonly cspNonce?: string;
  readonly fallback?: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<boolean>;
  readonly newToken?: () => string;
}

export interface RunningThemeStudioServer {
  readonly origin: string;
  readonly bootstrapUrl: string;
  readonly httpServer: Server;
  close(): Promise<void>;
}

function statusFor(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (!(error instanceof StudioError)) return 500;
  switch (error.code) {
    case "STUDIO_ORIGIN_REJECTED":
      return 403;
    case "STUDIO_SESSION_INVALID":
      return 401;
    case "STUDIO_REQUEST_TOO_LARGE":
      return 413;
    case "STUDIO_REQUEST_INVALID":
      return 400;
    case "STUDIO_DRAFT_NOT_FOUND":
      return 404;
    case "STUDIO_DRAFT_CONFLICT":
      return 409;
    case "STUDIO_DRAFT_INVALID":
    case "STUDIO_ASSET_INVALID":
    case "STUDIO_IMPORT_INVALID":
    case "STUDIO_EXPORT_INVALID":
    case "STUDIO_SAVE_FAILED":
    case "STUDIO_DELETE_FAILED":
      return 422;
    case "STUDIO_APPLY_FAILED":
      return 409;
    case "RUNTIME_STATUS_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

function requireWorkspace(
  workspace: ThemeStudioWorkspace | undefined,
): ThemeStudioWorkspace {
  if (!workspace) {
    throw new StudioError("INTERNAL", "Theme Studio workspace is unavailable");
  }
  return workspace;
}

function headerValue(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StudioError("STUDIO_REQUEST_INVALID", "Required request header is missing");
  }
  return value;
}

function errorCode(error: unknown): StudioErrorCode {
  if (error instanceof ZodError) return "STUDIO_REQUEST_INVALID";
  return error instanceof StudioError ? error.code : "INTERNAL";
}

function serveIndex(
  response: ServerResponse,
  indexHtml: string,
): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(indexHtml);
}

function applySecurityHeaders(
  response: ServerResponse,
  cspNonce: string | undefined,
  origin: string,
): void {
  const nonceSource = cspNonce ? ` 'nonce-${cspNonce}'` : "";
  const websocketOrigin = origin.replace(/^http:/, "ws:");
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; connect-src 'self' ${websocketOrigin}; img-src 'self' blob:; font-src 'self' blob:; style-src 'self'${nonceSource}; style-src-attr 'unsafe-inline'; script-src 'self'${nonceSource}`,
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

export async function startThemeStudioServer(
  dependencies: ThemeStudioServerDependencies,
): Promise<RunningThemeStudioServer> {
  const session = createStudioSession(dependencies.newToken);
  const closeEventStreams = new Set<() => void>();
  let eventSequence = 0;
  let origin = "";

  const server = createServer(async (request, response) => {
    applySecurityHeaders(response, dependencies.cspNonce, origin);
    try {
      if (request.headers.host !== origin.slice("http://".length)) {
        throw new StudioError(
          "STUDIO_ORIGIN_REJECTED",
          "Request host is not authorized",
        );
      }

      const url = new URL(request.url ?? "/", origin);
      if (request.method === "POST" && url.pathname === "/api/session") {
        assertExactOrigin(request, origin);
        const body = SessionExchangeSchema.parse(
          await readBoundedJson(request, SESSION_JSON_LIMIT_BYTES),
        );
        const cookie = session.exchange(body.token);
        response.writeHead(204, {
          "Cache-Control": "no-store",
          "Set-Cookie": `${STUDIO_COOKIE_NAME}=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
        });
        response.end();
        return;
      }

      if (url.pathname.startsWith("/api/") &&
        !session.verifyCookie(request.headers.cookie)) {
        throw new StudioError(
          "STUDIO_SESSION_INVALID",
          "Studio session is not authenticated",
        );
      }

      if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        writeJson(response, 200, StudioBootstrapSchema.parse({
          protocolVersion: STUDIO_PROTOCOL_VERSION,
          studioVersion: dependencies.studioVersion,
          repositoryUrl: dependencies.repositoryUrl ?? null,
          capabilities: dependencies.workspace
            ? [
                "studio-shell",
                "theme-library",
                "draft-editing",
                "asset-upload",
                "version-save",
                "theme-import-export",
                "theme-delete",
                "runtime-apply",
                "runtime-restore",
              ]
            : ["studio-shell"],
          runtime: await dependencies.runtimeStatus(),
        }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/themes") {
        writeJson(response, 200, await requireWorkspace(dependencies.workspace).listThemes());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/themes/apply") {
        assertExactOrigin(request, origin);
        const ref = StudioThemeRefSchema.parse(await readBoundedJson(request));
        writeJson(
          response,
          200,
          await requireWorkspace(dependencies.workspace).applySavedTheme(ref),
        );
        return;
      }

      const themeMatch = /^\/api\/themes\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname);
      if (request.method === "DELETE" && themeMatch) {
        assertExactOrigin(request, origin);
        const input = StudioDeleteThemeInputSchema.parse({
          id: themeMatch[1],
          version: url.searchParams.get("version") ?? undefined,
        });
        writeJson(
          response,
          200,
          await requireWorkspace(dependencies.workspace).deletePersonalTheme(input),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/drafts") {
        assertExactOrigin(request, origin);
        const input = StudioCreateDraftInputSchema.parse(await readBoundedJson(request));
        writeJson(response, 201, await requireWorkspace(dependencies.workspace).createDraft(input));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/drafts/latest") {
        writeJson(
          response,
          200,
          await requireWorkspace(dependencies.workspace).openLatestDraft(),
        );
        return;
      }

      const draftMatch = /^\/api\/drafts\/([0-9a-f-]+)(?:\/(undo|redo|validate|save|apply|assets))?$/.exec(
        url.pathname,
      );
      if (draftMatch) {
        const draftId = draftMatch[1]!;
        const action = draftMatch[2];
        const workspace = requireWorkspace(dependencies.workspace);
        if (request.method === "GET" && action === undefined) {
          writeJson(response, 200, await workspace.openDraft(draftId));
          return;
        }
        if (request.method === "PUT" && action === undefined) {
          assertExactOrigin(request, origin);
          const body = StudioUpdateDraftInputSchema.omit({ draftId: true })
            .parse(await readBoundedJson(request));
          writeJson(response, 200, await workspace.updateDraft({ draftId, ...body }));
          return;
        }
        if (request.method === "POST" && action && action !== "assets") {
          assertExactOrigin(request, origin);
          if (action === "validate") {
            writeJson(response, 200, await workspace.validateDraft(draftId));
            return;
          }
          const body = StudioDraftCommandInputSchema.omit({ draftId: true })
            .parse(await readBoundedJson(request));
          const input = { draftId, ...body };
          if (action === "undo") writeJson(response, 200, await workspace.undo(input));
          if (action === "redo") writeJson(response, 200, await workspace.redo(input));
          if (action === "save") writeJson(response, 200, await workspace.saveVersion(input));
          if (action === "apply") writeJson(response, 200, await workspace.applyTheme(input));
          return;
        }
        if (request.method === "POST" && action === "assets") {
          assertExactOrigin(request, origin);
          const bytes = await readBoundedBytes(request, IMAGE_UPLOAD_LIMIT_BYTES);
          const input = StudioUploadAssetInputSchema.parse({
            draftId,
            expectedRevision: Number(url.searchParams.get("revision")),
            slot: url.searchParams.get("slot"),
            assetKey: url.searchParams.get("assetKey") ?? undefined,
            fileName: headerValue(request.headers["x-file-name"]),
            mimeType: headerValue(request.headers["content-type"]),
            bytes,
          });
          writeJson(response, 200, await workspace.uploadAsset(input));
          return;
        }
      }

      if (request.method === "POST" && url.pathname === "/api/import") {
        assertExactOrigin(request, origin);
        const bytes = await readBoundedBytes(request, ARCHIVE_UPLOAD_LIMIT_BYTES);
        const input = StudioImportThemeInputSchema.parse({
          fileName: headerValue(request.headers["x-file-name"]),
          bytes,
        });
        writeJson(response, 201, await requireWorkspace(dependencies.workspace).importTheme(input));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/export") {
        const ref = StudioThemeRefSchema.parse({
          id: url.searchParams.get("id"),
          version: url.searchParams.get("version"),
        });
        const exported = await requireWorkspace(dependencies.workspace).exportTheme(ref);
        writeBytes(response, 200, exported.bytes, exported.mimeType, {
          "Content-Disposition": `attachment; filename="${exported.fileName}"`,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/runtime") {
        writeJson(response, 200, await requireWorkspace(dependencies.workspace).getRuntimeStatus());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/restore") {
        assertExactOrigin(request, origin);
        writeJson(response, 200, await requireWorkspace(dependencies.workspace).restoreRuntime());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/draft-asset") {
        const asset = await requireWorkspace(dependencies.workspace).readDraftAsset(
          url.searchParams.get("draftId") ?? "",
          url.searchParams.get("path") ?? "",
        );
        writeBytes(response, 200, asset.bytes, asset.mimeType);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/theme-preview") {
        const source = url.searchParams.get("source");
        if (source !== "builtin" && source !== "personal") {
          throw new StudioError("STUDIO_REQUEST_INVALID", "Theme preview source is invalid");
        }
        const ref = StudioThemeRefSchema.parse({
          id: url.searchParams.get("id"),
          version: url.searchParams.get("version"),
        });
        const preview = await requireWorkspace(dependencies.workspace).readThemePreview(source, ref);
        writeBytes(response, 200, preview.bytes, preview.mimeType);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        const firstRuntime = await dependencies.runtimeStatus();
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Content-Type-Options": "nosniff",
        });

        let closed = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const close = () => {
          if (closed) return;
          closed = true;
          if (timer) clearTimeout(timer);
          closeEventStreams.delete(close);
          request.off("close", close);
          if (!response.writableEnded) response.end();
        };
        const writeEvent = (runtime: StudioRuntimeStatus) => {
          const event = StudioEventSchema.parse({
            protocolVersion: STUDIO_PROTOCOL_VERSION,
            sequence: ++eventSequence,
            kind: "runtime-status",
            runtime,
          });
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const schedule = () => {
          timer = setTimeout(() => {
            void dependencies.runtimeStatus()
              .then((runtime) => {
                if (closed) return;
                writeEvent(runtime);
                schedule();
              })
              .catch(close);
          }, RUNTIME_EVENT_INTERVAL_MS);
          timer.unref();
        };

        closeEventStreams.add(close);
        request.once("close", close);
        writeEvent(firstRuntime);
        schedule();
        return;
      }

      if (dependencies.fallback && await dependencies.fallback(request, response)) {
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        serveIndex(response, dependencies.indexHtml);
        return;
      }

      writeJson(response, 404, {
        error: { code: "STUDIO_REQUEST_INVALID" },
      });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      writeJson(response, statusFor(error), {
        error: {
          code: errorCode(error),
          ...(error instanceof StudioError ? {
            message: error.message,
            ...(error.nextAction ? { nextAction: error.nextAction } : {}),
          } : {}),
        },
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new StudioError(
      "INTERNAL",
      "Studio loopback address is unavailable",
    );
  }
  origin = `http://127.0.0.1:${address.port}`;

  let closePromise: Promise<void> | null = null;

  return {
    origin,
    bootstrapUrl: `${origin}/#bootstrap=${session.bootstrapToken}`,
    httpServer: server,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolve, reject) => {
        for (const closeStream of [...closeEventStreams]) closeStream();
        server.close((error) => error ? reject(error) : resolve());
      });
      return closePromise;
    },
  };
}
