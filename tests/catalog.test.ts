import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  parseThemeDocument,
  themeAssetPaths,
} from "@open-chatgpt-skin/theme-schema";
import {
  createOcskinFiles,
  loadThemeCatalog,
  ThemeCatalogSchema,
  validateThemeBundle,
} from "@open-chatgpt-skin/theme-core";
import { validateStudioDraft } from "@open-chatgpt-skin/theme-studio-core";
import { CharacterThemeTemplateSchema } from
  "../scripts/character-theme-template.js";

describe("built-in catalog", () => {
  it("ships five complete public themes without local authorization recipes", async () => {
    const catalog = await loadThemeCatalog(resolve("themes"));
    expect(catalog.builtins.map((entry) => entry.id)).toEqual([
      "future-idol-cyan",
      "glacier-aurora",
      "mountain-mist",
      "rose-carpet-star",
      "yua-mikami-starlight",
    ]);
    expect(catalog.recipes).toEqual([]);
    expect(catalog.builtins.every((entry) => entry.ready)).toBe(true);
    expect(catalog.builtins.filter((entry) => entry.id !== "yua-mikami-starlight")
      .every((entry) => entry.licenseId === "LicenseRef-OpenChatGPTSkin-Original"))
      .toBe(true);
    expect(catalog.builtins.find((entry) => entry.id === "yua-mikami-starlight")?.licenseId)
      .toBe("LicenseRef-OpenChatGPTSkin-Mixed-Authorized");
    expect((await readdir(resolve("themes", "sources"))).sort()).toEqual([
      "future-idol-cyan",
      "glacier-aurora",
      "mountain-mist",
      "rose-carpet-star",
      "yua-mikami-starlight",
    ]);

    for (const entry of catalog.builtins) {
      const directory = resolve("themes", entry.path);
      const theme = parseThemeDocument(JSON.parse(
        await readFile(join(directory, "theme.json"), "utf8"),
      ));
      expect(theme.metadata?.homepage).toBe(
        "https://github.com/u2bo/OpenChatGPTSkin.git",
      );
      expect(validateStudioDraft(theme).filter((issue) => issue.severity === "error"))
        .toEqual([]);
      const files = new Map<string, Uint8Array>();
      for (const name of themeAssetPaths(theme)) {
        files.set(name, await readFile(join(directory, ...name.split("/"))));
      }
      files.set("preview.webp", await readFile(join(directory, "preview.webp")));
      const bundle = validateThemeBundle(theme, files);
      const expectedManifest = createOcskinFiles(bundle).get("manifest.json");
      expect(expectedManifest).toBeDefined();
      expect(Buffer.from(expectedManifest!).equals(
        await readFile(join(directory, "manifest.json")),
      )).toBe(true);

      const license = await readFile(join(directory, "LICENSE.md"), "utf8");
      expect(license).toContain("Source SHA-256");
      expect(license).toContain("Background SHA-256");
      expect(license).toContain("Prompt:");
      expect(license).toContain(entry.id === "yua-mikami-starlight"
        ? "Authorized portrait background supplied by the OpenChatGPTSkin project owner"
        : "Original AI-generated background supplied by the OpenChatGPTSkin project owner");
      const sourceDirectory = resolve("themes", "sources", entry.id);
      const template = CharacterThemeTemplateSchema.parse(JSON.parse(
        await readFile(join(sourceDirectory, "template.json"), "utf8"),
      ));
      expect(template.theme.id).toBe(entry.id);
      const sourcePath = join(sourceDirectory, "assets", "background.png");
      const sourceInfo = await stat(sourcePath);
      expect(sourceInfo.isFile()).toBe(true);
      expect(sourceInfo.size).toBeLessThanOrEqual(50 * 1024 * 1024);
      const sourceMetadata = await sharp(sourcePath).metadata();
      expect(sourceMetadata.format).toBe("png");
      expect(sourceMetadata.width).toBeGreaterThanOrEqual(1600);
      expect(sourceMetadata.height).toBeGreaterThanOrEqual(900);
      expect(sourceMetadata.width! / sourceMetadata.height!).toBeCloseTo(16 / 9, 2);
      expect(theme).toMatchObject({
        schemaVersion: 4,
        assets: {
          profileAvatar: "assets/profile-avatar.webp",
          suggestionIcons: {
            card1: "assets/suggestion-card1.webp",
            card2: "assets/suggestion-card2.webp",
            card3: "assets/suggestion-card3.webp",
            card4: "assets/suggestion-card4.webp",
          },
        },
        background: {
          blur: 0,
          brightness: 1,
          overlay: 0,
          safeArea: "none",
          taskMode: "full",
          taskOpacity: 0.18,
        },
        surfaces: { blur: 0 },
      });
      expect(theme.surfaces.baseOpacity, entry.id)
        .toBe(entry.id === "yua-mikami-starlight"
          ? 0.18
          : theme.appearance === "dark" ? 0.26 : 0.2);
      if (entry.id === "yua-mikami-starlight") {
        expect(theme).toMatchObject({
          version: "1.0.0",
          background: { scale: 1 },
          typography: {
            displayFamily: "ocs-display",
            displayFontAssetKey: "display",
          },
          assets: {
            fonts: { display: "fonts/display.woff2" },
            decorations: {
              "hero-signature": "assets/hero-signature.webp",
              "corner-signature": "assets/corner-signature.webp",
              "vertical-tag": "assets/vertical-tag.webp",
              "love-code-create": "assets/love-code-create.webp",
            },
          },
          home: {
            welcome: {
              localized: {
                "zh-CN": { lines: ["在「{projectName}」中，", "你想一起打造什么呢？"] },
              },
            },
          },
          composition: { layers: expect.arrayContaining([
            expect.objectContaining({ id: "hero-signature", required: true }),
            expect.objectContaining({ id: "corner-signature", required: true }),
            expect.objectContaining({ id: "vertical-tag", required: true }),
            expect.objectContaining({ id: "love-code-create", required: true }),
          ]) },
        });
        for (const path of [
          "assets/hero-signature.webp",
          "assets/corner-signature.webp",
          "assets/vertical-tag.webp",
          "assets/love-code-create.webp",
        ]) {
          const metadata = await sharp(join(directory, ...path.split("/"))).metadata();
          expect(metadata.hasAlpha, path).toBe(true);
        }
      } else {
        expect(theme).toMatchObject({ version: "1.3.0", background: { scale: 1.05 } });
      }
    }

    for (const entry of catalog.recipes) {
      const recipe = parseThemeDocument(JSON.parse(
        await readFile(resolve("themes", entry.path, "recipe.json"), "utf8"),
      ));
      expect(recipe.kind).toBe("recipe");
      expect(recipe.assets).toEqual({});
    }
  });

  it("rejects unsafe or inconsistent catalog paths", async () => {
    const catalog = await loadThemeCatalog(resolve("themes"));
    const first = catalog.builtins.at(0);
    if (!first) throw new Error("expected at least one built-in theme");
    expect(() => ThemeCatalogSchema.parse({
      ...catalog,
      builtins: [{ ...first, path: "../escape" }, ...catalog.builtins.slice(1)],
    })).toThrow();
  });
});
