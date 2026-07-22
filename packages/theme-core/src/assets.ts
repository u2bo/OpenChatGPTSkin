import {
  isSafeThemePath,
  parseThemeDocument,
  ThemeSchemaError,
  themeAssetPaths,
} from "@open-chatgpt-skin/theme-schema";
import { ThemeValidationError } from "./errors.js";
import type { ThemeFileTable, ValidatedThemeBundle } from "./types.js";

const MB = 1024 * 1024;
export const THEME_MAX_PACKAGE_BYTES = 32 * MB;
export const THEME_MAX_IMAGE_BYTES = 16 * MB;
export const THEME_MAX_FONT_BYTES = 5 * MB;
export const THEME_MAX_PREVIEW_BYTES = 2 * MB;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xff, 0xd8, 0xff]);
}

function isWebp(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

function isWoff2(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x77, 0x4f, 0x46, 0x32]);
}

export function validateThemeBundle(value: unknown, files: ThemeFileTable): ValidatedThemeBundle {
  let theme: ReturnType<typeof parseThemeDocument>;
  try {
    theme = parseThemeDocument(value);
  } catch (error) {
    throw new ThemeValidationError(
      error instanceof ThemeSchemaError ? error.code : "THEME_SCHEMA_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }

  const declared = new Set(themeAssetPaths(theme));
  const displayFontPath = theme.typography.displayFontAssetKey
    ? theme.assets.fonts?.[theme.typography.displayFontAssetKey]
    : undefined;
  if (theme.kind === "recipe" && files.size > 0) {
    throw new ThemeValidationError(
      "RECIPE_ASSET_FORBIDDEN",
      "local-only recipes cannot bundle media files",
    );
  }
  if (!theme.rights.localOnly && !theme.rights.attribution) {
    throw new ThemeValidationError(
      "RIGHTS_ATTRIBUTION_REQUIRED",
      "public theme requires attribution",
    );
  }

  for (const file of declared) {
    if (!files.has(file)) {
      throw new ThemeValidationError(
        file === displayFontPath ? "THEME_DISPLAY_FONT_MISSING" : "ASSET_MISSING",
        `missing declared asset: ${file}`,
      );
    }
  }

  let totalBytes = 0;
  const caseFoldedNames = new Set<string>();
  for (const [name, bytes] of files) {
    const caseFoldedName = name.normalize("NFC").toLowerCase();
    if (caseFoldedNames.has(caseFoldedName)) {
      throw new ThemeValidationError(
        "ASSET_PATH_COLLISION",
        `case-insensitive asset path collision: ${name}`,
      );
    }
    caseFoldedNames.add(caseFoldedName);

    const preview = name === "preview.webp";
    if (!preview && !isSafeThemePath(name)) {
      throw new ThemeValidationError("ASSET_UNSUPPORTED", `unsupported asset path: ${name}`);
    }
    if (!preview && !declared.has(name)) {
      throw new ThemeValidationError("ASSET_UNDECLARED", `undeclared asset: ${name}`);
    }

    totalBytes += bytes.length;
    const lower = name.toLowerCase();
    if (preview) {
      if (bytes.length > THEME_MAX_PREVIEW_BYTES) {
        throw new ThemeValidationError("PREVIEW_TOO_LARGE", name);
      }
      if (!isWebp(bytes)) {
        throw new ThemeValidationError(
          "ASSET_SIGNATURE_INVALID",
          `${name} has invalid WebP signature`,
        );
      }
    } else if (lower.endsWith(".woff2")) {
      if (bytes.length > THEME_MAX_FONT_BYTES) {
        throw new ThemeValidationError("FONT_TOO_LARGE", name);
      }
      if (!isWoff2(bytes)) {
        throw new ThemeValidationError(
          name === displayFontPath
            ? "THEME_DISPLAY_FONT_MISSING"
            : "ASSET_SIGNATURE_INVALID",
          `${name} has invalid WOFF2 signature`,
        );
      }
    } else {
      if (bytes.length > THEME_MAX_IMAGE_BYTES) {
        throw new ThemeValidationError("IMAGE_TOO_LARGE", name);
      }
      const valid = lower.endsWith(".png")
        ? isPng(bytes)
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? isJpeg(bytes)
          : lower.endsWith(".webp")
            ? isWebp(bytes)
            : false;
      if (!valid) {
        throw new ThemeValidationError(
          "ASSET_SIGNATURE_INVALID",
          `${name} has invalid image signature`,
        );
      }
    }
  }

  if (totalBytes > THEME_MAX_PACKAGE_BYTES) {
    throw new ThemeValidationError("PACKAGE_TOO_LARGE", "theme exceeds 32 MB");
  }

  return {
    theme,
    files: new Map(files),
    totalBytes,
  };
}
