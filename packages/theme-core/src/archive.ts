import { createHash } from "node:crypto";
import {
  AsyncUnzipInflate,
  strFromU8,
  strToU8,
  Unzip,
  zipSync,
} from "fflate";
import { z } from "zod";
import {
  isSafeThemePath,
  ThemeIdSchema,
  ThemeVersionSchema,
} from "@open-chatgpt-skin/theme-schema";
import { validateThemeBundle } from "./assets.js";
import { ThemeValidationError } from "./errors.js";
import type { ValidatedThemeBundle } from "./types.js";

export const OCSKIN_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const OCSKIN_MAX_EXPANDED_BYTES = 32 * 1024 * 1024;

export interface OcskinManifest {
  readonly schemaVersion: 1;
  readonly themeId: string;
  readonly themeVersion: string;
  readonly files: Readonly<Record<string, {
    readonly bytes: number;
    readonly sha256: string;
  }>>;
}

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  themeId: ThemeIdSchema,
  themeVersion: ThemeVersionSchema,
  files: z.record(z.object({
    bytes: z.number().int().min(1).max(OCSKIN_MAX_EXPANDED_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()),
}).strict();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeArchiveName(name: string): boolean {
  return Boolean(name) &&
    name === name.normalize("NFC") &&
    !name.startsWith("/") &&
    !name.includes("\\") &&
    !/^[a-z]:/i.test(name) &&
    name.split("/").every((part) => part && part !== "." && part !== "..");
}

export function createOcskinFiles(
  bundle: ValidatedThemeBundle,
): ReadonlyMap<string, Uint8Array> {
  const validated = validateThemeBundle(bundle.theme, bundle.files);
  const themeBytes = strToU8(`${JSON.stringify(validated.theme, null, 2)}\n`);
  const content = new Map<string, Uint8Array>([["theme.json", themeBytes]]);
  for (const [name, bytes] of [...validated.files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    content.set(name, bytes);
  }

  const manifest: OcskinManifest = {
    schemaVersion: 1,
    themeId: validated.theme.id,
    themeVersion: validated.theme.version,
    files: Object.fromEntries([...content].map(([name, bytes]) => [
      name,
      { bytes: bytes.length, sha256: sha256(bytes) },
    ])),
  };
  const packageFiles = new Map(content);
  packageFiles.set(
    "manifest.json",
    strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  );

  const expandedBytes = [...packageFiles.values()]
    .reduce((total, bytes) => total + bytes.length, 0);
  if (expandedBytes > OCSKIN_MAX_EXPANDED_BYTES) {
    throw new ThemeValidationError(
      "PACKAGE_EXPANDED_TOO_LARGE",
      "expanded archive exceeds 32 MB",
    );
  }
  return packageFiles;
}

export function packTheme(bundle: ValidatedThemeBundle): Uint8Array {
  const packed = zipSync(Object.fromEntries(createOcskinFiles(bundle)), { level: 9 });
  if (packed.length > OCSKIN_MAX_ARCHIVE_BYTES) {
    throw new ThemeValidationError("PACKAGE_TOO_LARGE", "archive exceeds 32 MB");
  }
  return packed;
}

function concat(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function readZipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (bytes.length > OCSKIN_MAX_ARCHIVE_BYTES) {
    throw new ThemeValidationError("PACKAGE_TOO_LARGE", "archive exceeds 32 MB");
  }

  return new Promise((resolve, reject) => {
    const entries = new Map<string, Uint8Array>();
    const seen = new Set<string>();
    const seenCaseFolded = new Set<string>();
    let pending = 0;
    let inputComplete = false;
    let expandedBytes = 0;
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const complete = (): void => {
      if (!settled && inputComplete && pending === 0) {
        settled = true;
        resolve(entries);
      }
    };

    const unzip = new Unzip((file) => {
      try {
        const name = file.name;
        if (!safeArchiveName(name)) {
          throw new ThemeValidationError(
            "ARCHIVE_ENTRY_UNSAFE",
            `unsafe archive entry: ${name}`,
          );
        }

        const caseFoldedName = name.normalize("NFC").toLowerCase();
        if (seen.has(name) || seenCaseFolded.has(caseFoldedName)) {
          throw new ThemeValidationError(
            "ARCHIVE_ENTRY_DUPLICATE",
            `duplicate archive entry: ${name}`,
          );
        }
        seen.add(name);
        seenCaseFolded.add(caseFoldedName);

        const metadataFile = name === "theme.json" ||
          name === "manifest.json" ||
          name === "preview.webp";
        if (!metadataFile && !isSafeThemePath(name)) {
          throw new ThemeValidationError(
            "ARCHIVE_ENTRY_UNSUPPORTED",
            `unsupported archive entry: ${name}`,
          );
        }

        const originalSize = file.originalSize;
        if (typeof originalSize !== "number" ||
          !Number.isSafeInteger(originalSize) ||
          originalSize < 0) {
          throw new ThemeValidationError(
            "ARCHIVE_ENTRY_SIZE_INVALID",
            `invalid archive entry size: ${name}`,
          );
        }
        expandedBytes += originalSize;
        if (expandedBytes > OCSKIN_MAX_EXPANDED_BYTES) {
          throw new ThemeValidationError(
            "PACKAGE_EXPANDED_TOO_LARGE",
            "expanded archive exceeds 32 MB",
          );
        }

        pending += 1;
        const chunks: Uint8Array[] = [];
        let received = 0;
        file.ondata = (error, chunk, final) => {
          if (error) {
            fail(error);
            return;
          }
          received += chunk.length;
          if (received > originalSize || received > OCSKIN_MAX_EXPANDED_BYTES) {
            fail(new ThemeValidationError("ARCHIVE_ENTRY_TOO_LARGE", name));
            return;
          }
          chunks.push(chunk);
          if (final) {
            entries.set(name, concat(chunks, received));
            pending -= 1;
            complete();
          }
        };
        file.start();
      } catch (error) {
        fail(error);
      }
    });

    unzip.register(AsyncUnzipInflate);
    try {
      unzip.push(bytes, true);
      inputComplete = true;
      complete();
    } catch (error) {
      fail(error);
    }
  });
}

export async function unpackTheme(bytes: Uint8Array): Promise<ValidatedThemeBundle> {
  const entries = await readZipEntries(bytes);
  const themeBytes = entries.get("theme.json");
  const manifestBytes = entries.get("manifest.json");
  if (!themeBytes || !manifestBytes) {
    throw new ThemeValidationError(
      "ARCHIVE_REQUIRED_FILE_MISSING",
      "theme.json and manifest.json are required",
    );
  }

  let manifest: OcskinManifest;
  try {
    manifest = ManifestSchema.parse(
      JSON.parse(strFromU8(manifestBytes)),
    ) as OcskinManifest;
  } catch (error) {
    throw new ThemeValidationError(
      "ARCHIVE_MANIFEST_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }

  const actualNames = [...entries.keys()]
    .filter((name) => name !== "manifest.json")
    .sort();
  const expectedNames = Object.keys(manifest.files).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new ThemeValidationError(
      "ARCHIVE_MANIFEST_MISMATCH",
      "archive entries do not match manifest",
    );
  }

  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = entries.get(name);
    if (!file || file.length !== expected.bytes || sha256(file) !== expected.sha256) {
      throw new ThemeValidationError(
        "ARCHIVE_HASH_MISMATCH",
        `archive file failed verification: ${name}`,
      );
    }
  }

  let themeValue: unknown;
  try {
    themeValue = JSON.parse(strFromU8(themeBytes));
  } catch (error) {
    throw new ThemeValidationError(
      "ARCHIVE_THEME_JSON_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  const files = new Map([...entries].filter(([name]) =>
    name.startsWith("assets/") ||
    name.startsWith("fonts/") ||
    name === "preview.webp"
  ));
  const bundle = validateThemeBundle(themeValue, files);
  if (bundle.theme.id !== manifest.themeId ||
    bundle.theme.version !== manifest.themeVersion) {
    throw new ThemeValidationError(
      "ARCHIVE_IDENTITY_MISMATCH",
      "theme identity does not match manifest",
    );
  }
  return bundle;
}
