import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { parseThemeDocument } from "@open-chatgpt-skin/theme-schema";
import {
  createOcskinFiles,
  loadThemeCatalog,
  ThemeCatalogSchema,
  validateThemeBundle,
} from "@open-chatgpt-skin/theme-core";
import { validateStudioDraft } from "@open-chatgpt-skin/theme-studio-core";

describe("built-in catalog", () => {
  it("ships four complete public themes without local authorization recipes", async () => {
    const catalog = await loadThemeCatalog(resolve("themes"));
    expect(catalog.builtins.map((entry) => entry.id)).toEqual([
      "future-idol-cyan",
      "glacier-aurora",
      "mountain-mist",
      "rose-carpet-star",
    ]);
    expect(catalog.recipes).toEqual([]);
    expect(catalog.builtins.every((entry) =>
      entry.ready &&
      entry.licenseId === "LicenseRef-OpenChatGPTSkin-Original"
    )).toBe(true);

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
      const paths = [
        theme.assets.background,
        theme.assets.portrait,
        ...Object.values(theme.assets.decorations ?? {}),
        ...Object.values(theme.assets.fonts ?? {}),
      ].filter((value): value is string => Boolean(value));
      const files = new Map<string, Uint8Array>();
      for (const name of paths) {
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
      expect(license).toContain("AI-generated original background supplied by the project owner");
      const sourcePath = join(directory, "assets", "source.png");
      const sourceInfo = await stat(sourcePath);
      expect(sourceInfo.isFile()).toBe(true);
      expect(sourceInfo.size).toBeLessThanOrEqual(50 * 1024 * 1024);
      const sourceMetadata = await sharp(sourcePath).metadata();
      expect(sourceMetadata.format).toBe("png");
      expect(sourceMetadata.width).toBeGreaterThanOrEqual(1600);
      expect(sourceMetadata.height).toBeGreaterThanOrEqual(900);
      expect(sourceMetadata.width! / sourceMetadata.height!).toBeCloseTo(16 / 9, 2);
      expect(theme.surfaces.baseOpacity, entry.id).toBeLessThanOrEqual(0.46);
      expect(theme.surfaces.blur, entry.id).toBeLessThanOrEqual(4);
      expect(theme.background.taskOpacity, entry.id).toBeLessThanOrEqual(0.64);
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
