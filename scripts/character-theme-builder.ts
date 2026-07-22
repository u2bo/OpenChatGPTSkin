import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  parseThemeDocument,
  themeAssetPaths,
  type ThemeDraftDocument,
} from "../packages/theme-schema/src/index.js";
import {
  createOcskinFiles,
  ThemeValidationError,
  validateThemeBundle,
  type ThemeCatalogEntry,
} from "../packages/theme-core/src/index.js";
import {
  CharacterThemeTemplateSchema,
  type CharacterThemeOutputSource,
  type CharacterThemeTemplate,
  type SourceProvenance,
} from "./character-theme-template.js";

const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_FONT_BYTES = 5 * 1024 * 1024;

const TemplateEnvelopeSchema = z.object({
  theme: z.unknown(),
  outputs: z.record(z.string(), z.unknown()),
  provenance: z.array(z.unknown()),
}).strict();

export class CharacterThemeBuildError extends Error {
  constructor(
    public readonly code:
      | "BUILTIN_SOURCE_MISSING"
      | "BUILTIN_PROVENANCE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CharacterThemeBuildError";
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "ENOENT";
}

function assertInside(root: string, path: string): void {
  const normalizedRoot = `${resolve(root)}${sep}`.toLowerCase();
  const normalizedPath = resolve(path).toLowerCase();
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new CharacterThemeBuildError(
      "BUILTIN_SOURCE_MISSING",
      `Source path escapes the theme source directory: ${path}`,
    );
  }
}

