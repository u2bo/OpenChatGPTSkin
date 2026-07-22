import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import {
  DEFAULT_LAYOUT_MODULES,
  parseThemeDocument,
} from "../packages/theme-schema/src/index.js";
import {
  createOcskinFiles,
  ThemeCatalogSchema,
  validateThemeBundle,
  type ThemeCatalogEntry,
} from "../packages/theme-core/src/index.js";
import { OPEN_CHATGPT_SKIN_REPOSITORY_URL } from
  "../packages/theme-studio-core/src/project.js";
import { BUILTIN_PRESETS } from "./builtin-presets.js";

const ROOT = resolve("themes");
const BUILTIN_ROOT = join(ROOT, "builtin");
const RECIPES: readonly string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

const builtins: ThemeCatalogEntry[] = [];
for (const preset of BUILTIN_PRESETS) {
  const directory = join(BUILTIN_ROOT, preset.id);
  const sourcePath = join(directory, "assets", "source.png");
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.size < 1 || sourceInfo.size > 50 * 1024 * 1024) {
    throw new Error(`SOURCE_IMAGE_INVALID: ${preset.id}`);
  }

  const background = await sharp(sourcePath)
    .rotate()
    .resize(2400, 1350, { fit: "cover" })
    .webp({ quality: 84 })
    .toBuffer();
  const preview = await sharp(sourcePath)
    .rotate()
    .resize(1200, 675, { fit: "cover" })
    .webp({ quality: 72 })
    .toBuffer();
  if (background.length > 16 * 1024 * 1024) {
    throw new Error(`BACKGROUND_TOO_LARGE: ${preset.id}`);
  }
  if (preview.length > 2 * 1024 * 1024) {
    throw new Error(`PREVIEW_TOO_LARGE: ${preset.id}`);
  }

  const theme = parseThemeDocument({
    schemaVersion: 3,
    kind: "theme",
    appearance: preset.appearance,
    id: preset.id,
    name: preset.name,
    version: preset.version,
    author: "OpenChatGPTSkin",
    description: preset.description,
    metadata: {
      homepage: OPEN_CHATGPT_SKIN_REPOSITORY_URL,
      localized: {
        en: {
          name: preset.nameEn,
          description: preset.descriptionEn,
        },
      },
    },
    assets: {
      background: "assets/background.webp",
      profileAvatar: "assets/background.webp",
      suggestionIcons: {
        card1: "assets/background.webp",
        card2: "assets/background.webp",
        card3: "assets/background.webp",
        card4: "assets/background.webp",
      },
    },
    colors: preset.colors,
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
    background: { ...preset.background, scale: 1.05, blur: 0 },
    surfaces: preset.surfaces,
    decorations: preset.decorations,
    layout: {
      heroHeight: 380,
      cardColumns: 4,
      composerWidth: 0.74,
      sidebarDensity: "comfortable",
      moduleGap: 16,
      modules: DEFAULT_LAYOUT_MODULES,
    },
    rights: {
      licenseId: "LicenseRef-OpenChatGPTSkin-Original",
      attribution: "Original AI-generated background supplied by the OpenChatGPTSkin project owner",
      localOnly: false,
    },
  });

  const bundle = validateThemeBundle(theme, new Map([
    ["assets/background.webp", background],
    ["preview.webp", preview],
  ]));
  const source = await readFile(sourcePath);
  const license = [
    `# ${theme.name} asset provenance`,
    "",
    "- License: LicenseRef-OpenChatGPTSkin-Original",
    "- Author: OpenChatGPTSkin",
    "- Generated: 2026-07-18",
    "- Generation method: AI-generated original background supplied by the project owner and normalized with Sharp",
    `- Source SHA-256: ${sha256(source)}`,
    `- Background SHA-256: ${sha256(background)}`,
    `- Prompt: ${preset.generationPrompt}`,
    "",
  ].join("\n");

  for (const [name, bytes] of createOcskinFiles(bundle)) {
    await atomicWrite(join(directory, ...name.split("/")), bytes);
  }
  await atomicWrite(join(directory, "LICENSE.md"), license);
  builtins.push({
    id: theme.id,
    name: theme.name,
    version: theme.version,
    kind: "theme",
    path: `builtin/${theme.id}`,
    ready: true,
    localOnly: false,
    licenseId: theme.rights.licenseId,
    preview: `builtin/${theme.id}/preview.webp`,
  });
}

const recipes: ThemeCatalogEntry[] = [];
for (const id of RECIPES) {
  const path = join(ROOT, "recipes", id, "recipe.json");
  const recipe = parseThemeDocument(JSON.parse(await readFile(path, "utf8")));
  recipes.push({
    id: recipe.id,
    name: recipe.name,
    version: recipe.version,
    kind: "recipe",
    path: `recipes/${recipe.id}`,
    ready: false,
    localOnly: true,
    licenseId: recipe.rights.licenseId,
  });
}

builtins.sort((left, right) => left.id.localeCompare(right.id));
recipes.sort((left, right) => left.id.localeCompare(right.id));
const catalog = ThemeCatalogSchema.parse({ schemaVersion: 1, builtins, recipes });
await atomicWrite(join(ROOT, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
