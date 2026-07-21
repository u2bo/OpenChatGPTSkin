import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  loadThemeCatalog,
  loadThemeDirectory,
  ThemeValidationError,
  ThemeStore,
  unpackTheme,
  type ValidatedThemeBundle,
} from "@open-chatgpt-skin/theme-core";
import {
  ThemeIdSchema,
  ThemeVersionSchema,
} from "@open-chatgpt-skin/theme-schema";
import {
  compileTheme,
  RuntimeThemeError,
  type CompiledTheme,
} from "@open-chatgpt-skin/cdp-adapter";
import { RuntimeError } from "../errors.js";
import {
  RUNTIME_BUILTIN_THEME_IDS,
  RuntimeBuiltinThemeIdSchema,
  type RuntimeBuiltinThemeId,
} from "./ids.js";

export interface RuntimeThemeDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly ready: true;
}

export type RuntimeThemeLookup = string | {
  readonly id: string;
  readonly version?: string;
};

export interface LoadedRuntimeTheme {
  readonly descriptor: RuntimeThemeDescriptor;
  readonly bundle: ValidatedThemeBundle;
  readonly compiled: CompiledTheme;
}

export class RuntimeThemeRepository {
  private readonly userStore: ThemeStore | null;

  constructor(
    private readonly themesRoot: string,
    userThemeStoreRoot?: string,
  ) {
    this.userStore = userThemeStoreRoot ? new ThemeStore(userThemeStoreRoot) : null;
  }

  async list(): Promise<readonly RuntimeThemeDescriptor[]> {
    const catalog = await loadThemeCatalog(this.themesRoot);
    return RUNTIME_BUILTIN_THEME_IDS.map((id) => {
      const entry = catalog.builtins.find((candidate) => candidate.id === id);
      if (!entry || entry.kind !== "theme" || !entry.ready || entry.localOnly) {
        throw new RuntimeError("THEME_NOT_READY", `Runtime theme is not ready: ${id}`);
      }
      return { id, name: entry.name, version: entry.version, ready: true };
    });
  }

  async importFile(themeFile: string): Promise<RuntimeThemeDescriptor> {
    if (!this.userStore) {
      throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Personal theme store is unavailable");
    }
    if (extname(themeFile).toLowerCase() !== ".ocskin") {
      throw new RuntimeError("THEME_NOT_READY", "Runtime imports only .ocskin theme files");
    }

    try {
      const bundle = await unpackTheme(await readFile(themeFile));
      if (bundle.theme.kind !== "theme") {
        throw new RuntimeError("THEME_NOT_READY", "Imported archive is not a complete theme");
      }
      const descriptor = {
        id: bundle.theme.id,
        name: bundle.theme.name,
        version: bundle.theme.version,
        ready: true as const,
      };
      this.compile(descriptor, bundle);
      await this.userStore.install(bundle);
      return descriptor;
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if (error instanceof ThemeValidationError) {
        throw new RuntimeError("THEME_NOT_READY", error.message);
      }
      throw error;
    }
  }

  async load(value: RuntimeThemeLookup): Promise<LoadedRuntimeTheme> {
    const stringLookup = typeof value === "string";
    const lookup = stringLookup
      ? { id: value, version: undefined }
      : {
          id: ThemeIdSchema.parse(value.id),
          version: value.version === undefined
            ? undefined
            : ThemeVersionSchema.parse(value.version),
        };
    const catalog = await loadThemeCatalog(this.themesRoot);
    const entry = [...catalog.builtins, ...catalog.recipes]
      .find((candidate) => candidate.id === lookup.id);

    if (!entry) {
      if (stringLookup) {
        throw new RuntimeError("THEME_NOT_FOUND", `Unknown Runtime theme: ${lookup.id}`);
      }
      return this.loadPersonalTheme(lookup.id, lookup.version);
    }

    const id = RuntimeBuiltinThemeIdSchema.safeParse(lookup.id);
    if (!id.success || entry.kind !== "theme" || !entry.ready || entry.localOnly) {
      throw new RuntimeError("THEME_NOT_READY", `Theme is not Runtime-ready: ${lookup.id}`);
    }
    if (lookup.version !== undefined && lookup.version !== entry.version) {
      throw new RuntimeError(
        "THEME_NOT_READY",
        `Built-in theme version is unavailable: ${lookup.id}@${lookup.version}`,
      );
    }

    const bundle = await loadThemeDirectory(join(this.themesRoot, ...entry.path.split("/")));
    if (bundle.theme.id !== entry.id || bundle.theme.version !== entry.version) {
      throw new RuntimeError("THEME_NOT_READY", `Theme metadata does not match catalog: ${lookup.id}`);
    }

    return this.compile({
      id: id.data,
      name: entry.name,
      version: entry.version,
      ready: true,
    }, bundle);
  }

  private async loadPersonalTheme(
    id: string,
    version: string | undefined,
  ): Promise<LoadedRuntimeTheme> {
    if (!version) {
      throw new RuntimeError(
        "THEME_NOT_READY",
        `Personal themes require an exact version: ${id}`,
      );
    }
    if (!this.userStore) {
      throw new RuntimeError("THEME_NOT_FOUND", `Unknown Runtime theme: ${id}`);
    }

    let bundle: ValidatedThemeBundle;
    try {
      bundle = await this.userStore.readTheme({ id, version });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new RuntimeError("THEME_NOT_FOUND", `Unknown Runtime theme: ${id}@${version}`);
      }
      throw error;
    }
    if (bundle.theme.kind !== "theme" || bundle.theme.id !== id ||
      bundle.theme.version !== version) {
      throw new RuntimeError("THEME_NOT_READY", `Personal theme is not Runtime-ready: ${id}@${version}`);
    }
    return this.compile({
      id,
      name: bundle.theme.name,
      version,
      ready: true,
    }, bundle);
  }

  private compile(
    descriptor: RuntimeThemeDescriptor,
    bundle: ValidatedThemeBundle,
  ): LoadedRuntimeTheme {
    try {
      return { descriptor, bundle, compiled: compileTheme(bundle) };
    } catch (error) {
      if (error instanceof RuntimeThemeError && error.code === "THEME_RUNTIME_TOO_LARGE") {
        throw new RuntimeError("THEME_RUNTIME_TOO_LARGE", error.message);
      }
      throw error;
    }
  }
}
