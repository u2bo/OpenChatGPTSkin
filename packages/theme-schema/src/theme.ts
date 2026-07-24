import { z } from "zod";
import {
  ThemeCompositionAnchorSchema,
  ThemeCompositionSchema,
} from "./composition.js";

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

export type ThemeSchemaErrorCode =
  | "THEME_SCHEMA_VERSION_UNSUPPORTED"
  | "THEME_WELCOME_INVALID"
  | "THEME_DISPLAY_FONT_MISSING"
  | "THEME_COMPOSITION_INVALID"
  | "THEME_SCHEMA_INVALID";

export class ThemeSchemaError extends Error {
  constructor(
    public readonly code: ThemeSchemaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ThemeSchemaError";
  }
}

const PROJECT_TOKEN = "{projectName}";
const UNKNOWN_OR_UNBALANCED_PLACEHOLDER = /[{}]/;
const FORBIDDEN_WELCOME_MARKUP = /<[^>]*>|\[[^\]]+\]\([^)]+\)|\x60{1,3}[^\x60]*\x60{1,3}|\*\*|__|~~|(?:^|\s)#{1,6}\s/;
const FORBIDDEN_WELCOME_CSS = /(?:^|[;{])\s*(?:color|background(?:-color)?|font(?:-family|-size|-weight)?|position|display|opacity|z-index)\s*:/i;
const FORBIDDEN_WELCOME_ESCAPE = /\\(?:n|r|t|u|x)/;

const WelcomeLineSchema = z.string().transform((value) => value.trim())
  .superRefine((line, context) => {
    const withoutProjectToken = line.replaceAll(PROJECT_TOKEN, "");
    if ([...line].length < 1 || [...line].length > 120) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "welcome line must contain 1-120 code points",
      });
    }
    if (UNKNOWN_OR_UNBALANCED_PLACEHOLDER.test(withoutProjectToken) ||
      FORBIDDEN_WELCOME_MARKUP.test(line) || FORBIDDEN_WELCOME_CSS.test(line) ||
      FORBIDDEN_WELCOME_ESCAPE.test(line)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "welcome line must be plain text with only {projectName}",
      });
    }
  });

const LocalizedWelcomeSchema = z.object({
  lines: z.array(WelcomeLineSchema).min(1).max(3),
}).strict().superRefine(({ lines }, context) => {
  const codePoints = lines.reduce((total, line) => total + [...line].length, 0);
  if (codePoints > 240) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lines"],
      message: "welcome text exceeds 240 code points",
    });
  }
});

export const ThemeHomeSchema = z.object({
  welcome: z.object({
    localized: z.record(ThemeLocaleSchema, LocalizedWelcomeSchema)
      .refine(
        (value) => Object.keys(value).length > 0,
        "welcome requires at least one locale",
      ),
    layout: z.object({
      anchor: ThemeCompositionAnchorSchema,
      positionX: z.number().min(0).max(1),
      positionY: z.number().min(0).max(1),
      width: z.number().min(0.2).max(1),
      textAlign: z.enum(["left", "center", "right"]),
      hideNativeIcon: z.boolean().default(false),
    }).strict().optional(),
  }).strict(),
}).strict();

export const SuggestionIconSlotSchema = z.enum([
  "card1",
  "card2",
  "card3",
  "card4",
]);

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

const ThemeAssetsV2Schema = z.object({
  background: imagePath.optional(),
  portrait: imagePath.optional(),
  decorations: z.record(assetKey, imagePath).optional(),
  fonts: z.record(assetKey, fontPath).optional(),
}).strict();

const ThemeAssetsSchema = ThemeAssetsV2Schema.extend({
  profileAvatar: imagePath.optional(),
  suggestionIcons: z.object({
    card1: imagePath.optional(),
    card2: imagePath.optional(),
    card3: imagePath.optional(),
    card4: imagePath.optional(),
  }).strict().optional(),
  projectIcons: z.array(imagePath).min(1).max(12).optional(),
}).strict();

export const DEFAULT_THEME_INTERFACE_IMAGES = {
  profileAvatarSize: 24,
  suggestionIconSize: 20,
  projectIconSize: 16,
} as const;

