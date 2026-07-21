import { z } from "zod";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
const FONT_EXTENSIONS = [".woff2"] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const FUNCTION_COLOR = /^(rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_PATH_CHARACTERS = /[<>:"|?*\u0000-\u001f]/;

export const ThemeIdSchema = z.string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((value) => !WINDOWS_RESERVED_NAME.test(value), "theme ID is reserved on Windows");

export const ThemeVersionSchema = z.string()
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/);

export function isSafeThemePath(value: string): boolean {
  if (!value || value.length > 240 || value !== value.normalize("NFC") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  if (value.startsWith("/") || /^[a-z]:\//i.test(value)) return false;

  const parts = value.split("/");
  if (parts.some((part) =>
    !part ||
    part === "." ||
    part === ".." ||
    part.endsWith(".") ||
    part.endsWith(" ") ||
    WINDOWS_RESERVED_NAME.test(part) ||
    INVALID_PATH_CHARACTERS.test(part)
  )) {
    return false;
  }

  const lower = value.toLowerCase();
  if (IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))) return value.startsWith("assets/");
  if (FONT_EXTENSIONS.some((extension) => lower.endsWith(extension))) return value.startsWith("fonts/");
  return false;
}

const assetPath = z.string().refine(isSafeThemePath, "unsafe or unsupported theme asset path");
const imagePath = assetPath.refine(
  (value) => IMAGE_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension)),
  "theme image must be PNG, JPEG, or WebP",
);
const fontPath = assetPath.refine(
  (value) => FONT_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension)),
  "theme font must be WOFF2",
);
const assetKey = z.string().max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const httpsUrl = z.string().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "theme URL must use HTTPS",
);

export const ThemeLocaleSchema = z.enum(["zh-CN", "en"]);

export const ThemeMetadataSchema = z.object({
  homepage: httpsUrl.optional(),
  localized: z.record(ThemeLocaleSchema, z.object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().min(1).max(240).optional(),
  }).strict()).optional(),
}).strict();

function isColor(value: string): boolean {
  if (HEX.test(value)) return true;
  const match = FUNCTION_COLOR.exec(value);
  if (!match) return false;
  const functionName = match[1];
  if (!functionName) return false;
  const channels = match.slice(2, 5).map(Number);
  const alpha = match[5];
  return channels.every((channel) => channel >= 0 && channel <= 255) &&
    ((functionName.toLowerCase() === "rgba") === (alpha !== undefined));
}

const color = z.string().refine(isColor, "invalid color");

export const DEFAULT_THEME_SURFACES = {
  baseOpacity: 0.68,
  elevatedOpacity: 0.92,
  terminalOpacity: 0.82,
  blur: 0,
} as const;

const ThemeColorsV1Schema = z.object({
  accent: color,
  secondary: color,
  text: color,
  muted: color,
  panel: color,
  border: color,
  success: color,
  warning: color,
  danger: color,
  info: color,
}).strict();

export const ThemeColorsSchema = ThemeColorsV1Schema.extend({
  textSecondary: color,
  link: color,
  inputText: color,
  placeholder: color,
  codeText: color,
}).strict();

export const THEME_MODULE_IDS = [
  "sidebar",
  "topbar",
  "hero",
  "suggestions",
  "project-picker",
  "composer",
  "task-background",
  "content-layer",
] as const;

export const NATIVE_GEOMETRY_MODULE_IDS = ["project-picker"] as const;

export const ThemeLayoutModuleSchema = z.object({
  id: z.enum(THEME_MODULE_IDS),
  order: z.number().int().min(0).max(THEME_MODULE_IDS.length - 1),
  visible: z.boolean(),
  size: z.enum(["compact", "regular", "expanded"]),
  align: z.enum(["start", "center", "end", "stretch"]),
  spacing: z.number().int().min(0).max(48),
}).strict();

export type ThemeLayoutModule = z.infer<typeof ThemeLayoutModuleSchema>;