async function readRequiredSource(
  sourceDirectory: string,
  relativePath: string,
): Promise<Uint8Array> {
  const path = join(sourceDirectory, ...relativePath.split("/"));
  assertInside(sourceDirectory, path);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1) {
      throw new CharacterThemeBuildError(
        "BUILTIN_SOURCE_MISSING",
        `Declared source is not a non-empty file: ${relativePath}`,
      );
    }
    const lower = relativePath.toLowerCase();
    if (lower.endsWith(".woff2") && info.size > MAX_SOURCE_FONT_BYTES) {
      throw new CharacterThemeBuildError(
        "BUILTIN_SOURCE_MISSING",
        `Source font exceeds 5 MiB: ${relativePath}`,
      );
    }
    if (!lower.endsWith(".woff2") && info.size > MAX_SOURCE_IMAGE_BYTES) {
      throw new CharacterThemeBuildError(
        "BUILTIN_SOURCE_MISSING",
        `Source image exceeds 50 MiB: ${relativePath}`,
      );
    }
    const bytes = await readFile(path);
    if (lower.endsWith(".woff2")) {
      if (bytes.subarray(0, 4).toString("ascii") !== "wOF2") {
        throw new CharacterThemeBuildError(
          "BUILTIN_SOURCE_MISSING",
          `Source font has invalid WOFF2 magic: ${relativePath}`,
        );
      }
    } else {
      try {
        const metadata = await sharp(bytes).metadata();
        if (!metadata.width || !metadata.height ||
          !["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
          throw new Error("unsupported image metadata");
        }
      } catch (error) {
        throw new CharacterThemeBuildError(
          "BUILTIN_SOURCE_MISSING",
          `Source image is invalid: ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return bytes;
  } catch (error) {
    if (isNotFound(error)) {
      throw new CharacterThemeBuildError(
        "BUILTIN_SOURCE_MISSING",
        `Declared source is missing: ${relativePath}`,
      );
    }
    throw error;
  }
}

function parseTemplate(value: unknown): CharacterThemeTemplate {
  const envelope = TemplateEnvelopeSchema.parse(value);
  const theme = parseThemeDocument(envelope.theme);
  const parsed = CharacterThemeTemplateSchema.safeParse({ ...envelope, theme });
  if (!parsed.success && parsed.error.issues.some((issue) =>
    issue.path[0] === "provenance"
  )) {
    throw new CharacterThemeBuildError(
      "BUILTIN_PROVENANCE_INVALID",
      parsed.error.message,
    );
  }
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

function outputDimensions(
  outputPath: string,
  theme: ThemeDraftDocument,
): { readonly width: number; readonly height: number; readonly fit: "cover" | "inside" } {
  if (outputPath === "preview.webp") return { width: 1200, height: 675, fit: "cover" };
  if (outputPath === theme.assets.background) {
    return { width: 2400, height: 1350, fit: "cover" };
  }
  if (outputPath === theme.assets.profileAvatar) {
    return { width: 256, height: 256, fit: "cover" };
  }
  if (Object.values(theme.assets.suggestionIcons ?? {}).includes(outputPath)) {
    return { width: 192, height: 192, fit: "cover" };
  }
  if (outputPath === theme.assets.portrait) {
    return { width: 1600, height: 1800, fit: "inside" };
  }
  return { width: 2048, height: 2048, fit: "inside" };
}

async function normalizedImage(
  bytes: Uint8Array,
  outputPath: string,
  theme: ThemeDraftDocument,
  focalPoint?: { readonly positionX: number; readonly positionY: number },
): Promise<Uint8Array> {
  const dimensions = outputDimensions(outputPath, theme);
  const oriented = await sharp(bytes).rotate().toBuffer();
  if (dimensions.fit === "inside") {
    return sharp(oriented)
      .resize(dimensions.width, dimensions.height, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer();
  }
  if (!focalPoint) {
    return sharp(oriented)
      .resize(dimensions.width, dimensions.height, { fit: "cover" })
      .webp({ quality: outputPath === "preview.webp" ? 72 : 84 })
      .toBuffer();
  }
  const metadata = await sharp(oriented).metadata();
  const sourceWidth = metadata.width!;
  const sourceHeight = metadata.height!;
  const targetRatio = dimensions.width / dimensions.height;
  const sourceRatio = sourceWidth / sourceHeight;
  const cropWidth = sourceRatio > targetRatio
    ? Math.round(sourceHeight * targetRatio)
    : sourceWidth;
  const cropHeight = sourceRatio > targetRatio
    ? sourceHeight
    : Math.round(sourceWidth / targetRatio);
  const left = Math.round(Math.min(
    Math.max(0, focalPoint.positionX * sourceWidth - cropWidth / 2),
    sourceWidth - cropWidth,
  ));
  const top = Math.round(Math.min(
    Math.max(0, focalPoint.positionY * sourceHeight - cropHeight / 2),
    sourceHeight - cropHeight,
  ));
  return sharp(oriented)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(dimensions.width, dimensions.height, { fit: "fill" })
    .webp({ quality: outputPath === "preview.webp" ? 72 : 84 })
    .toBuffer();
}

function provenanceByFile(
  template: CharacterThemeTemplate,
): ReadonlyMap<string, SourceProvenance> {
  const result = new Map<string, SourceProvenance>();
  for (const value of template.provenance) {
    if (result.has(value.file)) {
      throw new CharacterThemeBuildError(
        "BUILTIN_PROVENANCE_INVALID",
        `Duplicate provenance entry: ${value.file}`,
      );
    }
    result.set(value.file, value);
  }
  return result;
}

function backgroundSource(template: CharacterThemeTemplate): CharacterThemeOutputSource {
  const source = template.outputs[template.theme.assets.background ?? ""];
  if (!source || source.kind !== "file") {
    throw new CharacterThemeBuildError(
      "BUILTIN_SOURCE_MISSING",
      "The background output must declare a file source",
    );
  }
  return source;
}

async function buildOutputs(
  sourceDirectory: string,
  template: CharacterThemeTemplate,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const declared = new Set([...themeAssetPaths(template.theme), "preview.webp"]);
  const sourceProvenance = provenanceByFile(template);
  const fileSources = new Set(Object.values(template.outputs).flatMap((source) =>
    source.kind === "file" ? [source.file] : []
  ));
  for (const file of fileSources) {
    if (!sourceProvenance.has(file)) {
      throw new CharacterThemeBuildError(
        "BUILTIN_PROVENANCE_INVALID",
        `Missing provenance for declared source: ${file}`,
      );
    }
  }
  for (const file of sourceProvenance.keys()) {
    if (!fileSources.has(file)) {
      throw new CharacterThemeBuildError(
        "BUILTIN_PROVENANCE_INVALID",
        `Provenance does not match a declared source: ${file}`,
      );
    }
  }
  const primaryBackground = backgroundSource(template);
  const cache = new Map<string, Uint8Array>();
  const sourceBytes = async (file: string) => {
    const existing = cache.get(file);
    if (existing) return existing;
    const bytes = await readRequiredSource(sourceDirectory, file);
    cache.set(file, bytes);
    return bytes;
  };
  const files = new Map<string, Uint8Array>();
  for (const [outputPath, source] of Object.entries(template.outputs)) {
    const input = await sourceBytes(
      source.kind === "file" ? source.file : primaryBackground.file,
    );
    if (outputPath.toLowerCase().endsWith(".woff2")) {
      if (source.kind !== "file") {
        throw new CharacterThemeBuildError(
          "BUILTIN_SOURCE_MISSING",
          `Font output requires a file source: ${outputPath}`,
        );
      }
      files.set(outputPath, input);
      continue;
    }
    files.set(outputPath, await normalizedImage(
      input,
      outputPath,
      template.theme,
      source.kind === "background-crop" ? source : undefined,
    ));
  }
  for (const outputPath of declared) {
    if (!files.has(outputPath)) {
      throw new ThemeValidationError(
        "ASSET_MISSING",
        `Missing output declaration: ${outputPath}`,
      );
    }
  }
  return files;
}

async function sourceHashes(
  sourceDirectory: string,
  template: CharacterThemeTemplate,
): Promise<ReadonlyMap<string, string>> {
  const result = new Map<string, string>();
  for (const source of template.provenance) {
    result.set(source.file, sha256(await readRequiredSource(sourceDirectory, source.file)));
  }
  return result;
}

function generatedLicense(
  template: CharacterThemeTemplate,
  sources: ReadonlyMap<string, string>,
  outputs: ReadonlyMap<string, Uint8Array>,
): string {
  const lines = [
    `# ${template.theme.name} asset provenance`,
    "",
    `- Theme ID: ${template.theme.id}`,
    `- Theme license: ${template.theme.rights.licenseId}`,
    "",
  ];
  for (const source of template.provenance) {
    lines.push(
      `## ${source.file}`,
      "",
      `- License: ${source.licenseId}`,
      `- Attribution: ${source.attribution}`,
      `- Source: ${source.source}`,
      `- Source SHA-256: ${sources.get(source.file)}`,
      ...(source.generationPrompt ? [`- Prompt: ${source.generationPrompt}`] : []),
      "",
    );
  }
  for (const [path, bytes] of outputs) {
    lines.push(`- Output SHA-256 (${path}): ${sha256(bytes)}`);
  }
  const background = outputs.get(template.theme.assets.background ?? "");
  if (background) lines.push(`- Background SHA-256: ${sha256(background)}`);
  lines.push("");
  return lines.join("\n");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function writeStage(
  stage: string,
  files: ReadonlyMap<string, Uint8Array>,
  license: string,
): Promise<void> {
  for (const [name, bytes] of files) {
    const path = join(stage, ...name.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  await writeFile(join(stage, "LICENSE.md"), license);
}

async function swapDirectory(stage: string, outputDirectory: string): Promise<void> {
  const parent = dirname(outputDirectory);
  const backup = join(parent, `.${basename(outputDirectory)}.backup-${randomUUID()}`);
  const hadOutput = await pathExists(outputDirectory);
  if (hadOutput) await rename(outputDirectory, backup);
  try {
    await rename(stage, outputDirectory);
  } catch (error) {
    if (hadOutput && await pathExists(backup) && !await pathExists(outputDirectory)) {
      await rename(backup, outputDirectory);
    }
    throw error;
  }
  if (hadOutput) await rm(backup, { recursive: true, force: true });
}

export async function buildCharacterTheme(
  sourceDirectory: string,
  outputDirectory: string,
): Promise<ThemeCatalogEntry> {
  const resolvedSource = resolve(sourceDirectory);
  const resolvedOutput = resolve(outputDirectory);
  const raw = JSON.parse(await readFile(join(resolvedSource, "template.json"), "utf8"));
  const template = parseTemplate(raw);
  if (basename(resolvedSource) !== template.theme.id ||
    basename(resolvedOutput) !== template.theme.id) {
    throw new ThemeValidationError(
      "THEME_SCHEMA_INVALID",
      "Source and output directory names must match the theme ID",
    );
  }
  const outputFiles = await buildOutputs(resolvedSource, template);
  const bundle = validateThemeBundle(template.theme, outputFiles);
  const packageFiles = createOcskinFiles(bundle);
  const hashes = await sourceHashes(resolvedSource, template);
  const license = generatedLicense(template, hashes, outputFiles);
  const parent = dirname(resolvedOutput);
  const stage = join(parent, `.${basename(resolvedOutput)}.stage-${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    await writeStage(stage, packageFiles, license);
    await swapDirectory(stage, resolvedOutput);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return {
    id: template.theme.id,
    name: template.theme.name,
    version: template.theme.version,
    kind: "theme",
    path: `builtin/${template.theme.id}`,
    ready: true,
    localOnly: template.theme.rights.localOnly,
    licenseId: template.theme.rights.licenseId,
    preview: `builtin/${template.theme.id}/preview.webp`,
  };
}
