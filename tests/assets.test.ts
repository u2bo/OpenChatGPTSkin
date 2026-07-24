import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_MODULES } from "@open-chatgpt-skin/theme-schema";
import {
  THEME_MAX_FONT_BYTES,
  THEME_MAX_IMAGE_BYTES,
  THEME_MAX_PREVIEW_BYTES,
  validateThemeBundle,
} from "@open-chatgpt-skin/theme-core";

const MB = 1024 * 1024;
const IMAGE_LIMIT = 16 * MB;
const FONT_LIMIT = 5 * MB;
const PREVIEW_LIMIT = 2 * MB;

function webp(size = 12): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
}

function png(size = 8): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function woff2(size = 4): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x77, 0x4f, 0x46, 0x32], 0);
  return bytes;
}

const baseTheme = {
  schemaVersion: 1,
  kind: "theme",
  id: "glacier-aurora",
  name: "冰川极光",
  version: "1.0.0",
  author: "OpenChatGPTSkin",
  assets: { background: "assets/background.webp" },
  colors: {
    accent: "#62c9ff",
    secondary: "#a3f2ff",
    text: "#eefcff",
    muted: "#9db8c8",
    panel: "rgba(8, 28, 44, 0.86)",
    border: "rgba(98, 201, 255, 0.32)",
    success: "#57d39b",
    warning: "#f4c15d",
    danger: "#ff7388",
    info: "#62c9ff",
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
    positionX: 0.6,
    positionY: 0.5,
    scale: 1,
    blur: 0,
    brightness: 0.85,
    overlay: 0.28,
  },
  decorations: [],
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

describe("validateThemeBundle", () => {
  it("exports the documented media limits", () => {
    expect(THEME_MAX_IMAGE_BYTES).toBe(IMAGE_LIMIT);
    expect(THEME_MAX_FONT_BYTES).toBe(FONT_LIMIT);
    expect(THEME_MAX_PREVIEW_BYTES).toBe(PREVIEW_LIMIT);
  });

  it("accepts declared files with matching formats", () => {
    const files = new Map([["assets/background.webp", webp()]]);
    expect(validateThemeBundle(baseTheme, files).totalBytes).toBe(12);
  });

  it("deduplicates shared interface imagery and requires custom image files", () => {
    const migrated = validateThemeBundle(baseTheme, new Map([
      ["assets/background.webp", webp()],
    ])).theme;
    const withInterfaceImagery = {
      ...migrated,
      assets: {
        ...migrated.assets,
        profileAvatar: "assets/background.webp",
        suggestionIcons: {
          card1: "assets/background.webp",
          card2: "assets/card2.webp",
        },
      },
    };

    expect(() => validateThemeBundle(withInterfaceImagery, new Map([
      ["assets/background.webp", webp()],
    ]))).toThrow(/assets\/card2\.webp/);

    const validated = validateThemeBundle(withInterfaceImagery, new Map([
      ["assets/background.webp", webp()],
      ["assets/card2.webp", webp()],
    ]));
    expect(validated.files.size).toBe(2);
    expect(validated.totalBytes).toBe(24);
  });

  it("wraps schema failures in a stable validation error", () => {
    let schemaError: unknown;
    try {
      validateThemeBundle({ ...baseTheme, script: "alert(1)" }, new Map([
        ["assets/background.webp", webp()],
      ]));
    } catch (error) {
      schemaError = error;
    }
    expect(schemaError).toMatchObject({ code: "THEME_SCHEMA_INVALID" });
  });

  it("preserves public theme schema error codes", () => {
    expect(() => validateThemeBundle({
      ...baseTheme,
      schemaVersion: 99,
    }, new Map([
      ["assets/background.webp", webp()],
    ]))).toThrow(expect.objectContaining({
      code: "THEME_SCHEMA_VERSION_UNSUPPORTED",
    }));
  });

  it("reports a missing display font with the public display-font code", () => {
    const migrated = validateThemeBundle(baseTheme, new Map([
      ["assets/background.webp", webp()],
    ])).theme;
    const withDisplayFont = {
      ...migrated,
      assets: {
        ...migrated.assets,
        fonts: { display: "fonts/display.woff2" },
      },
      typography: {
        ...migrated.typography,
        displayFontAssetKey: "display",
      },
    };

    expect(() => validateThemeBundle(withDisplayFont, new Map([
      ["assets/background.webp", webp()],
    ]))).toThrow(expect.objectContaining({
      code: "THEME_DISPLAY_FONT_MISSING",
    }));
  });

  it("reports an invalid display font signature with the public display-font code", () => {
    const migrated = validateThemeBundle(baseTheme, new Map([
      ["assets/background.webp", webp()],
    ])).theme;
    const withDisplayFont = {
      ...migrated,
      assets: {
        ...migrated.assets,
        fonts: { display: "fonts/display.woff2" },
      },
      typography: {
        ...migrated.typography,
        displayFontAssetKey: "display",
      },
    };

    expect(() => validateThemeBundle(withDisplayFont, new Map([
      ["assets/background.webp", webp()],
      ["fonts/display.woff2", new TextEncoder().encode("not woff2")],
    ]))).toThrow(expect.objectContaining({
      code: "THEME_DISPLAY_FONT_MISSING",
    }));
  });

  it("rejects missing, undeclared, disguised, and colliding files", () => {
    expect(() => validateThemeBundle(baseTheme, new Map())).toThrow(/missing/i);
    expect(() => validateThemeBundle(baseTheme, new Map([
      ["assets/background.webp", webp()],
      ["assets/run.js", new TextEncoder().encode("alert(1)")],
    ]))).toThrow(/unsupported/i);
    expect(() => validateThemeBundle(baseTheme, new Map([
      ["assets/background.webp", new TextEncoder().encode("not webp")],
    ]))).toThrow(/signature/i);
    expect(() => validateThemeBundle({
      ...baseTheme,
      assets: {
        background: "assets/Background.webp",
        decorations: { duplicate: "assets/background.webp" },
      },
    }, new Map([
      ["assets/Background.webp", webp()],
      ["assets/background.webp", webp()],
    ]))).toThrow(/collision/i);
  });

  it("enforces image, font, preview, and complete package limits", () => {
    expect(() => validateThemeBundle(baseTheme, new Map([
      ["assets/background.webp", webp(IMAGE_LIMIT + 1)],
    ]))).toThrow(/IMAGE_TOO_LARGE|background/i);

    const withFont = {
      ...baseTheme,
      assets: { ...baseTheme.assets, fonts: { ui: "fonts/ui.woff2" } },
    };
    expect(() => validateThemeBundle(withFont, new Map([
      ["assets/background.webp", webp()],
      ["fonts/ui.woff2", woff2(FONT_LIMIT + 1)],
    ]))).toThrow(/FONT_TOO_LARGE|ui\.woff2/i);

    expect(() => validateThemeBundle(baseTheme, new Map([
      ["assets/background.webp", webp()],
      ["preview.webp", webp(PREVIEW_LIMIT + 1)],
    ]))).toThrow(/PREVIEW_TOO_LARGE|preview/i);

    const packagePng = png(11 * 1024 * 1024);
    const oversizedPackage = {
      ...baseTheme,
      assets: {
        background: "assets/background.png",
        decorations: {
          first: "assets/first.png",
          second: "assets/second.png",
        },
      },
    };
    expect(() => validateThemeBundle(oversizedPackage, new Map([
      ["assets/background.png", packagePng],
      ["assets/first.png", packagePng],
      ["assets/second.png", packagePng],
    ]))).toThrow(/32 MB/i);
  });

  it("requires public themes to include provenance", () => {
    expect(() => validateThemeBundle({
      ...baseTheme,
      rights: { licenseId: "x", localOnly: false },
    }, new Map([
      ["assets/background.webp", webp()],
    ]))).toThrow(/attribution/i);
  });

  it("rejects every bundled media file for a local-only recipe", () => {
    const recipe = {
      ...baseTheme,
      kind: "recipe",
      id: "hatsune-miku-local",
      assets: {},
      rights: { licenseId: "LicenseRef-User-Supplied", localOnly: true },
    };
    expect(() => validateThemeBundle(recipe, new Map([["preview.webp", webp()]]))).toThrow(/recipe/i);
  });
});
