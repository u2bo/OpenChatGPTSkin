import { z } from "zod";
import { ThemeIdSchema, ThemeVersionSchema } from "@open-chatgpt-skin/theme-schema";

export const CONTROL_PROTOCOL_VERSION = 1 as const;
export const CONTROL_MAX_FRAME_BYTES = 64 * 1024;
export const CONTROL_COMMANDS = ["launch", "status", "switch", "pause", "resume", "restore"] as const;

export const RUNTIME_ERROR_CODES = [
  "CODEX_NOT_INSTALLED", "CODEX_DISCOVERY_REQUIRES_BOOTSTRAP", "CODEX_IDENTITY_INVALID",
  "CODEX_ALREADY_RUNNING_UNMANAGED", "CODEX_LAUNCH_FAILED", "CODEX_WINDOW_ACTIVATION_FAILED",
  "PROCESS_INSPECTION_DENIED", "CDP_NOT_READY", "CDP_ENDPOINT_UNSAFE", "CDP_PROCESS_MISMATCH",
  "CDP_TARGET_NOT_FOUND", "CDP_TARGET_AMBIGUOUS", "ADAPTER_INCOMPATIBLE", "THEME_APPLY_FAILED",
  "THEME_VERIFY_FAILED", "THEME_CLEANUP_FAILED", "THEME_SWITCH_FAILED", "THEME_ROLLBACK_FAILED",
  "THEME_RUNTIME_TOO_LARGE", "THEME_SCHEMA_VERSION_UNSUPPORTED", "THEME_WELCOME_INVALID",
  "THEME_DISPLAY_FONT_MISSING", "THEME_COMPOSITION_INVALID", "THEME_HOME_WELCOME_UNSUPPORTED",
  "THEME_REQUIRED_LAYER_UNRESOLVED", "THEME_NOT_FOUND", "THEME_NOT_READY", "RUNTIME_SESSION_STALE",
  "RUNTIME_INVALID_STATE", "RUNTIME_BUSY", "RUNTIME_ENVIRONMENT_INVALID", "RUNTIME_CONTROL_UNAVAILABLE",
  "RESTORE_AWAITING_EXIT", "PROBE_EXIT_PENDING", "PROBE_FINALIZE_REQUIRED",
  "PROBE_PENDING_SESSION_INVALID", "INTERNAL",
] as const;

export const RuntimeStatusSchema = z.enum([
  "launching", "active", "paused", "paused-incompatible", "recovery-required", "restoring",
  "restored-awaiting-exit", "restored-cleanup-required",
]);
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const RuntimeOperationSchema = z.enum(["launch", "switch", "pause", "resume", "restore"]);
export const RuntimeThemeRefSchema = z.object({ id: ThemeIdSchema, version: ThemeVersionSchema }).strict();
export type RuntimeThemeRef = z.infer<typeof RuntimeThemeRefSchema>;
export const PendingOperationSchema = z.object({
  kind: RuntimeOperationSchema,
  requestId: z.string().uuid(),
  startedAt: z.string().datetime(),
  previousStatus: RuntimeStatusSchema.nullable(),
  previousSelectedTheme: RuntimeThemeRefSchema.nullable(),
  previousAppliedTheme: RuntimeThemeRefSchema.nullable(),
  candidateTheme: RuntimeThemeRefSchema.nullable(),
}).strict();
export const RuntimeProcessSchema = z.object({ pid: z.number().int().positive(), startedAt: z.string().datetime() }).strict();
export const RuntimeCodexIdentitySchema = z.object({
  rootPid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  executablePath: z.string().min(1),
  packageRoot: z.string().min(1),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
}).strict();
export const RuntimeCdpIdentitySchema = z.object({
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65_535),
}).strict();
export const RuntimeAdapterIdentitySchema = z.object({ id: z.string().min(1), version: z.literal(1) }).strict();

export const ControlCommandSchema = z.enum(CONTROL_COMMANDS);
export const RuntimeStatusViewSchema = z.object({
  status: z.union([RuntimeStatusSchema, z.literal("stopped")]),
  controllerAvailable: z.boolean(),
  selectedTheme: RuntimeThemeRefSchema.nullable(),
  appliedTheme: RuntimeThemeRefSchema.nullable(),
  skinApplied: z.boolean().nullable(),
  packageVersion: z.string().max(40).nullable(),
  operation: RuntimeOperationSchema.nullable(),
  nextAction: z.string().max(500),
}).strict();
export const ControlErrorSchema = z.object({
  code: z.enum(RUNTIME_ERROR_CODES),
  message: z.string().min(1).max(500),
  nextAction: z.string().max(500).optional(),
}).strict();
export const ControlResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION), requestId: z.string().uuid(),
    ok: z.literal(true), result: RuntimeStatusViewSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION), requestId: z.string().uuid(),
    ok: z.literal(false), error: ControlErrorSchema,
  }).strict(),
]);

