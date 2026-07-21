export const STUDIO_ERROR_CODES = [
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
] as const;

export type StudioErrorCode = typeof STUDIO_ERROR_CODES[number];

export class StudioError extends Error {
  constructor(
    public readonly code: StudioErrorCode,
    message: string,
    public readonly nextAction?: string,
  ) {
    super(message);
    this.name = "StudioError";
  }
}
