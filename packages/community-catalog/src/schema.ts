import { z } from "zod";
import { ThemeIdSchema, ThemeVersionSchema } from "@open-chatgpt-skin/theme-schema";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const productVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/);
const httpsUrl = z.string().url().startsWith("https://");
const localizedText = z.object({
  "zh-CN": z.string().trim().min(1).max(2000),
  en: z.string().trim().min(1).max(2000),
}).strict();
const localizedMetadata = z.object({
  "zh-CN": z.object({
    name: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(2000),
  }).strict(),
  en: z.object({
    name: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(2000),
  }).strict(),
}).strict();

export const COMMUNITY_CATALOG_VERSION = 1 as const;
export const CommunitySupportStatusSchema = z.enum([
  "verified",
  "needs-reverification",
  "incompatible",
  "yanked",
]);

export const CommunityMediaSchema = z.object({
  kind: z.enum(["cover", "home", "task", "conversation", "light", "dark"]),
  url: httpsUrl,
  contentType: z.literal("image/webp"),
  bytes: z.number().int().positive().max(4 * 1024 * 1024),
  sha256,
  width: z.number().int().min(1200).max(3840),
  height: z.number().int().min(675).max(2160),
}).strict();

export const CommunityArchiveSchema = z.object({
  url: httpsUrl,
  bytes: z.number().int().positive().max(32 * 1024 * 1024),
  sha256,
}).strict();

export const CommunityThemeVersionSchema = z.object({
  version: ThemeVersionSchema,
  themeSchemaVersion: z.literal(4),
  minimumAppVersion: productVersion,
  lastVerifiedAppVersion: productVersion,
  supportStatus: CommunitySupportStatusSchema,
  releasedAt: z.string().datetime(),
  changelog: localizedText,
  preview: CommunityMediaSchema.refine((media) => media.kind === "cover" && media.bytes <= 2 * 1024 * 1024),
  screenshots: z.array(CommunityMediaSchema).min(2).max(8),
  archive: CommunityArchiveSchema.nullable(),
  yankedReason: localizedText.nullable(),
}).strict();

export const CommunityThemeEntrySchema = z.object({
  id: ThemeIdSchema,
  localized: localizedMetadata,
  author: z.object({
    name: z.string().trim().min(1).max(80),
    github: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
    homepage: httpsUrl.nullable(),
  }).strict(),
  tags: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1).max(12),
  featured: z.boolean(),
  latestVersion: ThemeVersionSchema.nullable(),
  rightsDeclaration: z.literal("author-self-declared"),
  versions: z.array(CommunityThemeVersionSchema).min(1),
}).strict();

export const CommunityCatalogSchema = z.object({
  schemaVersion: z.literal(COMMUNITY_CATALOG_VERSION),
  catalogRevision: z.string().regex(/^[a-f0-9]{40}$/),
  themes: z.array(CommunityThemeEntrySchema),
}).strict();

export type CommunitySupportStatus = z.infer<typeof CommunitySupportStatusSchema>;
export type CommunityThemeVersion = z.infer<typeof CommunityThemeVersionSchema>;
export type CommunityThemeEntry = z.infer<typeof CommunityThemeEntrySchema>;
export type CommunityCatalog = z.infer<typeof CommunityCatalogSchema>;
