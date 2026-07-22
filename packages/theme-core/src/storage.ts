import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  parseThemeDocument,
  themeAssetPaths,
  ThemeIdSchema,
  ThemeVersionSchema,
} from "@open-chatgpt-skin/theme-schema";
import { validateThemeBundle } from "./assets.js";
import { ThemeValidationError } from "./errors.js";
import type { ValidatedThemeBundle } from "./types.js";

const ThemeRefSchema = z.object({
  id: ThemeIdSchema,
  version: ThemeVersionSchema,
}).strict();

const ThemeStateSchema = z.object({
  schemaVersion: z.literal(1),
  active: ThemeRefSchema.nullable(),
  previous: ThemeRefSchema.nullable(),
  updatedAt: z.string().datetime(),
}).strict();

export type ThemeRef = z.infer<typeof ThemeRefSchema>;
export type ThemeState = z.infer<typeof ThemeStateSchema>;

function parseThemeRef(value: unknown): ThemeRef {
  const result = ThemeRefSchema.safeParse(value);
  if (!result.success) {
    throw new ThemeValidationError("THEME_REF_INVALID", result.error.message);
  }
  return result.data;
}

function bundlesEqual(left: ValidatedThemeBundle, right: ValidatedThemeBundle): boolean {
  if (!isDeepStrictEqual(left.theme, right.theme) || left.files.size !== right.files.size) {
    return false;
  }
  for (const [name, bytes] of left.files) {
    const other = right.files.get(name);
    if (!other || bytes.length !== other.length) return false;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== other[index]) return false;
    }
  }
  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class ThemeStore {
  constructor(private readonly root: string) {}

  private themeDir(value: ThemeRef): string {
    const ref = parseThemeRef(value);
    return join(this.root, "themes", ref.id, ref.version);
  }

  private statePath(): string {
    return join(this.root, "state.json");
  }

  async install(bundle: ValidatedThemeBundle): Promise<ThemeRef> {
    const validated = validateThemeBundle(bundle.theme, bundle.files);
    const ref = parseThemeRef({
      id: validated.theme.id,
      version: validated.theme.version,
    });
    const target = this.themeDir(ref);
    if (await pathExists(target)) {
      const existing = await this.readTheme(ref);
      if (!bundlesEqual(existing, validated)) {
        throw new ThemeValidationError(
          "THEME_VERSION_CONFLICT",
          `${ref.id}@${ref.version} already exists with different content`,
        );
      }
      return ref;
    }

    const staging = `${target}.staging-${process.pid}-${randomUUID()}`;
    await mkdir(staging, { recursive: true });
    await atomicJson(join(staging, "theme.json"), validated.theme);
    for (const [name, bytes] of validated.files) {
      const file = join(staging, ...name.split("/"));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    await mkdir(dirname(target), { recursive: true });
    await rename(staging, target);
    return ref;
  }

  async list(): Promise<readonly ThemeRef[]> {
    const themesDirectory = join(this.root, "themes");
    let themeEntries;
    try {
      themeEntries = await readdir(themesDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const refs: ThemeRef[] = [];
    for (const themeEntry of themeEntries) {
      if (!themeEntry.isDirectory()) continue;
      const id = ThemeIdSchema.safeParse(themeEntry.name);
      if (!id.success) continue;
      const versions = await readdir(join(themesDirectory, themeEntry.name), {
        withFileTypes: true,
      });
      for (const versionEntry of versions) {
        if (!versionEntry.isDirectory()) continue;
        const version = ThemeVersionSchema.safeParse(versionEntry.name);
        if (!version.success) continue;
        const ref = { id: id.data, version: version.data };
        await this.readTheme(ref);
        refs.push(ref);
      }
    }
    return refs.sort((left, right) => left.id.localeCompare(right.id) ||
      left.version.localeCompare(right.version, undefined, { numeric: true }));
  }

  async remove(value: ThemeRef): Promise<void> {
    const ref = parseThemeRef(value);
    const state = await this.readState();
    if (isDeepStrictEqual(state.active, ref) || isDeepStrictEqual(state.previous, ref)) {
      throw new ThemeValidationError(
        "THEME_IN_USE",
        `${ref.id}@${ref.version} is referenced by theme state`,
      );
    }
    const target = this.themeDir(ref);
    await rm(target, { recursive: true });
    try {
      await rmdir(dirname(target));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }

  async readState(): Promise<ThemeState> {
    let text: string;
    try {
      text = await readFile(this.statePath(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        schemaVersion: 1,
        active: null,
        previous: null,
        updatedAt: new Date(0).toISOString(),
      };
    }

    try {
      return ThemeStateSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new ThemeValidationError(
        "THEME_STATE_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async activate(value: ThemeRef): Promise<void> {
    const ref = parseThemeRef(value);
    await this.readTheme(ref);
    const state = await this.readState();
    if (state.active && isDeepStrictEqual(state.active, ref)) return;

    await atomicJson(this.statePath(), {
      schemaVersion: 1,
      active: ref,
      previous: state.active,
      updatedAt: new Date().toISOString(),
    } satisfies ThemeState);
  }

  async rollback(): Promise<void> {
    const state = await this.readState();
    if (!state.previous) {
      throw new ThemeValidationError("ROLLBACK_UNAVAILABLE", "no previous theme exists");
    }
    await this.readTheme(state.previous);
    await atomicJson(this.statePath(), {
      schemaVersion: 1,
      active: state.previous,
      previous: state.active,
      updatedAt: new Date().toISOString(),
    } satisfies ThemeState);
  }

  async readTheme(value: ThemeRef): Promise<ValidatedThemeBundle> {
    const ref = parseThemeRef(value);
    const base = this.themeDir(ref);
    const themeText = await readFile(join(base, "theme.json"), "utf8");
    let theme: ReturnType<typeof parseThemeDocument>;
    try {
      theme = parseThemeDocument(JSON.parse(themeText));
    } catch (error) {
      throw new ThemeValidationError(
        "STORED_THEME_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (theme.id !== ref.id || theme.version !== ref.version) {
      throw new ThemeValidationError(
        "STORED_THEME_IDENTITY_MISMATCH",
        `stored theme identity ${theme.id}@${theme.version} does not match ${ref.id}@${ref.version}`,
      );
    }

    const files = new Map<string, Uint8Array>();
    for (const name of themeAssetPaths(theme)) {
      files.set(name, await readFile(join(base, ...name.split("/"))));
    }
    try {
      files.set("preview.webp", await readFile(join(base, "preview.webp")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return validateThemeBundle(theme, files);
  }
}
