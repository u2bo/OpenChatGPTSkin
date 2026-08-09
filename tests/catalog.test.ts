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
  it("ships eight complete public themes without local authorization recipes", async () => {
    const catalog = await loadThemeCatalog(resolve("themes"));
    expect(catalog.builtins.map((entry) => entry.id)).toEqual([
      "future-idol-cyan",
      "glacier-aurora",
      "goku-saiyan-engine",
      "hoshimiya-ichigo-shining-stage",
      "mountain-mist",
      "rose-carpet-star",
      "tibo-cyber-core",
      "yua-mikami-starlight",
    ]);
    expect(catalog.recipes).toEqual([]);
    expect(catalog.builtins.every((entry) => entry.ready)).toBe(true);
    const authorizedCharacterIds = new Set([
      "goku-saiyan-engine",
      "hoshimiya-ichigo-shining-stage",
      "tibo-cyber-core",
      "yua-mikami-starlight",
    ]);
    expect(catalog.builtins.filter((entry) => !authorizedCharacterIds.has(entry.id))
      .every((entry) => entry.licenseId === "LicenseRef-OpenChatGPTSkin-Original"))
      .toBe(true);
    expect(catalog.builtins.find((entry) =>
      entry.id === "hoshimiya-ichigo-shining-stage")?.licenseId)
      .toBe("LicenseRef-OpenChatGPTSkin-Mixed-User-Supplied");
    expect(catalog.builtins.find((entry) => entry.id === "yua-mikami-starlight")?.licenseId)
      .toBe("LicenseRef-OpenChatGPTSkin-Mixed-Authorized");
    expect(catalog.builtins.find((entry) => entry.id === "tibo-cyber-core")?.licenseId)
      .toBe("LicenseRef-OpenChatGPTSkin-User-Supplied-Tibo");
    expect((await readdir(resolve("themes", "sources"))).sort()).toEqual([
      "future-idol-cyan",
      "glacier-aurora",
      "goku-saiyan-engine",
      "hoshimiya-ichigo-shining-stage",
      "mountain-mist",
      "rose-carpet-star",
      "tibo-cyber-core",
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
      expect(license).toContain(
        entry.id === "yua-mikami-starlight"
          ? "Authorized portrait background supplied by the OpenChatGPTSkin project owner"
          : entry.id === "goku-saiyan-engine"
            ? "Character background supplied by the OpenChatGPTSkin project owner"
            : entry.id === "hoshimiya-ichigo-shining-stage"
              ? "Character stage background supplied by the OpenChatGPTSkin project owner"
              : entry.id === "tibo-cyber-core"
                ? "Tibo concept and portrait background supplied by the OpenChatGPTSkin project owner"
            : "Original AI-generated background supplied by the OpenChatGPTSkin project owner",
      );
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
          brightness: entry.id === "future-idol-cyan" ? 1.1 :
            entry.id === "glacier-aurora" ? 1.05 :
              entry.id === "goku-saiyan-engine" ? 1.06 :
              entry.id === "tibo-cyber-core" ? 1.04 :
              ["hoshimiya-ichigo-shining-stage", "mountain-mist", "rose-carpet-star"]
                .includes(entry.id) ? 1.08 : 1,
          overlay: 0,
          safeArea: entry.id === "tibo-cyber-core" ? "left" : "none",
          taskMode: "full",
          taskOpacity: entry.id === "goku-saiyan-engine" ? 0.14 :
            ["hoshimiya-ichigo-shining-stage", "tibo-cyber-core"]
              .includes(entry.id) ? 0.16 : 0.18,
        },
        surfaces: { blur: 0 },
      });
      expect(theme.surfaces.baseOpacity, entry.id).toBe(
        entry.id === "goku-saiyan-engine" ? 0.12 :
          entry.id === "tibo-cyber-core" ? 0.12 :
          entry.id === "yua-mikami-starlight" ? 0.18 :
          ["future-idol-cyan", "hoshimiya-ichigo-shining-stage"].includes(entry.id)
            ? 0.14 :
            entry.id === "glacier-aurora" ? 0.2 : 0.16,
      );
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
      } else if (entry.id === "goku-saiyan-engine") {
        expect(theme).toMatchObject({
          version: "1.0.0",
          background: { scale: 1, brightness: 1.06, taskOpacity: 0.14 },
          interfaceImages: {
            profileAvatarSize: 26,
            suggestionIconSize: 56,
            projectIconSize: 20,
          },
          assets: {
            projectIcons: [
              "assets/suggestion-card4.webp",
              "assets/suggestion-card1.webp",
              "assets/suggestion-card3.webp",
              "assets/suggestion-card2.webp",
            ],
          },
          home: {
            welcome: {
              localized: {
                "zh-CN": { lines: ["我们应该在「{projectName}」", "中构建什么？"] },
              },
            },
          },
        });
        for (const path of [
          "assets/suggestion-card1.webp",
          "assets/suggestion-card2.webp",
          "assets/suggestion-card3.webp",
          "assets/suggestion-card4.webp",
        ]) {
          const metadata = await sharp(join(directory, ...path.split("/"))).metadata();
          expect(metadata.hasAlpha, path).toBe(true);
        }
      } else if (entry.id === "hoshimiya-ichigo-shining-stage") {
        expect(theme).toMatchObject({
          version: "1.0.0",
          background: { scale: 1, taskOpacity: 0.16 },
          interfaceImages: {
            profileAvatarSize: 26,
            suggestionIconSize: 52,
            projectIconSize: 20,
          },
          assets: {
            projectIcons: [
              "assets/suggestion-card4.webp",
              "assets/suggestion-card1.webp",
              "assets/suggestion-card3.webp",
              "assets/suggestion-card2.webp",
            ],
          },
          home: {
            welcome: {
              localized: {
                "zh-CN": { lines: ["我们应该在", "「{projectName}」中构建什么？"] },
              },
            },
          },
        });
        for (const path of [
          "assets/suggestion-card1.webp",
          "assets/suggestion-card2.webp",
          "assets/suggestion-card3.webp",
          "assets/suggestion-card4.webp",
        ]) {
          const metadata = await sharp(join(directory, ...path.split("/"))).metadata();
          expect(metadata.hasAlpha, path).toBe(true);
        }
      } else if (entry.id === "tibo-cyber-core") {
        expect(theme).toMatchObject({
          version: "1.0.0",
          colors: {
            accent: "#22e6d1",
            secondary: "#42b8ff",
            panel: "#021018",
            border: "rgba(34, 230, 209, 0.68)",
          },
          background: {
            positionX: 0.72,
            positionY: 0.46,
            scale: 1,
            brightness: 1.04,
            taskOpacity: 0.16,
          },
          surfaces: {
            baseOpacity: 0.12,
            elevatedOpacity: 0.46,
            terminalOpacity: 0.64,
          },
          typography: {
            displayFamily: "ocs-display",
            displayFontAssetKey: "display",
          },
          layout: { heroHeight: 540 },
          interfaceImages: {
            profileAvatarSize: 26,
            suggestionIconSize: 56,
            projectIconSize: 20,
          },
          assets: {
            fonts: { display: "fonts/display.woff2" },
            projectIcons: [
              "assets/suggestion-card2.webp",
              "assets/suggestion-card1.webp",
              "assets/suggestion-card4.webp",
              "assets/suggestion-card3.webp",
            ],
          },
          home: {
            welcome: {
              localized: {
                "zh-CN": { lines: ["欢迎回来，", "CODER · {projectName}"] },
              },
            },
          },
        });
        for (const path of [
          "assets/suggestion-card1.webp",
          "assets/suggestion-card2.webp",
          "assets/suggestion-card3.webp",
          "assets/suggestion-card4.webp",
        ]) {
          const metadata = await sharp(join(directory, ...path.split("/"))).metadata();
          expect(metadata.hasAlpha, path).toBe(true);
        }
      } else {
        expect(theme).toMatchObject({ version: "1.3.1", background: { scale: 1.05 } });
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
