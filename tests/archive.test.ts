import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_MODULES } from "@open-chatgpt-skin/theme-schema";
import {
  createOcskinFiles,
  OCSKIN_MAX_ARCHIVE_BYTES,
  OCSKIN_MAX_EXPANDED_BYTES,
  packTheme,
  unpackTheme,
  validateThemeBundle,
} from "@open-chatgpt-skin/theme-core";

const MB = 1024 * 1024;
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const theme = {
  schemaVersion: 1,
  kind: "theme",
  id: "archive-demo",
  name: "Archive",
  version: "1.0.0",
  author: "test",
  assets: { background: "assets/background.png" },
  colors: {
    accent: "#112233",
    secondary: "#223344",
    text: "#ffffff",
    muted: "#aabbcc",
    panel: "#101010",
    border: "#333333",
    success: "#228855",
    warning: "#bb7711",
    danger: "#cc3344",
    info: "#3388cc",
  },
  typography: {
    uiFamily: "Segoe UI",
    codeFamily: "Cascadia Code",
    scale: 1,
    uiSize: 14,
    codeSize: 13,
    uiWeight: 500,
    codeWeight: 400,
    lineHeight: 1.5,
  },
  background: {
    positionX: 0.5,
    positionY: 0.5,
    scale: 1,
    blur: 0,
    brightness: 1,
    overlay: 0.2,
  },
  decorations: [],
  layout: {
    heroHeight: 320,
    cardColumns: 4,
    composerWidth: 0.7,
    sidebarDensity: "comfortable",
    moduleGap: 16,
    modules: DEFAULT_LAYOUT_MODULES,
  },
  rights: { licenseId: "test", attribution: "test", localOnly: false },
};

describe("ocskin archive", () => {
  it("exports the documented archive limits", () => {
    expect(OCSKIN_MAX_ARCHIVE_BYTES).toBe(32 * MB);
    expect(OCSKIN_MAX_EXPANDED_BYTES).toBe(32 * MB);
  });

  it("round-trips a validated theme", async () => {
    const bundle = validateThemeBundle(theme, new Map([["assets/background.png", png]]));
    expect((await unpackTheme(packTheme(bundle))).theme).toEqual(bundle.theme);
  });

  it("round-trips shared and custom interface imagery without duplicating files", async () => {
    const migrated = validateThemeBundle(theme, new Map([
      ["assets/background.png", png],
    ])).theme;
    const bundle = validateThemeBundle({
      ...migrated,
      assets: {
        ...migrated.assets,
        profileAvatar: "assets/background.png",
        suggestionIcons: {
          card1: "assets/background.png",
          card2: "assets/card2.png",
        },
      },
    }, new Map([
      ["assets/background.png", png],
      ["assets/card2.png", Uint8Array.from([...png, 0x01])],
    ]));

    const unpacked = await unpackTheme(packTheme(bundle));

    expect(unpacked.theme.assets.profileAvatar).toBe("assets/background.png");
    expect(unpacked.theme.assets.suggestionIcons?.card2).toBe("assets/card2.png");
    expect(unpacked.files.size).toBe(2);
  });

  it("rejects unsafe, executable, and case-colliding entries before extraction", async () => {
    const traversal = zipSync({
      "../escape.js": strToU8("alert(1)"),
      "theme.json": strToU8(JSON.stringify(theme)),
    });
    await expect(unpackTheme(traversal)).rejects.toMatchObject({ code: "ARCHIVE_ENTRY_UNSAFE" });

    await expect(unpackTheme(zipSync({
      "run.js": strToU8("alert(1)"),
      "theme.json": strToU8(JSON.stringify(theme)),
    }))).rejects.toMatchObject({ code: "ARCHIVE_ENTRY_UNSUPPORTED" });

    await expect(unpackTheme(zipSync({
      "assets/Background.png": png,
      "assets/background.png": png,
    }))).rejects.toMatchObject({ code: "ARCHIVE_ENTRY_DUPLICATE" });
  });

  it("rejects invalid manifests, hash tampering, and file-set drift", async () => {
    const bundle = validateThemeBundle(theme, new Map([["assets/background.png", png]]));
    await expect(unpackTheme(zipSync({
      "theme.json": strToU8(JSON.stringify(theme)),
      "manifest.json": strToU8("{"),
    }))).rejects.toMatchObject({ code: "ARCHIVE_MANIFEST_INVALID" });

    const tamperedEntries = Object.fromEntries(createOcskinFiles(bundle));
    tamperedEntries["assets/background.png"] = Uint8Array.from([...png, 0x01]);
    await expect(unpackTheme(zipSync(tamperedEntries)))
      .rejects.toMatchObject({ code: "ARCHIVE_HASH_MISMATCH" });

    const missingEntry = Object.fromEntries(createOcskinFiles(bundle));
    delete missingEntry["assets/background.png"];
    await expect(unpackTheme(zipSync(missingEntry)))
      .rejects.toMatchObject({ code: "ARCHIVE_MANIFEST_MISMATCH" });
  });

  it("rejects oversized compressed and expanded packages", async () => {
    await expect(unpackTheme(new Uint8Array(32 * MB + 1)))
      .rejects.toMatchObject({ code: "PACKAGE_TOO_LARGE" });

    const expandedBomb = zipSync({
      "assets/oversized.png": new Uint8Array(32 * MB + 1),
    }, { level: 9 });
    await expect(unpackTheme(expandedBomb))
      .rejects.toMatchObject({ code: "PACKAGE_EXPANDED_TOO_LARGE" });
  });
});