export const DEFAULT_LAYOUT_MODULES: readonly ThemeLayoutModule[] = [
  { id: "sidebar", order: 0, visible: true, size: "regular", align: "stretch", spacing: 12 },
  { id: "topbar", order: 1, visible: true, size: "regular", align: "stretch", spacing: 12 },
  { id: "hero", order: 2, visible: true, size: "expanded", align: "stretch", spacing: 16 },
  { id: "suggestions", order: 3, visible: true, size: "regular", align: "stretch", spacing: 16 },
  { id: "project-picker", order: 4, visible: true, size: "regular", align: "stretch", spacing: 16 },
  { id: "composer", order: 5, visible: true, size: "regular", align: "center", spacing: 12 },
  { id: "task-background", order: 6, visible: true, size: "regular", align: "stretch", spacing: 0 },
  { id: "content-layer", order: 7, visible: true, size: "regular", align: "stretch", spacing: 12 },
] as const;

export const ThemeLayoutSchema = z.object({
  heroHeight: z.number().int().min(180).max(560),
  cardColumns: z.number().int().min(2).max(4),
  composerWidth: z.number().min(0.5).max(1),
  sidebarDensity: z.enum(["compact", "comfortable"]),
  moduleGap: z.number().int().min(0).max(48),
  modules: z.array(ThemeLayoutModuleSchema).length(THEME_MODULE_IDS.length),
}).strict().superRefine((layout, context) => {
  const ids = layout.modules.map((module) => module.id);
  const orders = layout.modules.map((module) => module.order);
  if (new Set(ids).size !== THEME_MODULE_IDS.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modules"],
      message: "layout must contain each module exactly once",
    });
  }
  if (new Set(orders).size !== THEME_MODULE_IDS.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modules"],
      message: "layout module order values must be unique",
    });
  }
  for (const id of [
    "sidebar",
    "topbar",
    ...NATIVE_GEOMETRY_MODULE_IDS,
    "composer",
    "content-layer",
  ] as const) {
    if (!layout.modules.find((module) => module.id === id)?.visible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modules"],
        message: `protected module must remain visible: ${id}`,
      });
    }
  }
});

const ThemeDocumentFieldsSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.enum(["theme", "recipe"]),
  appearance: z.enum(["auto", "light", "dark"]).default("auto"),
  id: ThemeIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240).optional(),
  version: ThemeVersionSchema,
  author: z.string().trim().min(1).max(80),
  metadata: ThemeMetadataSchema.optional(),
  assets: z.object({
    background: imagePath.optional(),
    portrait: imagePath.optional(),
    decorations: z.record(assetKey, imagePath).optional(),
    fonts: z.record(assetKey, fontPath).optional(),
  }).strict(),
  colors: ThemeColorsSchema,
  typography: z.object({
    uiFamily: z.string().trim().min(1).max(120),
    codeFamily: z.string().trim().min(1).max(120),
    uiFontAssetKey: assetKey.optional(),
    codeFontAssetKey: assetKey.optional(),
    scale: z.number().min(0.85).max(1.3),
    uiSize: z.number().min(12).max(22),
    codeSize: z.number().min(11).max(22),
    uiWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
    codeWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
    lineHeight: z.number().min(1.2).max(1.8),
  }).strict(),
  background: z.object({
    positionX: z.number().min(0).max(1),
    positionY: z.number().min(0).max(1),
    scale: z.number().min(0.5).max(3),
    blur: z.number().min(0).max(30),
    brightness: z.number().min(0.3).max(1.5),
    overlay: z.number().min(0).max(0.9),
    safeArea: z.enum(["auto", "left", "center", "right", "none"]).default("auto"),
    taskMode: z.enum(["auto", "full", "ambient", "banner", "off"]).default("full"),
    taskOpacity: z.number().min(0).max(1).default(0.82),
  }).strict(),
  surfaces: z.object({
    baseOpacity: z.number().min(0).max(1),
    elevatedOpacity: z.number().min(0).max(1),
    terminalOpacity: z.number().min(0).max(1),
    blur: z.number().min(0).max(30),
  }).strict().default(DEFAULT_THEME_SURFACES),
  decorations: z.array(z.object({
    type: z.enum(["particles", "ribbon", "butterflies", "polaroid", "badge", "sparkles", "image"]),
    enabled: z.boolean(),
    intensity: z.number().min(0).max(1),
    assetKey: assetKey.optional(),
    placement: z.enum(["background", "corners", "hero", "cards"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
    scale: z.number().min(0.25).max(3).optional(),
  }).strict()).max(16),
  layout: ThemeLayoutSchema,
  rights: z.object({
    licenseId: z.string().trim().min(1).max(100),
    attribution: z.string().trim().min(1).max(240).optional(),
    source: z.string().url().max(500).optional(),
    localOnly: z.boolean(),
  }).strict(),
}).strict();

