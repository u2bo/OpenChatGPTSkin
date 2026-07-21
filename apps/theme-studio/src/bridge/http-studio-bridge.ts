import {
  StudioApplyResultSchema,
  StudioBootstrapSchema,
  StudioDraftSchema,
  StudioDeleteThemeInputSchema,
  StudioError,
  StudioEventSchema,
  StudioExportedThemeSchema,
  StudioRuntimeStatusSchema,
  StudioSaveResultSchema,
  StudioThemeLibrarySchema,
  type StudioBridge,
  type StudioDraftCommandInput,
  type StudioThemeRef,
} from "@open-chatgpt-skin/theme-studio-core";
import type { z } from "zod";

type FetchLike = typeof fetch;

export function bootstrapTokenFromLocation(location: URL): string {
  const token = new URLSearchParams(location.hash.slice(1)).get("bootstrap");
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    throw new StudioError(
      "STUDIO_SESSION_INVALID",
      "Bootstrap URL is invalid",
    );
  }
  return token;
}

export async function establishStudioSession(
  location: URL,
  replaceLocation: (url: string) => void,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (location.hash === "") return;
  const response = await fetchImpl("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: bootstrapTokenFromLocation(location) }),
  });
  if (!response.ok) {
    throw new StudioError(
      "STUDIO_SESSION_INVALID",
      "Session exchange failed",
    );
  }
  replaceLocation(`${location.origin}${location.pathname}${location.search}`);
}

async function responseError(response: Response): Promise<StudioError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new StudioError("INTERNAL", `Studio request failed (${response.status})`);
  }
  const value = body as {
    readonly error?: {
      readonly code?: string;
      readonly message?: string;
      readonly nextAction?: string;
    };
  };
  const code = value.error?.code;
  return new StudioError(
    code && [
      "STUDIO_SESSION_INVALID",
      "STUDIO_ORIGIN_REJECTED",
      "STUDIO_REQUEST_TOO_LARGE",
      "STUDIO_REQUEST_INVALID",
      "STUDIO_DRAFT_NOT_FOUND",
      "STUDIO_DRAFT_CONFLICT",
      "STUDIO_DRAFT_INVALID",
      "STUDIO_ASSET_INVALID",
      "STUDIO_IMPORT_INVALID",
      "STUDIO_EXPORT_INVALID",
      "STUDIO_DELETE_FAILED",
      "STUDIO_SAVE_FAILED",
      "STUDIO_APPLY_FAILED",
      "RUNTIME_STATUS_UNAVAILABLE",
      "INTERNAL",
    ].includes(code)
      ? code as StudioError["code"]
      : "INTERNAL",
    value.error?.message ?? `Studio request failed (${response.status})`,
    value.error?.nextAction,
  );
}

async function jsonRequest<Schema extends z.ZodTypeAny>(
  fetchImpl: FetchLike,
  path: string,
  schema: Schema,
  init?: RequestInit,
): Promise<z.output<Schema>> {
  const response = await fetchImpl(path, {
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok) throw await responseError(response);
  return schema.parse(await response.json());
}

function jsonMutation(method: "POST" | "PUT", body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  };
}

function draftCommandPath(
  input: StudioDraftCommandInput,
  command: "undo" | "redo" | "save" | "apply",
): { readonly path: string; readonly init: RequestInit } {
  return {
    path: `/api/drafts/${encodeURIComponent(input.draftId)}/${command}`,
    init: jsonMutation("POST", { expectedRevision: input.expectedRevision }),
  };
}