export const ThemeInterfaceImagesSchema = z.object({
  profileAvatarSize: z.number().int().min(16).max(48),
  suggestionIconSize: z.number().int().min(16).max(64),
  projectIconSize: z.number().int().min(12).max(32),
}).strict();

const ThemeTypographyV3Schema = z.object({
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
}).strict();

const displayWeight = z.union([
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
]);

const ThemeTypographyV4InputSchema = ThemeTypographyV3Schema.extend({
  displayFamily: z.string().trim().min(1).max(120).optional(),
  displayFontAssetKey: assetKey.optional(),
  displaySize: z.number().min(20).max(72).optional(),
  displayWeight: displayWeight.optional(),
  displayLineHeight: z.number().min(1.1).max(1.8).optional(),
  displayLetterSpacing: z.number().min(-0.05).max(0.2).optional(),
}).strict();

const ThemeTypographyV4Schema = ThemeTypographyV3Schema.extend({
  displayFamily: z.string().trim().min(1).max(120),
  displayFontAssetKey: assetKey.optional(),
  displaySize: z.number().min(20).max(72),
  displayWeight,
  displayLineHeight: z.number().min(1.1).max(1.8),
  displayLetterSpacing: z.number().min(-0.05).max(0.2),
}).strict();

const ThemeDocumentV3FieldsSchema = z.object({
  schemaVersion: z.literal(3),
  kind: z.enum(["theme", "recipe"]),
  appearance: z.enum(["auto", "light", "dark"]).default("auto"),
  id: ThemeIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240).optional(),
  version: ThemeVersionSchema,
  author: z.string().trim().min(1).max(80),
  metadata: ThemeMetadataSchema.optional(),
  assets: ThemeAssetsSchema,
  colors: ThemeColorsSchema,
  typography: ThemeTypographyV3Schema,
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

const ThemeDocumentV4InputFieldsSchema = ThemeDocumentV3FieldsSchema.extend({
  schemaVersion: z.literal(4),
  typography: ThemeTypographyV4InputSchema,
  interfaceImages: ThemeInterfaceImagesSchema.optional(),
  home: ThemeHomeSchema.optional(),
  composition: ThemeCompositionSchema.optional(),
}).strict();

const ThemeDocumentFieldsSchema = ThemeDocumentV3FieldsSchema.extend({
  schemaVersion: z.literal(4),
  typography: ThemeTypographyV4Schema,
  interfaceImages: ThemeInterfaceImagesSchema,
  home: ThemeHomeSchema.optional(),
  composition: ThemeCompositionSchema,
}).strict();

type ThemeDocumentV4Input = z.infer<typeof ThemeDocumentV4InputFieldsSchema>;
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
  theme.composition.layers.forEach((layer, index) => {
    const path = layer.asset.kind === "portrait"
      ? theme.assets.portrait
      : theme.assets.decorations?.[layer.asset.assetKey];
    if (!path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["composition", "layers", index, "asset"],
        message: "composition layer asset is not declared",
      });
    }
  });
  for (const field of ["uiFontAssetKey", "codeFontAssetKey", "displayFontAssetKey"] as const) {
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

const ThemeDocumentV2Schema = ThemeDocumentV3FieldsSchema.extend({
  schemaVersion: z.literal(2),
  assets: ThemeAssetsV2Schema,
}).strict();

const LegacyThemeDocumentSchema = ThemeDocumentV2Schema.extend({
  schemaVersion: z.literal(1),
  colors: ThemeColorsV1Schema,
}).strict();

export type ThemeDocument = z.infer<typeof ThemeDocumentSchema>;
export type ThemeDraftDocument = z.infer<typeof ThemeDraftDocumentSchema>;
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;
export type ThemeLayout = z.infer<typeof ThemeLayoutSchema>;
export type ThemeSurfaces = ThemeDocumentFields["surfaces"];
export type ThemeMetadata = z.infer<typeof ThemeMetadataSchema>;
export type ThemeLocale = z.infer<typeof ThemeLocaleSchema>;
export type SuggestionIconSlot = z.infer<typeof SuggestionIconSlotSchema>;

export function themeAssetPaths(
  theme: Pick<ThemeDraftDocument, "assets">,
): readonly string[] {
  return [...new Set([
    theme.assets.background,
    theme.assets.portrait,
    theme.assets.profileAvatar,
    ...Object.values(theme.assets.suggestionIcons ?? {}),
    ...(theme.assets.projectIcons ?? []),
    ...Object.values(theme.assets.decorations ?? {}),
    ...Object.values(theme.assets.fonts ?? {}),
  ].filter((value): value is string => Boolean(value)))];
}

function normalizeV4(input: ThemeDocumentV4Input): ThemeDocumentFields {
  return {
    ...input,
    schemaVersion: 4,
    typography: {
      ...input.typography,
      displayFamily: input.typography.displayFamily ?? input.typography.uiFamily,
      displaySize: input.typography.displaySize ?? Math.min(
        72,
        Math.max(20, input.typography.uiSize * input.typography.scale * 2),
      ),
      displayWeight: input.typography.displayWeight ?? input.typography.uiWeight,
      displayLineHeight: input.typography.displayLineHeight ?? input.typography.lineHeight,
      displayLetterSpacing: input.typography.displayLetterSpacing ?? 0,
    },
    interfaceImages: input.interfaceImages ?? DEFAULT_THEME_INTERFACE_IMAGES,
    composition: input.composition ?? { layers: [] },
  };
}

function issueCode(error: z.ZodError): ThemeSchemaErrorCode {
  const first = error.issues[0];
  const root = first?.path[0];
  if (root === "home") return "THEME_WELCOME_INVALID";
  if (root === "composition") return "THEME_COMPOSITION_INVALID";
  if (root === "typography" && first?.path[1] === "displayFontAssetKey") {
    return "THEME_DISPLAY_FONT_MISSING";
  }
  return "THEME_SCHEMA_INVALID";
}

function assertSupportedSchemaVersion(value: unknown): void {
  if (typeof value !== "object" || value === null || !("schemaVersion" in value)) return;
  const version = value.schemaVersion;
  if (typeof version === "number" && ![1, 2, 3, 4].includes(version)) {
    throw new ThemeSchemaError(
      "THEME_SCHEMA_VERSION_UNSUPPORTED",
      `unsupported theme schema version: ${version}`,
    );
  }
}

function migrateThemeDocument(value: unknown): unknown {
  assertSupportedSchemaVersion(value);
  if (typeof value === "object" && value !== null &&
    "schemaVersion" in value && value.schemaVersion === 4) {
    return normalizeV4(ThemeDocumentV4InputFieldsSchema.parse(value));
  }

  if (typeof value === "object" && value !== null &&
    "schemaVersion" in value && value.schemaVersion === 3) {
    const previous = ThemeDocumentV3FieldsSchema.parse(value);
    return normalizeV4({
      ...previous,
      schemaVersion: 4,
      composition: { layers: [] },
    });
  }

  if (typeof value === "object" && value !== null &&
    "schemaVersion" in value && value.schemaVersion === 2) {
    const previous = ThemeDocumentV2Schema.parse(value);
    return normalizeV4({
      ...previous,
      schemaVersion: 4,
      composition: { layers: [] },
    });
  }

  const legacy = LegacyThemeDocumentSchema.parse(value);
  return normalizeV4({
    ...legacy,
    schemaVersion: 4,
    colors: {
      ...legacy.colors,
      textSecondary: legacy.colors.text,
      link: legacy.colors.accent,
      inputText: legacy.colors.text,
      placeholder: legacy.colors.muted,
      codeText: legacy.colors.text,
    },
    composition: { layers: [] },
  });
}

export function parseThemeDraftDocument(value: unknown): ThemeDraftDocument {
  try {
    return ThemeDraftDocumentSchema.parse(migrateThemeDocument(value));
  } catch (error) {
    if (error instanceof ThemeSchemaError) throw error;
    if (error instanceof z.ZodError) {
      throw new ThemeSchemaError(issueCode(error), error.message);
    }
    throw error;
  }
}

export function parseThemeDocument(value: unknown): ThemeDocument {
  try {
    return ThemeDocumentSchema.parse(migrateThemeDocument(value));
  } catch (error) {
    if (error instanceof ThemeSchemaError) throw error;
    if (error instanceof z.ZodError) {
      throw new ThemeSchemaError(issueCode(error), error.message);
    }
    throw error;
  }
}
