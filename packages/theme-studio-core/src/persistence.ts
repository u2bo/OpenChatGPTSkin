import { z } from "zod";
import { ThemeDraftDocumentSchema } from "@open-chatgpt-skin/theme-schema";
import { StudioThemeRefSchema } from "./contracts.js";

export const STUDIO_DRAFT_HISTORY_LIMIT = 50;

export const DraftRecordSchema = z.object({
  schemaVersion: z.literal(1),
  draftId: z.string().uuid(),
  theme: ThemeDraftDocumentSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  savedRef: StudioThemeRefSchema.nullable(),
  dirty: z.boolean(),
  past: z.array(ThemeDraftDocumentSchema).max(STUDIO_DRAFT_HISTORY_LIMIT),
  future: z.array(ThemeDraftDocumentSchema).max(STUDIO_DRAFT_HISTORY_LIMIT),
}).strict();

export const PersistedDraftRecordSchema = DraftRecordSchema.omit({ theme: true, past: true, future: true }).extend({
  theme: z.unknown(),
  past: z.array(z.unknown()).max(STUDIO_DRAFT_HISTORY_LIMIT),
  future: z.array(z.unknown()).max(STUDIO_DRAFT_HISTORY_LIMIT),
}).strict();

export type DraftRecord = z.infer<typeof DraftRecordSchema>;
