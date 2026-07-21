import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ThemeIdSchema, ThemeVersionSchema } from "@open-chatgpt-skin/theme-schema";

const catalogPath = z.string().regex(/^(?:builtin|recipes)\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
const previewPath = z.string().regex(/^builtin\/[a-z0-9]+(?:-[a-z0-9]+)*\/preview\.webp$/);

export const ThemeCatalogEntrySchema = z.object({
  id: ThemeIdSchema,
  name: z.string().trim().min(1).max(80),
  version: ThemeVersionSchema,
  kind: z.enum(["theme", "recipe"]),
  path: catalogPath,
  ready: z.boolean(),
  localOnly: z.boolean(),
  licenseId: z.string().trim().min(1).max(100),
  preview: z.string().optional(),
}).strict().superRefine((entry, context) => {
  const expectedPath = `${entry.kind === "theme" ? "builtin" : "recipes"}/${entry.id}`;
  if (entry.path !== expectedPath) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["path"],
      message: "catalog path must match kind and id",
    });
  }

  if (entry.kind === "theme") {
    const expectedPreview = `builtin/${entry.id}/preview.webp`;
    if (
      !entry.ready ||
      entry.localOnly ||
      entry.preview !== expectedPreview ||
      !previewPath.safeParse(entry.preview).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "public theme catalog entry is inconsistent",
      });
    }
    return;
  }

  if (entry.ready || !entry.localOnly || entry.preview) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "local recipe catalog entry is inconsistent",
    });
  }
});

export const ThemeCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  builtins: z.array(ThemeCatalogEntrySchema),
  recipes: z.array(ThemeCatalogEntrySchema),
}).strict().superRefine((catalog, context) => {
  const ids = [...catalog.builtins, ...catalog.recipes].map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "catalog IDs must be unique" });
  }
  if (
    catalog.builtins.some((entry) => entry.kind !== "theme") ||
    catalog.recipes.some((entry) => entry.kind !== "recipe")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "catalog collections must match entry kinds",
    });
  }
});

export type ThemeCatalogEntry = z.infer<typeof ThemeCatalogEntrySchema>;
export type ThemeCatalog = z.infer<typeof ThemeCatalogSchema>;

export async function loadThemeCatalog(root: string): Promise<ThemeCatalog> {
  const text = await readFile(join(root, "catalog.json"), "utf8");
  return ThemeCatalogSchema.parse(JSON.parse(text));
}
