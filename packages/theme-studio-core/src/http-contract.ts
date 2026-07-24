export const STUDIO_SECURITY_HEADERS = [
  "Content-Security-Policy",
  "Cross-Origin-Opener-Policy",
  "Referrer-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
] as const;

export const STUDIO_BODY_LIMITS = {
  sessionJsonBytes: 16 * 1024,
  jsonBytes: 256 * 1024,
  imageBytes: 50 * 1024 * 1024,
  archiveBytes: 32 * 1024 * 1024,
} as const;

export const STUDIO_RESPONSE_POLICIES = {
  json: {
    contentType: "application/json; charset=utf-8",
    cacheControl: "no-store",
    contentTypeOptions: "nosniff",
  },
  binary: {
    contentType: "route-defined",
    cacheControl: "no-store",
    contentTypeOptions: "nosniff",
  },
  html: {
    contentType: "text/html; charset=utf-8",
    cacheControl: "no-store",
    contentTypeOptions: "nosniff",
  },
  sse: {
    contentType: "text/event-stream; charset=utf-8",
    cacheControl: "no-store",
    contentTypeOptions: "nosniff",
  },
} as const;

export const STUDIO_ROUTE_DEFINITIONS = [
  { id: "home", method: "GET", path: "/", successStatus: 200, response: "html", originRequired: false },
  { id: "session", method: "POST", path: "/api/session", successStatus: 204, request: "sessionExchange", response: "none", originRequired: true },
  { id: "bootstrap", method: "GET", path: "/api/bootstrap", successStatus: 200, response: "bootstrap", originRequired: false },
  { id: "themes", method: "GET", path: "/api/themes", successStatus: 200, response: "themeLibrary", originRequired: false },
  { id: "applySavedTheme", method: "POST", path: "/api/themes/apply", successStatus: 200, request: "themeRef", response: "applyResult", originRequired: true },
  { id: "deleteTheme", method: "DELETE", path: "/api/themes/{id}", successStatus: 200, request: "deleteTheme", response: "themeLibrary", originRequired: true },
  { id: "createDraft", method: "POST", path: "/api/drafts", successStatus: 201, request: "createDraft", response: "draft", originRequired: true },
  { id: "latestDraft", method: "GET", path: "/api/drafts/latest", successStatus: 200, response: "nullableDraft", originRequired: false },
  { id: "draft", method: "GET", path: "/api/drafts/{draftId}", successStatus: 200, response: "draft", originRequired: false },
  { id: "updateDraft", method: "PUT", path: "/api/drafts/{draftId}", successStatus: 200, request: "updateDraft", response: "draft", originRequired: true },
  { id: "undoDraft", method: "POST", path: "/api/drafts/{draftId}/undo", successStatus: 200, request: "draftCommand", response: "draft", originRequired: true },
  { id: "redoDraft", method: "POST", path: "/api/drafts/{draftId}/redo", successStatus: 200, request: "draftCommand", response: "draft", originRequired: true },
  { id: "validateDraft", method: "POST", path: "/api/drafts/{draftId}/validate", successStatus: 200, response: "draft", originRequired: true },
  { id: "saveDraft", method: "POST", path: "/api/drafts/{draftId}/save", successStatus: 200, request: "draftCommand", response: "saveResult", originRequired: true },
  { id: "applyDraft", method: "POST", path: "/api/drafts/{draftId}/apply", successStatus: 200, request: "draftCommand", response: "applyResult", originRequired: true },
  { id: "uploadAsset", method: "POST", path: "/api/drafts/{draftId}/assets", successStatus: 200, request: "binaryAsset", response: "draft", originRequired: true },
  { id: "importTheme", method: "POST", path: "/api/import", successStatus: 201, request: "binaryArchive", response: "draft", originRequired: true },
  { id: "exportTheme", method: "GET", path: "/api/export", successStatus: 200, request: "themeRefQuery", response: "binaryArchive", originRequired: false },
  { id: "runtime", method: "GET", path: "/api/runtime", successStatus: 200, response: "runtimeStatus", originRequired: false },
  { id: "restoreRuntime", method: "POST", path: "/api/runtime/restore", successStatus: 200, response: "runtimeStatus", originRequired: true },
  { id: "draftAsset", method: "GET", path: "/api/draft-asset", successStatus: 200, response: "binaryAsset", originRequired: false },
  { id: "themePreview", method: "GET", path: "/api/theme-preview", successStatus: 200, response: "binaryImage", originRequired: false },
  { id: "events", method: "GET", path: "/api/events", successStatus: 200, response: "sseRuntimeStatus", originRequired: false },
] as const;

export const STUDIO_HTTP_SEMANTIC_CASES = [
  { name: "authenticated bootstrap", valid: true, expectedStatus: 200 },
  { name: "one-time session exchange", valid: true, expectedStatus: 204 },
  { name: "reused bootstrap token", valid: false, expectedStatus: 401, expectedErrorCode: "STUDIO_SESSION_INVALID", expectedPath: "/api/session" },
  { name: "cross-origin mutation", valid: false, expectedStatus: 403, expectedErrorCode: "STUDIO_ORIGIN_REJECTED", expectedPath: "/headers/origin" },
  { name: "oversized binary upload", valid: false, expectedStatus: 413, expectedErrorCode: "STUDIO_REQUEST_TOO_LARGE", expectedPath: "/body" },
  { name: "binary export", valid: true, expectedStatus: 200, responseKind: "binary" },
  { name: "runtime status stream", valid: true, expectedStatus: 200, responseKind: "sse" },
] as const;

export type StudioRouteId = typeof STUDIO_ROUTE_DEFINITIONS[number]["id"];

export function isStudioRoute(
  id: StudioRouteId,
  method: string | undefined,
  path: string,
): boolean {
  const route = STUDIO_ROUTE_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!route) throw new Error(`Unknown Studio route: ${id}`);
  if (route.path.includes("{")) {
    throw new Error(`Parameterized Studio route requires explicit parsing: ${id}`);
  }
  return method === route.method && path === route.path;
}