const emptyParams = z.object({}).strict();
const RUNTIME_BUILTIN_THEME_IDS = new Set([
  "future-idol-cyan", "glacier-aurora", "mountain-mist", "rose-carpet-star", "yua-mikami-starlight",
]);
const themeParams = z.object({ themeId: ThemeIdSchema, themeVersion: ThemeVersionSchema.optional() }).strict()
  .superRefine((value, context) => {
    if (value.themeVersion === undefined && !RUNTIME_BUILTIN_THEME_IDS.has(value.themeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["themeVersion"],
        message: "personal themes require an exact version",
      });
    }
  });
export const ControlRequestSchema = z.discriminatedUnion("command", [
  z.object({ protocolVersion: z.literal(1), requestId: z.string().uuid(), command: z.literal("launch"), params: themeParams }).strict(),
  z.object({ protocolVersion: z.literal(1), requestId: z.string().uuid(), command: z.literal("status"), params: emptyParams }).strict(),
  z.object({ protocolVersion: z.literal(1), requestId: z.string().uuid(), command: z.literal("switch"), params: themeParams }).strict(),
  z.object({ protocolVersion: z.literal(1), requestId: z.string().uuid(), command: z.literal("pause"), params: emptyParams }).strict(),
  z.object({ protocolVersion: z.literal(1), requestId: z.string().uuid(), command: z.literal("resume"), params: emptyParams }).strict(),
  z.object({ protocolVersion: z.literal(1), requestId: z.string().uuid(), command: z.literal("restore"), params: emptyParams }).strict(),
]);

export const RecentRequestSchema = z.object({
  requestId: z.string().uuid(), command: ControlCommandSchema, response: ControlResponseSchema,
  completedAt: z.string().datetime(),
}).strict();

function sameTheme(left: RuntimeThemeRef | null, right: RuntimeThemeRef | null): boolean {
  return left !== null && right !== null && left.id === right.id && left.version === right.version;
}

