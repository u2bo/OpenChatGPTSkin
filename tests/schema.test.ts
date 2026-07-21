import { describe, expect, it } from "vitest";
import {
  createThemeVisualModel,
  DEFAULT_LAYOUT_MODULES,
  ThemeDocumentSchema,
  isSafeThemePath,
  parseThemeDocument,
} from "@open-chatgpt-skin/theme-schema";

const validTheme = {
  schemaVersion: 2,
  kind: "theme",
  id: "mountain-mist",
  name: "山岚云海",
  description: "Low-distraction mountain and cloud theme",
  version: "1.0.0",
  author: "OpenChatGPTSkin",
  assets: { background: "assets/background.webp" },
  colors: {
    accent: "#4f8f78",
    secondary: "#9fc4b3",
    text: "#13231d",
    textSecondary: "#40584e",
    muted: "#60756c",
    link: "#326f5a",
    inputText: "#13231d",
    placeholder: "#60756c",
    codeText: "#213b31",
    panel: "rgba(248, 252, 250, 0.88)",
    border: "rgba(79, 143, 120, 0.28)",
    success: "#3f8f68",
    warning: "#b7791f",
    danger: "#c24156",
    info: "#327c9e",
  },
  typography: {
    uiFamily: "Microsoft YaHei UI",
    codeFamily: "Cascadia Code",
    scale: 1,
    uiSize: 14,
    codeSize: 13,
    uiWeight: 500,
    codeWeight: 400,
    lineHeight: 1.5,
  },
  background: {
    positionX: 0.66,
    positionY: 0.4,
    scale: 1,
    blur: 0,
    brightness: 0.92,
    overlay: 0.18,
  },
  decorations: [{ type: "particles", enabled: true, intensity: 0.25 }],
  layout: {
    heroHeight: 360,
    cardColumns: 4,
    composerWidth: 0.72,
    sidebarDensity: "comfortable",
    moduleGap: 16,
    modules: DEFAULT_LAYOUT_MODULES,
  },
  rights: {
    licenseId: "LicenseRef-OpenChatGPTSkin-Original",
    attribution: "OpenChatGPTSkin",
    localOnly: false,
  },
};

