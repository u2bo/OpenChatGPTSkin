import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseThemeDocument } from "@open-chatgpt-skin/theme-schema";
import { buildCharacterTheme } from "../scripts/character-theme-builder.js";

async function fixtureTheme() {
  const existing = JSON.parse(await readFile(
    resolve("themes/builtin/mountain-mist/theme.json"),
    "utf8",
  ));
  const theme = parseThemeDocument(existing);
  return {
    ...theme,
    schemaVersion: 4 as const,
    id: "fixture-character",
    name: "Fixture Character",
    version: "1.0.0",
    assets: {
      background: "assets/background.webp",
      profileAvatar: "assets/profile-avatar.webp",
      suggestionIcons: {
        card1: "assets/suggestion-card1.webp",
        card2: "assets/suggestion-card2.webp",
        card3: "assets/suggestion-card3.webp",
        card4: "assets/suggestion-card4.webp",
      },
    },
    composition: { layers: [] },
  };
}

function standardOutputs() {
  return {
    "assets/background.webp": { kind: "file", file: "assets/background.png" },
    "assets/profile-avatar.webp": {
      kind: "background-crop",
      positionX: 0.7,
      positionY: 0.3,
    },
    "assets/suggestion-card1.webp": {
      kind: "background-crop",
      positionX: 0.2,
      positionY: 0.25,
    },
    "assets/suggestion-card2.webp": {
      kind: "background-crop",
      positionX: 0.8,
      positionY: 0.25,
    },
    "assets/suggestion-card3.webp": {
      kind: "background-crop",
      positionX: 0.2,
      positionY: 0.75,
    },
    "assets/suggestion-card4.webp": {
      kind: "background-crop",
      positionX: 0.8,
      positionY: 0.75,
    },
    "preview.webp": {
      kind: "background-crop",
      positionX: 0.5,
      positionY: 0.5,
    },
  };
}

async function createFixture(caseName = "valid") {
  const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-character-"));
  const sourceRoot = join(root, "sources", "fixture-character");
  const outputRoot = join(root, "builtin", "fixture-character");
  await mkdir(join(sourceRoot, "assets"), { recursive: true });
  if (caseName !== "missing background") {
    await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: "#d7e7df",
      },
    }).png().toFile(join(sourceRoot, "assets", "background.png"));
  }
  const theme = await fixtureTheme();
  const outputs: Record<string, unknown> = standardOutputs();
  const provenance: unknown[] = caseName === "missing public provenance" ? [] : [{
    file: "assets/background.png",
    licenseId: "LicenseRef-Test-Original",
    attribution: "Test fixture author",
    source: "https://example.com/fixture",
    generationPrompt: "A neutral test background.",
  }];
  if (caseName === "undeclared output asset") {
    outputs["assets/extra.webp"] = {
      kind: "file",
      file: "assets/background.png",
    };
  }
  if (caseName === "duplicate layer id") {
    theme.assets.decorations = { layer: "assets/layer.webp" };
    outputs["assets/layer.webp"] = {
      kind: "file",
      file: "assets/background.png",
    };
    const layer = {
      id: "same-layer",
      asset: { kind: "decoration" as const, assetKey: "layer" },
      surface: "home-hero" as const,
      anchor: "top-left" as const,
      positionX: 0.1,
      positionY: 0.1,
      width: 0.2,
      opacity: 1,
      rotation: 0,
      required: false,
    };
    theme.composition = { layers: [layer, { ...layer }] };
  }
  if (caseName === "opaque decoration source") {
    theme.assets.decorations = { layer: "assets/layer.webp" };
    outputs["assets/layer.webp"] = {
      kind: "file",
      file: "assets/background.png",
    };
    theme.composition = { layers: [{
      id: "opaque-layer",
      asset: { kind: "decoration", assetKey: "layer" },
      surface: "viewport",
      anchor: "top-left",
      positionX: 0,
      positionY: 0,
      width: 0.2,
      opacity: 1,
      rotation: 0,
      required: true,
    }] };
  }
  await writeFile(join(sourceRoot, "template.json"), JSON.stringify({
    theme,
    outputs,
    provenance,
  }, null, 2));
  return { sourceRoot, outputRoot };
}

describe("standard character theme builder", () => {
  it("builds a v4 package from one standard source directory", async () => {
    const { sourceRoot, outputRoot } = await createFixture();

    const entry = await buildCharacterTheme(sourceRoot, outputRoot);
    const theme = JSON.parse(await readFile(join(outputRoot, "theme.json"), "utf8"));

    expect(theme).toMatchObject({ schemaVersion: 4, id: "fixture-character" });
    expect(entry.preview).toBe("builtin/fixture-character/preview.webp");
    expect(await readFile(join(outputRoot, "manifest.json"), "utf8"))
      .toContain("assets/profile-avatar.webp");
    expect(await readFile(join(outputRoot, "LICENSE.md"), "utf8"))
      .toContain("Test fixture author");
  });

  it.each([
    ["missing background", "BUILTIN_SOURCE_MISSING"],
    ["missing public provenance", "BUILTIN_PROVENANCE_INVALID"],
    ["undeclared output asset", "ASSET_UNDECLARED"],
    ["duplicate layer id", "THEME_COMPOSITION_INVALID"],
    ["opaque decoration source", "BUILTIN_SOURCE_MISSING"],
  ] as const)("fails atomically for %s", async (caseName, code) => {
    const { sourceRoot, outputRoot } = await createFixture(caseName);

    await expect(buildCharacterTheme(sourceRoot, outputRoot))
      .rejects.toMatchObject({ code });
    await expect(access(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
