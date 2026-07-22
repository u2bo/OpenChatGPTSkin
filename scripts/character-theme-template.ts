import { z } from "zod";
import { ThemeDraftDocumentSchema } from
  "../packages/theme-schema/src/index.js";

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_PATH_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

function isSafeSourcePath(value: string): boolean {
  if (!value || value.length > 240 || value !== value.normalize("NFC") ||
    value.includes("\\") || value.startsWith("/") || /^[a-z]:\//i.test(value)) {
    return false;
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." ||
    part.endsWith(".") || part.endsWith(" ") || WINDOWS_RESERVED_NAME.test(part) ||
    INVALID_PATH_CHARACTERS.test(part))) {
    return false;
  }
  return /\.(?:png|jpe?g|webp|woff2)$/i.test(value);
}

const SourcePathSchema = z.string().refine(
  isSafeSourcePath,
  "unsafe or unsupported source path",
);

const OutputPathSchema = z.string().refine(
  (value) => value === "preview.webp" ||
    /^(?:assets|fonts)\/[a-z0-9][a-z0-9./-]*\.(?:png|jpe?g|webp|woff2)$/i
      .test(value) && !value.includes(".."),
  "unsafe or unsupported output path",
);

export const CharacterThemeOutputSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    file: SourcePathSchema,
  }).strict(),
  z.object({
    kind: z.literal("background-crop"),
    positionX: z.number().min(0).max(1),
    positionY: z.number().min(0).max(1),
  }).strict(),
]);

export const SourceProvenanceSchema = z.object({
  file: SourcePathSchema,
  licenseId: z.string().min(1),
  attribution: z.string().min(1),
  source: z.string().min(1),
  generationPrompt: z.string().min(1).optional(),
}).strict();

export const CharacterThemeTemplateSchema = z.object({
  theme: ThemeDraftDocumentSchema,
  outputs: z.record(OutputPathSchema, CharacterThemeOutputSourceSchema),
  provenance: z.array(SourceProvenanceSchema).min(1),
}).strict();

export type CharacterThemeOutputSource = z.infer<
  typeof CharacterThemeOutputSourceSchema
>;
export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;
export type CharacterThemeTemplate = z.infer<typeof CharacterThemeTemplateSchema>;
