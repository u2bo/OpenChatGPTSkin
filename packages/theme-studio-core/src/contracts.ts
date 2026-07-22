import { z } from "zod";
import {
  ThemeDraftDocumentSchema,
  ThemeIdSchema,
  ThemeVersionSchema,
} from "@open-chatgpt-skin/theme-schema";
import { PRODUCT_VERSION_PATTERN } from "./security.js";

export const STUDIO_PROTOCOL_VERSION = 2 as const;

export const StudioThemeRefSchema = z.object({
  id: ThemeIdSchema,
  version: ThemeVersionSchema,
}).strict();

export const StudioRuntimeStatusSchema = z.object({
  status: z.enum([
    "stopped",
    "launching",
    "active",
    "paused",
    "paused-incompatible",
    "recovery-required",
    "restoring",
    "restored-awaiting-exit",
    "restored-cleanup-required",
  ]),
  controllerAvailable: z.boolean(),
  selectedTheme: StudioThemeRefSchema.nullable(),
  appliedTheme: StudioThemeRefSchema.nullable(),
  skinApplied: z.boolean().nullable(),
  packageVersion: z.string().max(40).nullable(),
  operation: z.enum(["launch", "switch", "pause", "resume", "restore"]).nullable(),
  nextAction: z.string().max(500),
}).strict();

export const StudioCapabilitySchema = z.enum([
  "studio-shell",
  "theme-library",
  "draft-editing",
  "asset-upload",
  "version-save",
  "theme-import-export",
  "theme-delete",
  "runtime-apply",
  "runtime-restore",
]);

export const StudioBootstrapSchema = z.object({
  protocolVersion: z.literal(STUDIO_PROTOCOL_VERSION),
  studioVersion: z.string().regex(PRODUCT_VERSION_PATTERN),
  repositoryUrl: z.string().url().startsWith("https://github.com/").nullable().default(null),
  capabilities: z.array(StudioCapabilitySchema),
  runtime: StudioRuntimeStatusSchema,
}).strict();

export const StudioThemeSourceSchema = z.enum(["builtin", "personal", "recipe"]);

export const StudioThemeListItemSchema = z.object({
  ref: StudioThemeRefSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  author: z.string().trim().min(1).max(80),
  homepage: z.string().url().startsWith("https://").nullable(),
  localized: z.record(z.enum(["zh-CN", "en"]), z.object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(240).optional(),
  }).strict()).optional(),
  source: StudioThemeSourceSchema,
  ready: z.boolean(),
  localOnly: z.boolean(),
  previewUrl: z.string().startsWith("/api/").nullable(),
}).strict();

export const StudioThemeLibrarySchema = z.object({
  themes: z.array(StudioThemeListItemSchema),
}).strict();

export const StudioValidationIssueSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]+$/),
  path: z.string().max(240),
  message: z.string().min(1).max(500),
  severity: z.enum(["error", "warning"]),
}).strict();

export const StudioDraftSchema = z.object({
  draftId: z.string().uuid(),
  theme: ThemeDraftDocumentSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  savedRef: StudioThemeRefSchema.nullable(),
  dirty: z.boolean(),
  undoAvailable: z.boolean(),
  redoAvailable: z.boolean(),
  issues: z.array(StudioValidationIssueSchema),
  assetUrls: z.record(z.string(), z.string().startsWith("/api/")),
}).strict();

export const StudioCreateDraftInputSchema = z.object({
  source: z.object({
    source: StudioThemeSourceSchema,
    ref: StudioThemeRefSchema,
  }).strict(),
  themeId: ThemeIdSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  conflictResolution: z.enum(["load-existing", "overwrite-existing"]).optional(),
}).strict();

export const StudioUpdateDraftInputSchema = z.object({
  draftId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  theme: ThemeDraftDocumentSchema,
}).strict();

export const StudioDraftCommandInputSchema = z.object({
  draftId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export const StudioDeleteThemeInputSchema = z.object({
  id: ThemeIdSchema,
  version: ThemeVersionSchema.optional(),
}).strict();

export const StudioInterfaceImageSlotSchema = z.enum([
  "profile-avatar",
  "suggestion-card1",
  "suggestion-card2",
  "suggestion-card3",
  "suggestion-card4",
]);

export const StudioAssetSlotSchema = z.enum([
  "background",
  "portrait",
  "decoration",
  "ui-font",
  "code-font",
  "profile-avatar",
  "suggestion-card1",
  "suggestion-card2",
  "suggestion-card3",
  "suggestion-card4",
]);

export const StudioUploadAssetInputSchema = StudioDraftCommandInputSchema.extend({
  slot: StudioAssetSlotSchema,
  assetKey: z.string().max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.string().trim().min(1).max(100),
  bytes: z.instanceof(Uint8Array),
}).strict();

export const StudioImportThemeInputSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  bytes: z.instanceof(Uint8Array),
}).strict();