export function createHttpStudioBridge(
  fetchImpl: FetchLike = fetch,
): StudioBridge {
  return {
    bootstrap: () => jsonRequest(fetchImpl, "/api/bootstrap", StudioBootstrapSchema),
    listThemes: () => jsonRequest(fetchImpl, "/api/themes", StudioThemeLibrarySchema),
    createDraft: (input) => jsonRequest(
      fetchImpl,
      "/api/drafts",
      StudioDraftSchema,
      jsonMutation("POST", input),
    ),
    openLatestDraft: () => jsonRequest(
      fetchImpl,
      "/api/drafts/latest",
      StudioDraftSchema.nullable(),
    ),
    openDraft: (draftId) => jsonRequest(
      fetchImpl,
      `/api/drafts/${encodeURIComponent(draftId)}`,
      StudioDraftSchema,
    ),
    updateDraft: ({ draftId, ...input }) => jsonRequest(
      fetchImpl,
      `/api/drafts/${encodeURIComponent(draftId)}`,
      StudioDraftSchema,
      jsonMutation("PUT", input),
    ),
    undo: (input) => {
      const request = draftCommandPath(input, "undo");
      return jsonRequest(fetchImpl, request.path, StudioDraftSchema, request.init);
    },
    redo: (input) => {
      const request = draftCommandPath(input, "redo");
      return jsonRequest(fetchImpl, request.path, StudioDraftSchema, request.init);
    },
    async uploadAsset(input) {
      const query = new URLSearchParams({
        revision: String(input.expectedRevision),
        slot: input.slot,
        ...(input.assetKey ? { assetKey: input.assetKey } : {}),
      });
      return jsonRequest(
        fetchImpl,
        `/api/drafts/${encodeURIComponent(input.draftId)}/assets?${query}`,
        StudioDraftSchema,
        {
          method: "POST",
          headers: {
            "Content-Type": input.mimeType || "application/octet-stream",
            "X-File-Name": encodeURIComponent(input.fileName),
          },
          body: input.bytes as BodyInit,
        },
      );
    },
    validateDraft: (draftId) => jsonRequest(
      fetchImpl,
      `/api/drafts/${encodeURIComponent(draftId)}/validate`,
      StudioDraftSchema,
      jsonMutation("POST"),
    ),
    saveVersion: (input) => {
      const request = draftCommandPath(input, "save");
      return jsonRequest(fetchImpl, request.path, StudioSaveResultSchema, request.init);
    },
    importTheme: (input) => jsonRequest(
      fetchImpl,
      "/api/import",
      StudioDraftSchema,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.open-chatgpt-skin+zip",
          "X-File-Name": encodeURIComponent(input.fileName),
        },
        body: input.bytes as BodyInit,
      },
    ),
    async exportTheme(ref: StudioThemeRef) {
      const query = new URLSearchParams(ref);
      const response = await fetchImpl(`/api/export?${query}`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw await responseError(response);
      return StudioExportedThemeSchema.parse({
        fileName: `${ref.id}-${ref.version}.ocskin`,
        mimeType: "application/vnd.open-chatgpt-skin+zip",
        bytes: new Uint8Array(await response.arrayBuffer()),
      });
    },
    deletePersonalTheme: (input) => {
      const parsed = StudioDeleteThemeInputSchema.parse(input);
      const query = parsed.version
        ? `?version=${encodeURIComponent(parsed.version)}`
        : "";
      return jsonRequest(
        fetchImpl,
        `/api/themes/${encodeURIComponent(parsed.id)}${query}`,
        StudioThemeLibrarySchema,
        { method: "DELETE" },
      );
    },
    applySavedTheme: (ref) => jsonRequest(
      fetchImpl,
      "/api/themes/apply",
      StudioRuntimeStatusSchema,
      jsonMutation("POST", ref),
    ),
    applyTheme: (input) => {
      const request = draftCommandPath(input, "apply");
      return jsonRequest(fetchImpl, request.path, StudioApplyResultSchema, request.init);
    },
    restoreRuntime: () => jsonRequest(
      fetchImpl,
      "/api/runtime/restore",
      StudioRuntimeStatusSchema,
      jsonMutation("POST"),
    ),
    getRuntimeStatus: () => jsonRequest(
      fetchImpl,
      "/api/runtime",
      StudioRuntimeStatusSchema,
    ),
    subscribeEvents(listener) {
      const source = new EventSource("/api/events", { withCredentials: true });
      source.onmessage = (message) => {
        listener(StudioEventSchema.parse(JSON.parse(message.data)));
      };
      return () => source.close();
    },
  };
}
