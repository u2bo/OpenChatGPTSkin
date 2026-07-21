import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseThemeDocument, type ThemeDocument } from "@open-chatgpt-skin/theme-schema";
import {
  THEME_MAX_FONT_BYTES,
  THEME_MAX_IMAGE_BYTES,
  THEME_MAX_PREVIEW_BYTES,
  validateThemeBundle,
} from "./assets.js";
import { ThemeValidationError } from "./errors.js";
import type { ValidatedThemeBundle } from "./types.js";

export class ThemeDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeDirectoryError";
  }
}

function referencedPaths(theme: ThemeDocument): string[] {
  return [
    theme.assets.background,
    theme.assets.portrait,
    ...Object.values(theme.assets.decorations ?? {}),
    ...Object.values(theme.assets.fonts ?? {}),
  ].filter((value): value is string => Boolean(value));
}

async function readBoundedFile(
  path: string,
  limit: number,
  tooLargeCode: string,
): Promise<Uint8Array> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new ThemeDirectoryError(`Asset is not a file: ${path}`);
  }
  if (info.size > limit) {
    throw new ThemeValidationError(tooLargeCode, `${path} exceeds its size limit`);
  }
  return readFile(path);
}

export async function loadThemeDirectory(directory: string): Promise<ValidatedThemeBundle> {
  const themeText = await readFile(join(directory, "theme.json"), "utf8");
  let theme: ThemeDocument;
  try {
    theme = parseThemeDocument(JSON.parse(themeText));
  } catch (error) {
    throw new ThemeValidationError(
      "THEME_SCHEMA_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }

  const files = new Map<string, Uint8Array>();
  for (const name of referencedPaths(theme)) {
    const isFont = name.toLowerCase().endsWith(".woff2");
    files.set(name, await readBoundedFile(
      join(directory, ...name.split("/")),
      isFont ? THEME_MAX_FONT_BYTES : THEME_MAX_IMAGE_BYTES,
      isFont ? "FONT_TOO_LARGE" : "IMAGE_TOO_LARGE",
    ));
  }

  try {
    files.set("preview.webp", await readBoundedFile(
      join(directory, "preview.webp"),
      THEME_MAX_PREVIEW_BYTES,
      "PREVIEW_TOO_LARGE",
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return validateThemeBundle(theme, files);
}