export const StudioExportedThemeSchema = z.object({
  fileName: z.string().regex(/^[a-z0-9-]+-\d+\.\d+\.\d+\.ocskin$/),
  mimeType: z.literal("application/vnd.open-chatgpt-skin+zip"),
  bytes: z.instanceof(Uint8Array),
}).strict();

export const StudioSaveResultSchema = z.object({
  draft: StudioDraftSchema,
  ref: StudioThemeRefSchema,
}).strict();

export const StudioApplyResultSchema = z.object({
  draft: StudioDraftSchema,
  ref: StudioThemeRefSchema,
  runtime: StudioRuntimeStatusSchema,
}).strict();

export const StudioEventSchema = z.discriminatedUnion("kind", [
  z.object({
    protocolVersion: z.literal(STUDIO_PROTOCOL_VERSION),
    sequence: z.number().int().positive(),
    kind: z.literal("runtime-status"),
    runtime: StudioRuntimeStatusSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(STUDIO_PROTOCOL_VERSION),
    sequence: z.number().int().positive(),
    kind: z.literal("draft-updated"),
    draftId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
  }).strict(),
]);

export type StudioThemeRef = z.infer<typeof StudioThemeRefSchema>;
export type StudioRuntimeStatus = z.infer<typeof StudioRuntimeStatusSchema>;
export type StudioBootstrap = z.infer<typeof StudioBootstrapSchema>;
export type StudioThemeLibrary = z.infer<typeof StudioThemeLibrarySchema>;
export type StudioThemeListItem = z.infer<typeof StudioThemeListItemSchema>;
export type StudioDraft = z.infer<typeof StudioDraftSchema>;
export type StudioValidationIssue = z.infer<typeof StudioValidationIssueSchema>;
export type StudioCreateDraftInput = z.infer<typeof StudioCreateDraftInputSchema>;
export type StudioUpdateDraftInput = z.infer<typeof StudioUpdateDraftInputSchema>;
export type StudioDraftCommandInput = z.infer<typeof StudioDraftCommandInputSchema>;
export type StudioDeleteThemeInput = z.infer<typeof StudioDeleteThemeInputSchema>;
export type StudioUploadAssetInput = z.infer<typeof StudioUploadAssetInputSchema>;
export type StudioInterfaceImageSlot = z.infer<typeof StudioInterfaceImageSlotSchema>;
export type StudioImportThemeInput = z.infer<typeof StudioImportThemeInputSchema>;
export type StudioExportedTheme = z.infer<typeof StudioExportedThemeSchema>;
export type StudioSaveResult = z.infer<typeof StudioSaveResultSchema>;
export type StudioApplyResult = z.infer<typeof StudioApplyResultSchema>;
export type StudioEvent = z.infer<typeof StudioEventSchema>;

export interface StudioBridge {
  bootstrap(): Promise<StudioBootstrap>;
  listThemes(): Promise<StudioThemeLibrary>;
  createDraft(input: StudioCreateDraftInput): Promise<StudioDraft>;
  openLatestDraft(): Promise<StudioDraft | null>;
  openDraft(draftId: string): Promise<StudioDraft>;
  updateDraft(input: StudioUpdateDraftInput): Promise<StudioDraft>;
  undo(input: StudioDraftCommandInput): Promise<StudioDraft>;
  redo(input: StudioDraftCommandInput): Promise<StudioDraft>;
  uploadAsset(input: StudioUploadAssetInput): Promise<StudioDraft>;
  validateDraft(draftId: string): Promise<StudioDraft>;
  saveVersion(input: StudioDraftCommandInput): Promise<StudioSaveResult>;
  importTheme(input: StudioImportThemeInput): Promise<StudioDraft>;
  exportTheme(ref: StudioThemeRef): Promise<StudioExportedTheme>;
  deletePersonalTheme(input: StudioDeleteThemeInput): Promise<StudioThemeLibrary>;
  applySavedTheme(ref: StudioThemeRef): Promise<StudioRuntimeStatus>;
  applyTheme(input: StudioDraftCommandInput): Promise<StudioApplyResult>;
  restoreRuntime(): Promise<StudioRuntimeStatus>;
  getRuntimeStatus(): Promise<StudioRuntimeStatus>;
  subscribeEvents(listener: (event: StudioEvent) => void): () => void;
}
