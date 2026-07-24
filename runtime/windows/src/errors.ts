export const RUNTIME_THEME_PACKAGE_ERROR_CODES = [
  "THEME_SCHEMA_VERSION_UNSUPPORTED",
  "THEME_WELCOME_INVALID",
  "THEME_DISPLAY_FONT_MISSING",
  "THEME_COMPOSITION_INVALID",
] as const;

export const RUNTIME_THEME_SURFACE_ERROR_CODES = [
  "THEME_HOME_WELCOME_UNSUPPORTED",
  "THEME_REQUIRED_LAYER_UNRESOLVED",
] as const;

export const RUNTIME_ERROR_CODES = [
  "CODEX_NOT_INSTALLED",
  "CODEX_DISCOVERY_REQUIRES_BOOTSTRAP",
  "CODEX_IDENTITY_INVALID",
  "CODEX_ALREADY_RUNNING_UNMANAGED",
  "CODEX_LAUNCH_FAILED",
  "CODEX_WINDOW_ACTIVATION_FAILED",
  "PROCESS_INSPECTION_DENIED",
  "CDP_NOT_READY",
  "CDP_ENDPOINT_UNSAFE",
  "CDP_PROCESS_MISMATCH",
  "CDP_TARGET_NOT_FOUND",
  "CDP_TARGET_AMBIGUOUS",
  "ADAPTER_INCOMPATIBLE",
  "THEME_APPLY_FAILED",
  "THEME_VERIFY_FAILED",
  "THEME_CLEANUP_FAILED",
  "THEME_SWITCH_FAILED",
  "THEME_ROLLBACK_FAILED",
  "THEME_RUNTIME_TOO_LARGE",
  ...RUNTIME_THEME_PACKAGE_ERROR_CODES,
  ...RUNTIME_THEME_SURFACE_ERROR_CODES,
  "THEME_NOT_FOUND",
  "THEME_NOT_READY",
  "RUNTIME_SESSION_STALE",
  "RUNTIME_INVALID_STATE",
  "RUNTIME_BUSY",
  "RUNTIME_ENVIRONMENT_INVALID",
  "RUNTIME_CONTROL_UNAVAILABLE",
  "RESTORE_AWAITING_EXIT",
  "PROBE_EXIT_PENDING",
  "PROBE_FINALIZE_REQUIRED",
  "PROBE_PENDING_SESSION_INVALID",
  "INTERNAL",
] as const;

export type RuntimeErrorCode = typeof RUNTIME_ERROR_CODES[number];

function includesRuntimeCode(
  codes: readonly string[],
  value: RuntimeErrorCode,
): boolean {
  return codes.includes(value);
}

export function isRuntimeThemePackageErrorCode(value: RuntimeErrorCode): boolean {
  return includesRuntimeCode(RUNTIME_THEME_PACKAGE_ERROR_CODES, value);
}

export function isRuntimeThemeSurfaceErrorCode(value: RuntimeErrorCode): boolean {
  return includesRuntimeCode(RUNTIME_THEME_SURFACE_ERROR_CODES, value);
}

export function isRuntimeThemeV4ErrorCode(value: RuntimeErrorCode): boolean {
  return isRuntimeThemePackageErrorCode(value) || isRuntimeThemeSurfaceErrorCode(value);
}

export function isRuntimeErrorCode(value: unknown): value is RuntimeErrorCode {
  return typeof value === "string" &&
    (RUNTIME_ERROR_CODES as readonly string[]).includes(value);
}

export function runtimeErrorCode(error: unknown): RuntimeErrorCode {
  if (error && typeof error === "object" && "code" in error &&
    isRuntimeErrorCode((error as { readonly code?: unknown }).code)) {
    return (error as { readonly code: RuntimeErrorCode }).code;
  }
  return "INTERNAL";
}

export class RuntimeError extends Error {
  constructor(
    public readonly code: RuntimeErrorCode,
    message: string,
    public readonly nextAction?: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}