describe("ThemeDocumentSchema", () => {
  it("accepts a complete public theme", () => {
    expect(parseThemeDocument(validTheme)).toEqual({
      ...validTheme,
      appearance: "auto",
      background: {
        ...validTheme.background,
        safeArea: "auto",
        taskMode: "full",
        taskOpacity: 0.82,
      },
      surfaces: {
        baseOpacity: 0.68,
        elevatedOpacity: 0.92,
        terminalOpacity: 0.82,
        blur: 0,
      },
    });
  });

  it("accepts safe localized metadata and rejects non-HTTPS theme links", () => {
    expect(parseThemeDocument({
      ...validTheme,
      metadata: {
        homepage: "https://github.com/example/theme",
        localized: {
          en: { name: "Mountain Mist", description: "A quiet mountain theme." },
        },
      },
    }).metadata).toEqual({
      homepage: "https://github.com/example/theme",
      localized: {
        en: { name: "Mountain Mist", description: "A quiet mountain theme." },
      },
    });
    expect(() => parseThemeDocument({
      ...validTheme,
      metadata: { homepage: "http://example.com/theme" },
    })).toThrow();
  });

  it("supports adaptive appearance, safe areas, task modes, and configurable surfaces", () => {
    const parsed = parseThemeDocument({
      ...validTheme,
      appearance: "dark",
      background: {
        ...validTheme.background,
        safeArea: "left",
        taskMode: "ambient",
        taskOpacity: 0.74,
      },
      surfaces: {
        baseOpacity: 0.55,
        elevatedOpacity: 0.88,
        terminalOpacity: 0.7,
        blur: 6,
      },
    });
    const visual = createThemeVisualModel(parsed);

    expect(visual.appearance).toEqual({ mode: "dark", resolved: "dark" });
    expect(visual.background).toMatchObject({
      safeArea: "left",
      taskMode: "ambient",
      taskOpacityPercent: 74,
    });
    expect(visual.surfaces).toEqual({
      baseOpacityPercent: 55,
      elevatedOpacityPercent: 88,
      terminalOpacityPercent: 70,
      blurPx: 6,
    });
  });

  it("resolves automatic safe areas away from the configured image focus", () => {
    const parsed = parseThemeDocument({
      ...validTheme,
      background: { ...validTheme.background, positionX: 0.78 },
    });

    expect(createThemeVisualModel(parsed).background.safeArea).toBe("left");
  });

  it("maps the competitor-compatible automatic task mode to a quiet task surface", () => {
    const parsed = parseThemeDocument({
      ...validTheme,
      background: { ...validTheme.background, taskMode: "auto" },
    });

    expect(createThemeVisualModel(parsed).background).toMatchObject({
      taskModeMode: "auto",
      taskMode: "ambient",
    });
  });

  it("migrates legacy v1 semantic colors into the single v2 model", () => {
    const legacy = {
      ...validTheme,
      schemaVersion: 1,
      colors: {
        accent: validTheme.colors.accent,
        secondary: validTheme.colors.secondary,
        text: validTheme.colors.text,
        muted: validTheme.colors.muted,
        panel: validTheme.colors.panel,
        border: validTheme.colors.border,
        success: validTheme.colors.success,
        warning: validTheme.colors.warning,
        danger: validTheme.colors.danger,
        info: validTheme.colors.info,
      },
    };
    expect(parseThemeDocument(legacy)).toMatchObject({
      schemaVersion: 2,
      colors: {
        textSecondary: legacy.colors.text,
        link: legacy.colors.accent,
        inputText: legacy.colors.text,
        placeholder: legacy.colors.muted,
        codeText: legacy.colors.text,
      },
    });
  });

  it("rejects arbitrary properties and unsafe scalar values", () => {
    expect(() => parseThemeDocument({ ...validTheme, script: "alert(1)" })).toThrow();
    expect(() => parseThemeDocument({
      ...validTheme,
      assets: { background: "assets/run.js" },
    })).toThrow();
    expect(() => parseThemeDocument({
      ...validTheme,
      colors: { ...validTheme.colors, accent: "rgb(999, 0, 0)" },
    })).toThrow();
    expect(() => parseThemeDocument({ ...validTheme, id: "con" })).toThrow(/Windows/i);
  });

  it("requires local-only recipes to omit bundled artwork", () => {
    const recipe = {
      ...validTheme,
      kind: "recipe",
      id: "hatsune-miku-local",
      name: "初音未来（需授权素材）",
      assets: {},
      rights: { licenseId: "LicenseRef-User-Supplied", localOnly: true },
    };
    expect(ThemeDocumentSchema.parse(recipe).kind).toBe("recipe");
  });

  it("enforces the safe module grid and declared decoration assets", () => {
    const hiddenComposer = validTheme.layout.modules.map((module) =>
      module.id === "composer" ? { ...module, visible: false } : module,
    );
    expect(() => parseThemeDocument({
      ...validTheme,
      layout: { ...validTheme.layout, modules: hiddenComposer },
    })).toThrow(/protected/i);
    const hiddenProjectPicker = validTheme.layout.modules.map((module) =>
      module.id === "project-picker" ? { ...module, visible: false } : module,
    );
    expect(() => parseThemeDocument({
      ...validTheme,
      layout: { ...validTheme.layout, modules: hiddenProjectPicker },
    })).toThrow(/protected/i);
    expect(() => parseThemeDocument({
      ...validTheme,
      assets: { background: "fonts/background.webp" },
    })).toThrow(/unsafe|asset/i);
    expect(() => parseThemeDocument({
      ...validTheme,
      decorations: [{ type: "image", enabled: true, intensity: 0.5, assetKey: "missing" }],
    })).toThrow(/decoration asset/i);
  });
});

describe("isSafeThemePath", () => {
  it.each(["assets/background.webp", "fonts/ui.woff2"])("accepts %s", (value) => {
    expect(isSafeThemePath(value)).toBe(true);
  });

  it.each([
    "../secret.png",
    "/absolute.png",
    "C:/secret.png",
    "assets/run.js",
    "a\\b.png",
    "background.png",
    "fonts/background.png",
    "assets/ui.woff2",
    "assets/CON.png",
    "assets/a:b.png",
    "assets/e\u0301.png",
  ])("rejects %s", (value) => {
    expect(isSafeThemePath(value)).toBe(false);
  });
});
