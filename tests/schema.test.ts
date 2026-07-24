import { describe, expect, it } from "vitest";
import {
  compileWelcomeLines,
  createThemeVisualModel,
  DEFAULT_LAYOUT_MODULES,
  isSafeThemePath,
  parseThemeDocument,
  resolveHomeWelcome,
} from "@open-chatgpt-skin/theme-schema";

const validTheme = {
  schemaVersion: 3,
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
  it("migrates v3 to v4 without opting into content overrides", () => {
    const parsed = parseThemeDocument(validTheme);

    expect(parsed).toMatchObject({
      schemaVersion: 4,
      composition: { layers: [] },
      interfaceImages: {
        profileAvatarSize: 24,
        suggestionIconSize: 20,
        projectIconSize: 16,
      },
      typography: {
        displayFamily: validTheme.typography.uiFamily,
        displaySize: 28,
        displayWeight: validTheme.typography.uiWeight,
        displayLineHeight: validTheme.typography.lineHeight,
        displayLetterSpacing: 0,
      },
    });
    expect(parsed.home).toBeUndefined();
  });

  it("resolves localized welcome text with a real project name", () => {
    const parsed = parseThemeDocument({
      ...parseThemeDocument(validTheme),
      home: {
        welcome: {
          localized: {
            "zh-CN": { lines: ["在「{projectName}」中，", "一起创造吧"] },
            en: { lines: ["Create in {projectName}"] },
          },
        },
      },
    });
    const localized = Object.fromEntries(Object.entries(
      parsed.home!.welcome.localized,
    ).map(([locale, value]) => [locale, compileWelcomeLines(value.lines)]));

    expect(resolveHomeWelcome(localized, {
      locale: "zh-CN",
      projectName: "DataMate",
    })).toEqual({
      kind: "custom",
      lines: ["在「DataMate」中，", "一起创造吧"],
    });
    expect(resolveHomeWelcome(localized, { locale: "zh-CN" })).toEqual({
      kind: "native",
    });
    expect(resolveHomeWelcome(localized, {
      locale: "en",
      projectName: "DataMate",
    })).toEqual({
      kind: "custom",
      lines: ["Create in DataMate"],
    });
  });

  it.each([
    ["unknown placeholder", ["Hello {userName}"]],
    ["too many lines", ["1", "2", "3", "4"]],
    ["html", ["<b>Hello</b>"]],
    ["markdown link", ["[Hello](https://example.com)"]],
    ["markdown emphasis", ["**Hello**"]],
    ["css declaration", ["color: red;"]],
    ["escape sequence", ["Hello\\nworld"]],
    ["line longer than 120 code points", ["你".repeat(121)]],
    ["total longer than 240 code points", [
      "你".repeat(120),
      "好".repeat(120),
      "啊",
    ]],
  ])("rejects invalid welcome: %s", (_name, lines) => {
    expect(() => parseThemeDocument({
      ...parseThemeDocument(validTheme),
      home: { welcome: { localized: { "zh-CN": { lines } } } },
    })).toThrow();
  });

  it("resolves display typography, welcome tokens, and composition geometry once", () => {
    const base = parseThemeDocument(validTheme);
    const parsed = parseThemeDocument({
      ...base,
      assets: {
        ...base.assets,
        decorations: { "hero-signature": "assets/hero-signature.webp" },
        fonts: { display: "fonts/display.woff2" },
      },
      typography: {
        ...base.typography,
        displayFamily: "Noto Serif SC",
        displayFontAssetKey: "display",
        displaySize: 42,
        displayWeight: 500,
        displayLineHeight: 1.45,
        displayLetterSpacing: 0.04,
      },
      home: {
        welcome: {
          localized: {
            "zh-CN": { lines: ["在「{projectName}」中，", "一起创造吧"] },
          },
        },
      },
      composition: {
        layers: [{
          id: "hero-signature",
          asset: { kind: "decoration", assetKey: "hero-signature" },
          surface: "home-hero",
          anchor: "top-left",
          positionX: 0.1,
          positionY: 0.08,
          width: 0.22,
          opacity: 1,
          rotation: -3,
          required: true,
        }],
      },
    });

    expect(createThemeVisualModel(parsed)).toMatchObject({
      displayTypography: {
        family: "Noto Serif SC",
        fontAssetKey: "display",
        size: 42,
        weight: 500,
        lineHeight: 1.45,
        letterSpacingEm: 0.04,
      },
      welcome: {
        localized: {
          "zh-CN": [
            [
              { kind: "text", value: "在「" },
              { kind: "projectName" },
              { kind: "text", value: "」中，" },
            ],
            [{ kind: "text", value: "一起创造吧" }],
          ],
        },
      },
      composition: {
        layers: [{
          id: "hero-signature",
          positionXPercent: 10,
          positionYPercent: 8,
          widthPercent: 22,
          rotationDeg: -3,
        }],
      },
    });
  });

  it.each([
    ["decoration", { kind: "decoration", assetKey: "missing" }],
    ["portrait", { kind: "portrait" }],
  ] as const)("rejects an undeclared %s composition asset", (_name, asset) => {
    expect(() => parseThemeDocument({
      ...parseThemeDocument(validTheme),
      composition: {
        layers: [{
          id: "missing-layer",
          asset,
          surface: "home-hero",
          anchor: "center",
          positionX: 0.5,
          positionY: 0.5,
          width: 0.2,
          opacity: 1,
          rotation: 0,
          required: true,
        }],
      },
    })).toThrow(/composition layer asset/i);
  });

  it.each([
    [
      "future version",
      { ...validTheme, schemaVersion: 99 },
      "THEME_SCHEMA_VERSION_UNSUPPORTED",
    ],
    [
      "welcome",
      {
        ...parseThemeDocument(validTheme),
        home: { welcome: { localized: { "zh-CN": { lines: ["{userName}"] } } } },
      },
      "THEME_WELCOME_INVALID",
    ],
    [
      "display font",
      {
        ...parseThemeDocument(validTheme),
        typography: {
          ...parseThemeDocument(validTheme).typography,
          displayFontAssetKey: "missing",
        },
      },
      "THEME_DISPLAY_FONT_MISSING",
    ],
    [
      "composition",
      {
        ...parseThemeDocument(validTheme),
        composition: {
          layers: [{
            id: "missing-layer",
            asset: { kind: "portrait" },
            surface: "main",
            anchor: "center",
            positionX: 0.5,
            positionY: 0.5,
            width: 0.2,
            opacity: 1,
            rotation: 0,
            required: true,
          }],
        },
      },
      "THEME_COMPOSITION_INVALID",
    ],
  ] as const)("returns a stable code for invalid %s input", (_name, input, code) => {
    let failure: unknown;
    try {
      parseThemeDocument(input);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code });
  });

  it("accepts a complete public theme", () => {
    expect(parseThemeDocument(validTheme)).toEqual({
      ...validTheme,
      schemaVersion: 4,
      appearance: "auto",
      composition: { layers: [] },
      interfaceImages: {
        profileAvatarSize: 24,
        suggestionIconSize: 20,
        projectIconSize: 16,
      },
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
      typography: {
        ...validTheme.typography,
        displayFamily: validTheme.typography.uiFamily,
        displaySize: 28,
        displayWeight: validTheme.typography.uiWeight,
        displayLineHeight: validTheme.typography.lineHeight,
        displayLetterSpacing: 0,
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
      schemaVersion: 4,
      colors: {
        textSecondary: legacy.colors.text,
        link: legacy.colors.accent,
        inputText: legacy.colors.text,
        placeholder: legacy.colors.muted,
        codeText: legacy.colors.text,
      },
    });
  });

  it("migrates v2 themes to v4 without adding interface imagery", () => {
    const parsed = parseThemeDocument({
      ...validTheme,
      schemaVersion: 2,
    });

    expect(parsed.schemaVersion).toBe(4);
    expect(parsed.assets.profileAvatar).toBeUndefined();
    expect(parsed.assets.suggestionIcons).toBeUndefined();
  });

  it("resolves interface imagery from the shared background and custom assets", () => {
    const parsed = parseThemeDocument({
      ...validTheme,
      schemaVersion: 4,
      interfaceImages: {
        profileAvatarSize: 28,
        suggestionIconSize: 36,
        projectIconSize: 20,
      },
      assets: {
        background: "assets/background.webp",
        profileAvatar: "assets/background.webp",
        suggestionIcons: {
          card1: "assets/background.webp",
          card2: "assets/card2.webp",
        },
        projectIcons: ["assets/card2.webp", "assets/background.webp"],
      },
    });

    expect(createThemeVisualModel(parsed).interfaceImagery).toEqual({
      profileAvatar: {
        path: "assets/background.webp",
        source: "background",
        positionXPercent: 50,
        positionYPercent: 35,
        sizePx: 28,
      },
      suggestionIcons: {
        card1: {
          path: "assets/background.webp",
          source: "background",
          positionXPercent: 20,
          positionYPercent: 25,
          sizePx: 36,
        },
        card2: {
          path: "assets/card2.webp",
          source: "custom",
          positionXPercent: 50,
          positionYPercent: 50,
          sizePx: 36,
        },
        card3: {
          source: "default",
          positionXPercent: 50,
          positionYPercent: 50,
          sizePx: 36,
        },
        card4: {
          source: "default",
          positionXPercent: 50,
          positionYPercent: 50,
          sizePx: 36,
        },
      },
      projectIcons: [
        {
          path: "assets/card2.webp",
          source: "custom",
          positionXPercent: 50,
          positionYPercent: 50,
          sizePx: 20,
        },
        {
          path: "assets/background.webp",
          source: "background",
          positionXPercent: 50,
          positionYPercent: 50,
          sizePx: 20,
        },
      ],
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
      assets: {
        background: "assets/background.webp",
        profileAvatar: "https://example.com/avatar.png",
      },
    })).toThrow();
    expect(() => parseThemeDocument({
      ...validTheme,
      assets: {
        background: "assets/background.webp",
        suggestionIcons: { card1: "../secret.png" },
      },
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
    expect(parseThemeDocument(recipe).kind).toBe("recipe");
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