type ThemeDocumentFields = z.infer<typeof ThemeDocumentFieldsSchema>;

function validateThemeRelationships(
  theme: ThemeDocumentFields,
  context: z.RefinementCtx,
  requireBackground: boolean,
): void {
  if (requireBackground && theme.kind === "theme" && !theme.assets.background) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets", "background"],
      message: "theme requires background",
    });
  }
  if (theme.kind === "recipe" && (!theme.rights.localOnly || Object.keys(theme.assets).length > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rights", "localOnly"],
      message: "recipes must be local-only and contain no bundled assets",
    });
  }
  theme.decorations.forEach((decoration, index) => {
    if (decoration.type === "image" && !decoration.assetKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decorations", index, "assetKey"],
        message: "image decoration requires an asset key",
      });
    }
    if (decoration.assetKey && !theme.assets.decorations?.[decoration.assetKey]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decorations", index, "assetKey"],
        message: "decoration asset key is not declared",
      });
    }
  });
  for (const field of ["uiFontAssetKey", "codeFontAssetKey"] as const) {
    const key = theme.typography[field];
    if (key && !theme.assets.fonts?.[key]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["typography", field],
        message: "font asset key is not declared",
      });
    }
  }
}

export const ThemeDraftDocumentSchema = ThemeDocumentFieldsSchema.superRefine(
  (theme, context) => validateThemeRelationships(theme, context, false),
);

export const ThemeDocumentSchema = ThemeDocumentFieldsSchema.superRefine(
  (theme, context) => validateThemeRelationships(theme, context, true),
);

const LegacyThemeDocumentSchema = ThemeDocumentFieldsSchema.extend({
  schemaVersion: z.literal(1),
  colors: ThemeColorsV1Schema,
}).strict().superRefine(
  (theme, context) => validateThemeRelationships(
    {
      ...theme,
      schemaVersion: 2,
      colors: {
        ...theme.colors,
        textSecondary: theme.colors.text,
        link: theme.colors.accent,
        inputText: theme.colors.text,
        placeholder: theme.colors.muted,
        codeText: theme.colors.text,
      },
    },
    context,
    true,
  ),
);

export type ThemeDocument = z.infer<typeof ThemeDocumentSchema>;
export type ThemeDraftDocument = z.infer<typeof ThemeDraftDocumentSchema>;
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;
export type ThemeLayout = z.infer<typeof ThemeLayoutSchema>;
export type ThemeSurfaces = ThemeDocumentFields["surfaces"];
export type ThemeMetadata = z.infer<typeof ThemeMetadataSchema>;
export type ThemeLocale = z.infer<typeof ThemeLocaleSchema>;

export function parseThemeDocument(value: unknown): ThemeDocument {
  if (typeof value === "object" && value !== null &&
    "schemaVersion" in value && value.schemaVersion === 2) {
    return ThemeDocumentSchema.parse(value);
  }

  const legacy = LegacyThemeDocumentSchema.parse(value);
  return ThemeDocumentSchema.parse({
    ...legacy,
    schemaVersion: 2,
    colors: {
      ...legacy.colors,
      textSecondary: legacy.colors.text,
      link: legacy.colors.accent,
      inputText: legacy.colors.text,
      placeholder: legacy.colors.muted,
      codeText: legacy.colors.text,
    },
  });
}