export const RuntimeSessionStateSchema = z.object({
  schemaVersion: z.literal(2),
  sessionId: z.string().uuid(),
  status: RuntimeStatusSchema,
  runtime: RuntimeProcessSchema,
  codex: RuntimeCodexIdentitySchema.nullable(),
  cdp: RuntimeCdpIdentitySchema.nullable(),
  adapter: RuntimeAdapterIdentitySchema.nullable(),
  selectedTheme: RuntimeThemeRefSchema,
  appliedTheme: RuntimeThemeRefSchema.nullable(),
  skinApplied: z.boolean().nullable(),
  pendingOperation: PendingOperationSchema.nullable(),
  recentRequests: z.array(RecentRequestSchema).max(32),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((state, context) => {
  const issue = (message: string, path: (string | number)[] = []) =>
    context.addIssue({ code: z.ZodIssueCode.custom, message, path });
  if (state.status === "active") {
    if (!state.codex || !state.cdp || !state.adapter) issue("active state requires complete managed identities");
    if (state.skinApplied !== true || !sameTheme(state.selectedTheme, state.appliedTheme)) {
      issue("active state requires the selected theme to be verified as applied");
    }
  }
  if (state.status !== "launching" && (!state.codex || !state.cdp)) issue(`${state.status} requires exact Codex and CDP identities`);
  if (["active", "paused", "paused-incompatible"].includes(state.status) && !state.adapter) issue(`${state.status} requires the last verified Adapter identity`);
  if (["paused", "paused-incompatible", "restored-awaiting-exit", "restored-cleanup-required"].includes(state.status) &&
    (state.appliedTheme !== null || state.skinApplied !== false)) issue(`${state.status} requires verified official appearance`);
  if (state.status === "recovery-required" && (state.appliedTheme !== null || state.skinApplied !== null)) issue("recovery-required must represent unknown appearance");
  if (state.status === "restoring" && state.pendingOperation?.kind !== "restore") issue("restoring requires a restore pending operation");
  const requests = new Map<string, string>();
  state.recentRequests.forEach((record, index) => {
    if (record.response.requestId !== record.requestId) issue("recent response request ID must match its record", ["recentRequests", index]);
    const previous = requests.get(record.requestId);
    if (previous && previous !== record.command) issue("recent request IDs cannot belong to different commands", ["recentRequests", index]);
    requests.set(record.requestId, record.command);
  });
});

export const ControllerLockRecordSchema = z.object({
  schemaVersion: z.literal(1), pid: z.number().int().positive(), startedAt: z.string().datetime(),
}).strict();

export const TrustedWindowsCodexInstallSchema = z.object({
  schemaVersion: z.literal(1), packageRoot: z.string().min(1), entryPath: z.string().min(1),
  identityName: z.literal("OpenAI.Codex"), packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  packagePublisher: z.string().min(1), appId: z.literal("App"), entryRelativePath: z.literal("app/ChatGPT.exe"),
  entryPoint: z.literal("Windows.FullTrustApplication"), packageSignatureStatus: z.literal("Valid"),
  packageSignerCommonName: z.literal("50BDFD77-8903-4850-9FFE-6E8522F64D5B"), catalogSignatureStatus: z.literal("Valid"),
  catalogSignerCommonName: z.literal("50BDFD77-8903-4850-9FFE-6E8522F64D5B"), entryBlockMapValid: z.literal(true),
  resourceSignatureStatus: z.literal("Valid"), resourceSignerCommonName: z.literal("OpenAI OpCo, LLC"),
  verifiedAt: z.string().datetime(),
}).strict();
export const TrustedMacOsCodexInstallSchema = z.object({
  schemaVersion: z.literal(1), packageRoot: z.string().endsWith("/Codex.app"), entryPath: z.string().min(1),
  identityName: z.literal("OpenAI.Codex"), packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  packagePublisher: z.literal("2DC432GLL2"), appId: z.literal("com.openai.codex"),
  entryRelativePath: z.string().regex(/^Contents\/MacOS\/[^/]+$/), entryPoint: z.literal("macOS.Application"),
  packageSignatureStatus: z.literal("Valid"), packageSignerCommonName: z.literal("2DC432GLL2"),
  catalogSignatureStatus: z.literal("Valid"), catalogSignerCommonName: z.literal("Notarized Developer ID"),
  entryBlockMapValid: z.literal(true), resourceSignatureStatus: z.literal("Valid"),
  resourceSignerCommonName: z.literal("OpenAI, L.L.C."), verifiedAt: z.string().datetime(),
}).strict();
export const TrustedCodexInstallSchema = z.union([TrustedWindowsCodexInstallSchema, TrustedMacOsCodexInstallSchema]);

export const RUNTIME_STATE_TRANSITIONS: Readonly<Record<RuntimeStatus, readonly RuntimeStatus[]>> = {
  launching: ["launching", "active", "recovery-required", "restored-awaiting-exit"],
  active: ["active", "paused", "paused-incompatible", "recovery-required", "restoring"],
  paused: ["paused", "active", "paused-incompatible", "recovery-required", "restoring"],
  "paused-incompatible": ["paused-incompatible", "paused", "active", "recovery-required", "restoring"],
  "recovery-required": ["recovery-required", "restoring"],
  restoring: ["restoring", "active", "recovery-required", "restored-awaiting-exit"],
  "restored-awaiting-exit": ["restored-awaiting-exit", "restored-cleanup-required"],
  "restored-cleanup-required": ["restored-cleanup-required"],
};

export const RUNTIME_RECOVERY_SEMANTIC_CASES = [
  { name: "stable active appearance", valid: true, sourceStatus: "active", expectedStatus: "active" },
  { name: "stable paused appearance", valid: true, sourceStatus: "paused", expectedStatus: "paused" },
  { name: "interrupted launch restores official appearance", valid: true, operation: "launch", expectedStatus: "restored-awaiting-exit" },
  { name: "interrupted restore retries official appearance", valid: true, operation: "restore", expectedStatus: "restored-awaiting-exit" },
  { name: "failed cleanup marks appearance unknown", valid: true, cleanupSucceeded: false, expectedStatus: "recovery-required" },
  { name: "managed process identity changed", valid: false, expectedErrorCode: "RUNTIME_SESSION_STALE", expectedPath: "/codex/startedAt" },
] as const;

export const RUNTIME_CONTROL_CONTRACT = {
  protocolVersion: CONTROL_PROTOCOL_VERSION,
  frame: { encoding: "json", byteOrder: "little-endian", lengthPrefixBytes: 4, maxPayloadBytes: CONTROL_MAX_FRAME_BYTES },
  commands: CONTROL_COMMANDS,
  readOnlyCommands: ["status"], mutationConcurrency: "serialized", statusConcurrency: "parallel-with-mutation",
  requestIdSemantics: "same-id-same-command-replays; same-id-different-command-rejected",
  afterResponseCommands: ["launch", "restore"], errors: RUNTIME_ERROR_CODES,
} as const;

export const RUNTIME_CONTROL_SEMANTIC_CASES = [
  { name: "status during mutation", valid: true, command: "status", expectedConcurrency: "parallel-with-mutation" },
  { name: "duplicate request replay", valid: true, command: "switch", expectedBehavior: "replay-stored-response" },
  { name: "request ID reused for another command", valid: false, command: "pause", expectedErrorCode: "RUNTIME_INVALID_STATE", expectedPath: "/requestId" },
  { name: "oversized frame", valid: false, expectedErrorCode: "RUNTIME_CONTROL_UNAVAILABLE", expectedPath: "/frame/length" },
  { name: "restore callback after response", valid: true, command: "restore", expectedBehavior: "after-response" },
  { name: "personal theme without version", valid: false, command: "launch", expectedErrorCode: "THEME_NOT_FOUND", expectedPath: "/params/themeVersion" },
] as const;
