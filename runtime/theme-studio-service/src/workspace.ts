import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  loadThemeCatalog,
  loadThemeDirectory,
  packTheme,
  ThemeValidationError,
  ThemeStore,
  unpackTheme,
  validateThemeBundle,
  type ThemeRef,
  type ValidatedThemeBundle,
} from "@open-chatgpt-skin/theme-core";
import {
  isSafeThemePath,
  parseThemeDraftDocument,
  parseThemeDocument,
  THEME_MAX_COMPOSITION_LAYERS,
  THEME_SCHEMA_VERSION,
  themeAssetPaths,
  ThemeDraftDocumentSchema,
  type SuggestionIconSlot,
  type ThemeDraftDocument,
} from "@open-chatgpt-skin/theme-schema";
import {
  StudioApplyResultSchema,
  StudioCreateDraftInputSchema,
  StudioDraftSchema,
  StudioError,
  StudioExportedThemeSchema,
  StudioSaveResultSchema,
  StudioThemeLibrarySchema,
  personalThemeGroupKey,
  validateStudioDraft,
  type StudioApplyResult,
  type StudioCreateDraftInput,
  type StudioDeleteThemeInput,
  type StudioDraft,
  type StudioDraftCommandInput,
  type StudioExportedTheme,
  type StudioImportThemeInput,
  type StudioRuntimeStatus,
  type StudioSaveResult,
  type StudioThemeLibrary,
  type StudioThemeRef,
  type StudioUpdateDraftInput,
  type StudioUploadAssetInput,
} from "@open-chatgpt-skin/theme-studio-core";
import {
  compileTheme,
  RuntimeThemeError,
} from "@open-chatgpt-skin/cdp-adapter";
import type { RuntimePaths } from "@open-chatgpt-skin/windows-runtime";
import sharp from "sharp";
import { z } from "zod";

const HISTORY_LIMIT = 50;
const SOURCE_IMAGE_LIMIT_BYTES = 50 * 1024 * 1024;
const PROCESSED_IMAGE_LIMIT_BYTES = 16 * 1024 * 1024;
const SOURCE_FONT_LIMIT_BYTES = 5 * 1024 * 1024;
const THEME_ARCHIVE_MIME = "application/vnd.open-chatgpt-skin+zip" as const;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function studioThemeError(
  code: "STUDIO_IMPORT_INVALID" | "STUDIO_EXPORT_INVALID" | "STUDIO_SAVE_FAILED",
  error: unknown,
  fallback: string,
): StudioError {
  return new StudioError(
    code,
    error instanceof ThemeValidationError
      ? `${error.message} (${error.code})`
      : error instanceof Error
        ? error.message
        : fallback,
  );
}

const DraftRecordSchema = z.object({
  schemaVersion: z.literal(1),
  draftId: z.string().uuid(),
  theme: ThemeDraftDocumentSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  savedRef: z.object({
    id: z.string(),
    version: z.string(),
  }).strict().nullable(),
  dirty: z.boolean(),
  past: z.array(ThemeDraftDocumentSchema).max(HISTORY_LIMIT),
  future: z.array(ThemeDraftDocumentSchema).max(HISTORY_LIMIT),
}).strict();

type DraftRecord = z.infer<typeof DraftRecordSchema>;

const PersistedDraftRecordSchema = DraftRecordSchema.omit({
  theme: true,
  past: true,
  future: true,
}).extend({
  theme: z.unknown(),
  past: z.array(z.unknown()).max(HISTORY_LIMIT),
  future: z.array(z.unknown()).max(HISTORY_LIMIT),
}).strict();

export interface ThemeStudioWorkspaceDependencies {
  readonly paths: RuntimePaths;
  readonly runtimeStatus: () => Promise<StudioRuntimeStatus>;
  readonly applyRuntimeTheme: (ref: StudioThemeRef) => Promise<StudioRuntimeStatus>;
  readonly restoreRuntimeTheme: () => Promise<StudioRuntimeStatus>;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export interface StudioBinaryAsset {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

function suggestionIconSlot(
  slot: StudioUploadAssetInput["slot"],
): SuggestionIconSlot | undefined {
  if (slot === "suggestion-card1") return "card1";
  if (slot === "suggestion-card2") return "card2";
  if (slot === "suggestion-card3") return "card3";
  if (slot === "suggestion-card4") return "card4";
  return undefined;
}

function parseDraftRecord(value: unknown): DraftRecord {
  const persisted = PersistedDraftRecordSchema.parse(value);
  return DraftRecordSchema.parse({
    ...persisted,
    theme: parseThemeDraftDocument(persisted.theme),
    past: persisted.past.map(parseThemeDraftDocument),
    future: persisted.future.map(parseThemeDraftDocument),
  });
}

function recordAssetPaths(record: DraftRecord): ReadonlySet<string> {
  return new Set([
    record.theme,
    ...record.past,
    ...record.future,
  ].flatMap((theme) => themeAssetPaths(theme)));
}

function sourceExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".woff2")) return "font/woff2";
  throw new StudioError("STUDIO_ASSET_INVALID", "Unsupported draft asset type");
}

function nextPatchVersion(refs: readonly ThemeRef[], id: string): string {
  const versions = refs
    .filter((ref) => ref.id === id)
    .map((ref) => ref.version.split(".").map(Number) as [number, number, number])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
  const latest = versions.at(-1);
  return latest ? `${latest[0]}.${latest[1]}.${latest[2] + 1}` : "1.0.0";
}

function cloneTheme(theme: ThemeDraftDocument): ThemeDraftDocument {
  return structuredClone(theme);
}

function bytesEqual(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function withHistory(record: DraftRecord, theme: ThemeDraftDocument, now: string): DraftRecord {
  return DraftRecordSchema.parse({
    ...record,
    theme,
    revision: record.revision + 1,
    updatedAt: now,
    dirty: true,
    past: [...record.past, record.theme].slice(-HISTORY_LIMIT),
    future: [],
  });
}

export class ThemeStudioWorkspace {
  private readonly store: ThemeStore;
  private readonly now: () => string;
  private readonly newId: () => string;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly themeQueues = new Map<string, Promise<void>>();
  private reservedThemeIds = new Set<string>();
  private builtinThemeIds: readonly string[] = [];

  constructor(private readonly dependencies: ThemeStudioWorkspaceDependencies) {
    this.store = new ThemeStore(dependencies.paths.themeStoreDirectory);
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.newId = dependencies.newId ?? randomUUID;
  }

  async initialize(): Promise<void> {
    const [, , catalog] = await Promise.all([
      mkdir(this.dependencies.paths.themeStoreDirectory, { recursive: true }),
      mkdir(this.dependencies.paths.themeStudioDraftDirectory, { recursive: true }),
      loadThemeCatalog(this.dependencies.paths.themesRoot),
    ]);
    this.reservedThemeIds = new Set([
      ...catalog.builtins.map((entry) => entry.id),
      ...catalog.recipes.map((entry) => entry.id),
    ]);
    this.builtinThemeIds = catalog.builtins.map((entry) => entry.id);
    await this.removeDuplicateDrafts();
  }

  async listThemes(): Promise<StudioThemeLibrary> {
    const catalog = await loadThemeCatalog(this.dependencies.paths.themesRoot);
    const builtins = await Promise.all(catalog.builtins.map(async (entry) => {
      const bundle = await loadThemeDirectory(join(this.dependencies.paths.themesRoot, entry.path));
      return this.libraryItem(
        bundle.theme,
        "builtin",
        true,
        false,
        this.previewUrl("builtin", entry.id, entry.version),
      );
    }));
    const recipes = await Promise.all(catalog.recipes.map(async (entry) => {
      const theme = parseThemeDocument(JSON.parse(await readFile(join(
        this.dependencies.paths.themesRoot,
        entry.path,
        "recipe.json",
      ), "utf8")));
      return this.libraryItem(theme, "recipe", false, true, null);
    }));
    const personal = await Promise.all((await this.store.list()).map(async (ref) => {
      const bundle = await this.store.readTheme(ref);
      return this.libraryItem(
        bundle.theme,
        "personal",
        true,
        bundle.theme.rights.localOnly,
        bundle.files.has("preview.webp")
          ? this.previewUrl("personal", ref.id, ref.version)
          : null,
      );
    }));
    return StudioThemeLibrarySchema.parse({ themes: [...builtins, ...personal, ...recipes] });
  }

  async applySavedTheme(ref: StudioThemeRef): Promise<StudioRuntimeStatus> {
    const library = await this.listThemes();
    const theme = library.themes.find((entry) =>
      entry.ready && entry.ref.id === ref.id && entry.ref.version === ref.version
    );
    if (!theme) {
      throw new StudioError(
        "STUDIO_APPLY_FAILED",
        `Theme is not ready to apply: ${ref.id}@${ref.version}`,
      );
    }
    return this.dependencies.applyRuntimeTheme(ref);
  }

  async deletePersonalTheme(input: StudioDeleteThemeInput): Promise<StudioThemeLibrary> {
    return this.serializeTheme(
      personalThemeGroupKey(input.id, this.builtinThemeIds),
      async () => {
        const catalog = await loadThemeCatalog(this.dependencies.paths.themesRoot);
        const builtinIds = catalog.builtins.map((entry) => entry.id);
        const targetGroup = personalThemeGroupKey(input.id, builtinIds);
        const refs = (await this.store.list()).filter((ref) => input.version === undefined
          ? personalThemeGroupKey(ref.id, builtinIds) === targetGroup
          : ref.id === input.id && ref.version === input.version
        );
        if (refs.length === 0) {
          throw new StudioError(
            "STUDIO_DELETE_FAILED",
            input.version
              ? `个人主题版本不存在：${input.id}@${input.version}`
              : `个人主题不存在：${input.id}`,
          );
        }
        const runtime = await this.dependencies.runtimeStatus();
        const inUse = refs.some((ref) =>
          (runtime.selectedTheme?.id === ref.id && runtime.selectedTheme.version === ref.version) ||
          (runtime.appliedTheme?.id === ref.id && runtime.appliedTheme.version === ref.version)
        );
        if (inUse) {
          throw new StudioError(
            "STUDIO_DELETE_FAILED",
            "正在使用的个人主题不能删除，请先恢复原始皮肤或应用其他主题。",
          );
        }
        for (const ref of refs) await this.store.remove(ref);
        if (input.version === undefined) {
          await this.removeDraftGroup(targetGroup, builtinIds);
        } else {
          await this.invalidateDeletedThemeRefs(refs);
        }
        return this.listThemes();
      },
    );
  }

  async createDraft(input: StudioCreateDraftInput): Promise<StudioDraft> {
    const bundle = await this.loadSource(input);
    const theme = this.buildDraftTheme(input, bundle);
    const group = personalThemeGroupKey(theme.id, this.builtinThemeIds);
    return this.serializeTheme(group, () => this.createDraftRecord(input, bundle, theme));
  }

  private buildDraftTheme(
    input: StudioCreateDraftInput,
    bundle: ValidatedThemeBundle,
  ): ThemeDraftDocument {
    const defaultId = (input.source.source === "personal"
      ? input.source.ref.id
      : `${input.source.ref.id}-custom`).slice(0, 80)
      .replace(/-+$/g, "");
    const sourceSavedRef = input.source.source === "personal" ? input.source.ref : null;
    return ThemeDraftDocumentSchema.parse({
      ...bundle.theme,
      schemaVersion: THEME_SCHEMA_VERSION,
      kind: "theme",
      id: input.themeId ?? defaultId,
      name: input.name ?? `${bundle.theme.name} 自定义`,
      version: sourceSavedRef?.version ?? "0.0.0",
      assets: bundle.theme.kind === "recipe" ? {} : bundle.theme.assets,
      rights: {
        ...bundle.theme.rights,
        localOnly: bundle.theme.kind === "recipe" || bundle.theme.rights.localOnly,
      },
    });
  }

  private async createDraftRecord(
    input: StudioCreateDraftInput,
    bundle: ValidatedThemeBundle,
    theme: ThemeDraftDocument,
  ): Promise<StudioDraft> {
    const sourceSavedRef = input.source.source === "personal" ? input.source.ref : null;
    const group = personalThemeGroupKey(theme.id, this.builtinThemeIds);
    const existing = (await this.listDraftRecords())
      .filter((record) => personalThemeGroupKey(
        record.theme.id,
        this.builtinThemeIds,
      ) === group)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) ||
        right.draftId.localeCompare(left.draftId))[0];
    if (existing && input.conflictResolution === undefined) {
      throw new StudioError(
        "STUDIO_DRAFT_CONFLICT",
        `主题“${theme.name}”已有草稿`,
        "请选择加载已有草稿或覆盖现有草稿。",
      );
    }
    if (existing && input.conflictResolution === "load-existing") {
      return this.view(existing);
    }

    const draftId = existing?.draftId ?? this.newId();
    const record = DraftRecordSchema.parse({
      schemaVersion: 1,
      draftId,
      theme,
      revision: existing ? existing.revision + 1 : 0,
      updatedAt: this.now(),
      savedRef: sourceSavedRef,
      dirty: sourceSavedRef === null,
      past: [],
      future: [],
    });
    await this.writeBundleFiles(draftId, bundle.files);
    await this.writeRecord(record);
    return this.view(record);
  }

  async openDraft(draftId: string): Promise<StudioDraft> {
    return this.view(await this.readRecord(draftId));
  }

  async openLatestDraft(): Promise<StudioDraft | null> {
    const records = await this.listDraftRecords();
    const latest = [...records].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.draftId.localeCompare(left.draftId)
    )[0];
    return latest ? this.view(latest) : null;
  }

  async updateDraft(input: StudioUpdateDraftInput): Promise<StudioDraft> {
    return this.mutate(input.draftId, async (record) => {
      this.assertRevision(record, input.expectedRevision);
      this.assertPersonalThemeId(input.theme.id);
      if (record.theme.id !== input.theme.id) {
        const conflict = (await this.store.list()).some((ref) => ref.id === input.theme.id);
        if (conflict) {
          throw new StudioError(
            "STUDIO_DRAFT_INVALID",
            "Theme ID already belongs to an installed personal theme",
          );
        }
      }
      return withHistory(record, ThemeDraftDocumentSchema.parse(input.theme), this.now());
    });
  }

  async undo(input: StudioDraftCommandInput): Promise<StudioDraft> {
    return this.mutate(input.draftId, async (record) => {
      this.assertRevision(record, input.expectedRevision);
      const previous = record.past.at(-1);
      if (!previous) return record;
      return DraftRecordSchema.parse({
        ...record,
        theme: previous,
        revision: record.revision + 1,
        updatedAt: this.now(),
        dirty: true,
        past: record.past.slice(0, -1),
        future: [record.theme, ...record.future].slice(0, HISTORY_LIMIT),
      });
    });
  }

  async redo(input: StudioDraftCommandInput): Promise<StudioDraft> {
    return this.mutate(input.draftId, async (record) => {
      this.assertRevision(record, input.expectedRevision);
      const next = record.future[0];
      if (!next) return record;
      return DraftRecordSchema.parse({
        ...record,
        theme: next,
        revision: record.revision + 1,
        updatedAt: this.now(),
        dirty: true,
        past: [...record.past, record.theme].slice(-HISTORY_LIMIT),
        future: record.future.slice(1),
      });
    });
  }

  async uploadAsset(input: StudioUploadAssetInput): Promise<StudioDraft> {
    return this.mutate(input.draftId, async (record) => {
      this.assertRevision(record, input.expectedRevision);
      const theme = cloneTheme(record.theme);
      if (input.slot === "composition-layer") {
        const key = this.requiredAssetKey(input);
        const existing = theme.composition.layers.some((layer) => layer.id === key);
        if (!existing &&
          theme.composition.layers.length >= THEME_MAX_COMPOSITION_LAYERS) {
          throw new StudioError(
            "STUDIO_ASSET_INVALID",
            `A theme can contain at most ${THEME_MAX_COMPOSITION_LAYERS} composition layers`,
          );
        }
      }
      const { path, bytes } = await this.normalizeAsset(input);
      await this.writeAsset(record.draftId, path, bytes);

      if (input.slot === "background") theme.assets.background = path;
      if (input.slot === "portrait") theme.assets.portrait = path;
      if (input.slot === "profile-avatar") theme.assets.profileAvatar = path;
      const suggestionSlot = suggestionIconSlot(input.slot);
      if (suggestionSlot) {
        theme.assets.suggestionIcons = {
          ...theme.assets.suggestionIcons,
          [suggestionSlot]: path,
        };
      }
      if (input.slot === "decoration") {
        const key = this.requiredAssetKey(input);
        theme.assets.decorations = { ...theme.assets.decorations, [key]: path };
        const existing = theme.decorations.findIndex((item) => item.assetKey === key);
        const decoration = {
          type: "image" as const,
          enabled: true,
          intensity: 0.6,
          assetKey: key,
          placement: "corners" as const,
          opacity: 0.75,
          scale: 1,
        };
        if (existing < 0) theme.decorations = [...theme.decorations, decoration].slice(0, 16);
        else theme.decorations[existing] = decoration;
      }
      if (input.slot === "composition-layer") {
        const key = this.requiredAssetKey(input);
        theme.assets.decorations = { ...theme.assets.decorations, [key]: path };
        const nextLayer = {
          id: key,
          asset: { kind: "decoration" as const, assetKey: key },
          surface: "home-hero" as const,
          anchor: "top-left" as const,
          positionX: 0.1,
          positionY: 0.1,
          width: 0.2,
          opacity: 1,
          rotation: 0,
          required: false,
        };
        const layerIndex = theme.composition.layers.findIndex((layer) => layer.id === key);
        if (layerIndex < 0) {
          theme.composition.layers = [...theme.composition.layers, nextLayer];
        } else {
          theme.composition.layers[layerIndex] = nextLayer;
        }
      }
      if (input.slot === "ui-font" || input.slot === "code-font" ||
        input.slot === "display-font") {
        const key = this.requiredAssetKey(input);
        theme.assets.fonts = { ...theme.assets.fonts, [key]: path };
        if (input.slot === "ui-font") {
          theme.typography.uiFontAssetKey = key;
          theme.typography.uiFamily = `ocs-${key}`;
        } else if (input.slot === "code-font") {
          theme.typography.codeFontAssetKey = key;
          theme.typography.codeFamily = `ocs-${key}`;
        } else {
          theme.typography.displayFontAssetKey = key;
          theme.typography.displayFamily = `ocs-${key}`;
        }
      }
      return withHistory(record, ThemeDraftDocumentSchema.parse(theme), this.now());
    });
  }

  async validateDraft(draftId: string): Promise<StudioDraft> {
    return this.view(await this.readRecord(draftId));
  }

  async saveVersion(input: StudioDraftCommandInput): Promise<StudioSaveResult> {
    const initial = await this.readRecord(input.draftId);
    this.assertRevision(initial, input.expectedRevision);
    return this.serializeTheme(initial.theme.id, async () => {
      let savedRef: StudioThemeRef | null = null;
      const draft = await this.mutate(input.draftId, async (record) => {
        this.assertRevision(record, input.expectedRevision);
        const saved = await this.saveRecord(record);
        savedRef = saved.savedRef;
        return saved;
      });
      if (!savedRef) throw new StudioError("STUDIO_SAVE_FAILED", "Theme version was not saved");
      return StudioSaveResultSchema.parse({ draft, ref: savedRef });
    });
  }

  async importTheme(input: StudioImportThemeInput): Promise<StudioDraft> {
    let bundle: ValidatedThemeBundle;
    try {
      bundle = await unpackTheme(input.bytes);
    } catch (error) {
      throw studioThemeError("STUDIO_IMPORT_INVALID", error, "Theme archive is invalid");
    }
    this.assertPersonalThemeId(bundle.theme.id);
    this.assertRuntimeReady(bundle);
    return this.serializeTheme(
      personalThemeGroupKey(bundle.theme.id, this.builtinThemeIds),
      async () => {
        let ref: ThemeRef;
        try {
          ref = await this.store.install(bundle);
        } catch (error) {
          throw studioThemeError("STUDIO_IMPORT_INVALID", error, "Theme import failed");
        }
        const draftInput = StudioCreateDraftInputSchema.parse({
          source: { source: "personal", ref },
          themeId: ref.id,
          name: bundle.theme.name,
          conflictResolution: "overwrite-existing",
        });
        return this.createDraftRecord(
          draftInput,
          bundle,
          this.buildDraftTheme(draftInput, bundle),
        );
      },
    );
  }

  async exportTheme(ref: StudioThemeRef): Promise<StudioExportedTheme> {
    try {
      const installed = (await this.store.list()).some((candidate) =>
        candidate.id === ref.id && candidate.version === ref.version
      );
      if (!installed) {
        throw new StudioError(
          "STUDIO_EXPORT_INVALID",
          "只有个人主题可以导出",
          "请先保存为个人主题版本，或选择已导入的个人主题。",
        );
      }
      const bytes = packTheme(await this.store.readTheme(ref));
      return StudioExportedThemeSchema.parse({
        fileName: `${ref.id}-${ref.version}.ocskin`,
        mimeType: THEME_ARCHIVE_MIME,
        bytes,
      });
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw studioThemeError("STUDIO_EXPORT_INVALID", error, "Theme export failed");
    }
  }

  async applyTheme(input: StudioDraftCommandInput): Promise<StudioApplyResult> {
    const record = await this.readRecord(input.draftId);
    this.assertRevision(record, input.expectedRevision);
    if (record.dirty || !record.savedRef) {
      throw new StudioError(
        "STUDIO_APPLY_FAILED",
        "主题存在未保存修改",
        "请先点击“保存版本”，再应用到 Codex。",
      );
    }
    const draft = this.view(record);
    const ref = record.savedRef;
    try {
      const runtime = await this.dependencies.applyRuntimeTheme(ref);
      return StudioApplyResultSchema.parse({ draft, ref, runtime });
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw new StudioError(
        "STUDIO_APPLY_FAILED",
        "Theme could not be applied to Codex",
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  getRuntimeStatus(): Promise<StudioRuntimeStatus> {
    return this.dependencies.runtimeStatus();
  }

  restoreRuntime(): Promise<StudioRuntimeStatus> {
    return this.dependencies.restoreRuntimeTheme();
  }

  async readDraftAsset(draftId: string, path: string): Promise<StudioBinaryAsset> {
    const record = await this.readRecord(draftId);
    if (!themeAssetPaths(record.theme).includes(path) || !isSafeThemePath(path)) {
      throw new StudioError("STUDIO_ASSET_INVALID", "Draft asset is not declared");
    }
    return {
      bytes: await readFile(this.assetPath(draftId, path)),
      mimeType: mimeForPath(path),
    };
  }

  async readThemePreview(
    source: "builtin" | "personal",
    ref: StudioThemeRef,
  ): Promise<StudioBinaryAsset> {
    if (source === "personal") {
      const preview = (await this.store.readTheme(ref)).files.get("preview.webp");
      if (!preview) throw new StudioError("STUDIO_ASSET_INVALID", "Theme preview is unavailable");
      return { bytes: preview, mimeType: "image/webp" };
    }
    const catalog = await loadThemeCatalog(this.dependencies.paths.themesRoot);
    const entry = catalog.builtins.find((candidate) =>
      candidate.id === ref.id && candidate.version === ref.version
    );
    if (!entry?.preview) {
      throw new StudioError("STUDIO_ASSET_INVALID", "Theme preview is unavailable");
    }
    return {
      bytes: await readFile(join(
        this.dependencies.paths.themesRoot,
        ...entry.preview.split("/"),
      )),
      mimeType: "image/webp",
    };
  }

  private async loadSource(input: StudioCreateDraftInput): Promise<ValidatedThemeBundle> {
    if (input.source.source === "personal") {
      return this.store.readTheme(input.source.ref);
    }
    const catalog = await loadThemeCatalog(this.dependencies.paths.themesRoot);
    const collection = input.source.source === "builtin" ? catalog.builtins : catalog.recipes;
    const entry = collection.find((candidate) =>
      candidate.id === input.source.ref.id && candidate.version === input.source.ref.version
    );
    if (!entry) throw new StudioError("STUDIO_REQUEST_INVALID", "Theme source is unavailable");
    const directory = join(this.dependencies.paths.themesRoot, ...entry.path.split("/"));
    if (entry.kind === "theme") return loadThemeDirectory(directory);
    const recipe = parseThemeDocument(JSON.parse(await readFile(join(directory, "recipe.json"), "utf8")));
    return validateThemeBundle(recipe, new Map());
  }

  private async saveRecord(record: DraftRecord): Promise<DraftRecord> {
    if (!record.dirty && record.savedRef) return record;
    this.assertPersonalThemeId(record.theme.id);
    const issues = validateStudioDraft(record.theme);
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length > 0) {
      throw new StudioError(
        "STUDIO_DRAFT_INVALID",
        errors.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      );
    }
    const refs = await this.store.list();
    const files = await this.readDraftFiles(record.draftId, record.theme);
    for (const ref of refs.filter((candidate) => candidate.id === record.theme.id).reverse()) {
      const theme = parseThemeDocument({ ...record.theme, version: ref.version });
      const existing = await this.store.readTheme(ref);
      if (isDeepStrictEqual(existing.theme, theme) && themeAssetPaths(theme).every((path) =>
        bytesEqual(files.get(path), existing.files.get(path)))) {
        return DraftRecordSchema.parse({
          ...record,
          theme,
          revision: record.revision + 1,
          updatedAt: this.now(),
          savedRef: ref,
          dirty: false,
        });
      }
    }

    const version = nextPatchVersion(refs, record.theme.id);
    const theme = parseThemeDocument({
      ...record.theme,
      schemaVersion: THEME_SCHEMA_VERSION,
      kind: "theme",
      version,
    });
    const backgroundPath = theme.assets.background;
    if (!backgroundPath) throw new StudioError("STUDIO_DRAFT_INVALID", "Background image is required");
    const background = files.get(backgroundPath);
    if (!background) throw new StudioError("STUDIO_DRAFT_INVALID", "Background image is missing");
    files.set("preview.webp", await sharp(background)
      .resize({ width: 640, height: 400, fit: "cover" })
      .webp({ quality: 84 })
      .toBuffer());
    let bundle: ValidatedThemeBundle;
    let ref: ThemeRef;
    try {
      bundle = validateThemeBundle(theme, files);
      this.assertRuntimeReady(bundle);
      ref = await this.store.install(bundle);
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw studioThemeError("STUDIO_SAVE_FAILED", error, "Theme version was not saved");
    }
    return DraftRecordSchema.parse({
      ...record,
      theme,
      revision: record.revision + 1,
      updatedAt: this.now(),
      savedRef: ref,
      dirty: false,
    });
  }

  private async normalizeAsset(input: StudioUploadAssetInput): Promise<{
    readonly path: string;
    readonly bytes: Uint8Array;
  }> {
    if (input.slot === "ui-font" || input.slot === "code-font" ||
      input.slot === "display-font") {
      if (input.bytes.length > SOURCE_FONT_LIMIT_BYTES || sourceExtension(input.fileName) !== ".woff2" ||
        Buffer.from(input.bytes.subarray(0, 4)).toString("ascii") !== "wOF2") {
        throw new StudioError("STUDIO_ASSET_INVALID", "Font must be a valid WOFF2 file up to 5 MB");
      }
      const key = this.requiredAssetKey(input);
      const digest = createHash("sha256").update(input.bytes).digest("hex").slice(0, 12);
      return { path: `fonts/${key}-${digest}.woff2`, bytes: input.bytes };
    }
    if (!IMAGE_MIME_TYPES.has(input.mimeType) ||
      ![".png", ".jpg", ".jpeg", ".webp"].includes(sourceExtension(input.fileName))) {
      throw new StudioError(
        "STUDIO_ASSET_INVALID",
        `Asset slot ${input.slot} requires a PNG, JPEG, or WebP image`,
      );
    }
    if (input.bytes.length > SOURCE_IMAGE_LIMIT_BYTES) {
      throw new StudioError("STUDIO_ASSET_INVALID", "Source image exceeds 50 MB");
    }
    let output: Buffer;
    try {
      const suggestionSlot = suggestionIconSlot(input.slot);
      const interfaceImage = input.slot === "profile-avatar" || suggestionSlot !== undefined;
      const width = input.slot === "background"
        ? 2400
        : input.slot === "profile-avatar"
          ? 256
          : suggestionSlot
            ? 192
            : 1400;
      const height = input.slot === "background"
        ? 1350
        : input.slot === "profile-avatar"
          ? 256
          : suggestionSlot
            ? 192
            : 1400;
      output = await sharp(input.bytes, { limitInputPixels: 80_000_000 })
        .rotate()
        .resize({
          width,
          height,
          fit: interfaceImage ? "cover" : "inside",
          withoutEnlargement: !interfaceImage,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
    } catch (error) {
      throw new StudioError(
        "STUDIO_ASSET_INVALID",
        error instanceof Error ? error.message : "Image processing failed",
      );
    }
    if (output.length > PROCESSED_IMAGE_LIMIT_BYTES) {
      throw new StudioError("STUDIO_ASSET_INVALID", "Processed image exceeds 16 MB");
    }
    const digest = createHash("sha256").update(output).digest("hex").slice(0, 12);
    const path = input.slot === "background"
      ? `assets/background-${digest}.webp`
      : input.slot === "portrait"
        ? `assets/portrait-${digest}.webp`
        : input.slot === "profile-avatar"
          ? `assets/profile-avatar-${digest}.webp`
          : suggestionIconSlot(input.slot)
            ? `assets/${input.slot}-${digest}.webp`
            : `assets/decoration-${this.requiredAssetKey(input)}-${digest}.webp`;
    return { path, bytes: output };
  }

  private requiredAssetKey(input: StudioUploadAssetInput): string {
    if (input.assetKey) return input.assetKey;
    if (input.slot === "ui-font") return "ui-font";
    if (input.slot === "code-font") return "code-font";
    if (input.slot === "display-font") return "display-font";
    throw new StudioError("STUDIO_ASSET_INVALID", "Asset key is required");
  }

  private assertRuntimeReady(bundle: ValidatedThemeBundle): void {
    try {
      compileTheme(bundle);
    } catch (error) {
      throw new StudioError(
        "STUDIO_DRAFT_INVALID",
        error instanceof RuntimeThemeError
          ? error.message
          : "Theme cannot be compiled for the Runtime",
      );
    }
  }

  private assertPersonalThemeId(id: string): void {
    if (this.reservedThemeIds.has(id)) {
      throw new StudioError(
        "STUDIO_DRAFT_INVALID",
        "Theme ID is reserved by the built-in catalog",
      );
    }
  }

  private async readDraftFiles(
    draftId: string,
    theme: ThemeDraftDocument,
  ): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    for (const path of themeAssetPaths(theme)) {
      files.set(path, await readFile(this.assetPath(draftId, path)));
    }
    return files;
  }

  private async writeBundleFiles(
    draftId: string,
    files: ReadonlyMap<string, Uint8Array>,
  ): Promise<void> {
    for (const [path, bytes] of files) {
      if (path === "preview.webp") continue;
      if (!isSafeThemePath(path)) {
        throw new StudioError("STUDIO_ASSET_INVALID", "Theme source contains an unsafe asset path");
      }
      await this.writeAsset(draftId, path, bytes);
    }
  }

  private async listDraftRecords(): Promise<readonly DraftRecord[]> {
    let entries;
    try {
      entries = await readdir(this.dependencies.paths.themeStudioDraftDirectory, {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(entries
      .filter((entry) => entry.isDirectory() && z.string().uuid().safeParse(entry.name).success)
      .map((entry) => this.readRecord(entry.name)));
  }

  private async removeDraftGroup(
    targetGroup: string,
    builtinIds: readonly string[],
  ): Promise<void> {
    const records = await this.listDraftRecords();
    for (const record of records) {
      if (personalThemeGroupKey(record.theme.id, builtinIds) !== targetGroup) continue;
      await rm(this.draftDirectory(record.draftId), { recursive: true, force: true });
    }
  }

  private async removeDuplicateDrafts(): Promise<void> {
    const records = [...await this.listDraftRecords()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.draftId.localeCompare(left.draftId)
    );
    const retainedGroups = new Set<string>();
    for (const record of records) {
      const group = personalThemeGroupKey(record.theme.id, this.builtinThemeIds);
      if (!retainedGroups.has(group)) {
        retainedGroups.add(group);
        continue;
      }
      await rm(this.draftDirectory(record.draftId), { recursive: true, force: true });
    }
  }

  private async invalidateDeletedThemeRefs(refs: readonly ThemeRef[]): Promise<void> {
    const deleted = new Set(refs.map((ref) => `${ref.id}@${ref.version}`));
    let entries;
    try {
      entries = await readdir(this.dependencies.paths.themeStudioDraftDirectory, {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) continue;
      await this.mutate(entry.name, async (record) => {
        const savedRef = record.savedRef;
        if (!savedRef || !deleted.has(`${savedRef.id}@${savedRef.version}`)) return record;
        return DraftRecordSchema.parse({
          ...record,
          revision: record.revision + 1,
          updatedAt: this.now(),
          savedRef: null,
          dirty: true,
        });
      });
    }
  }

  private async writeAsset(draftId: string, path: string, bytes: Uint8Array): Promise<void> {
    const target = this.assetPath(draftId, path);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}-${this.newId()}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  }

  private view(record: DraftRecord): StudioDraft {
    const assetUrls = Object.fromEntries(themeAssetPaths(record.theme).map((path) => [
      path,
      `/api/draft-asset?draftId=${encodeURIComponent(record.draftId)}&path=${encodeURIComponent(path)}`,
    ]));
    return StudioDraftSchema.parse({
      draftId: record.draftId,
      theme: record.theme,
      revision: record.revision,
      updatedAt: record.updatedAt,
      savedRef: record.savedRef,
      dirty: record.dirty,
      undoAvailable: record.past.length > 0,
      redoAvailable: record.future.length > 0,
      issues: validateStudioDraft(record.theme),
      assetUrls,
    });
  }

  private async mutate(
    draftId: string,
    operation: (record: DraftRecord) => Promise<DraftRecord>,
  ): Promise<StudioDraft> {
    const previous = this.queues.get(draftId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.queues.set(draftId, current);
    await previous;
    try {
      const next = await operation(await this.readRecord(draftId));
      await this.writeRecord(next);
      await this.cleanupDraftAssets(next);
      return this.view(next);
    } finally {
      release();
      if (this.queues.get(draftId) === current) this.queues.delete(draftId);
    }
  }

  private async serializeTheme<T>(themeId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.themeQueues.get(themeId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.themeQueues.set(themeId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.themeQueues.get(themeId) === current) this.themeQueues.delete(themeId);
    }
  }

  private assertRevision(record: DraftRecord, expectedRevision: number): void {
    if (record.revision !== expectedRevision) {
      throw new StudioError(
        "STUDIO_DRAFT_CONFLICT",
        `Draft revision changed from ${expectedRevision} to ${record.revision}`,
      );
    }
  }

  private draftDirectory(draftId: string): string {
    const parsed = z.string().uuid().parse(draftId);
    return join(this.dependencies.paths.themeStudioDraftDirectory, parsed);
  }

  private recordPath(draftId: string): string {
    return join(this.draftDirectory(draftId), "draft.json");
  }

  private assetPath(draftId: string, path: string): string {
    if (!isSafeThemePath(path)) {
      throw new StudioError("STUDIO_ASSET_INVALID", "Draft asset path is unsafe");
    }
    return join(this.draftDirectory(draftId), ...path.split("/"));
  }

  private async readRecord(draftId: string): Promise<DraftRecord> {
    try {
      return parseDraftRecord(JSON.parse(await readFile(this.recordPath(draftId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StudioError("STUDIO_DRAFT_NOT_FOUND", "Theme draft does not exist");
      }
      if (error instanceof StudioError) throw error;
      throw new StudioError(
        "STUDIO_DRAFT_INVALID",
        error instanceof Error ? error.message : "Theme draft is invalid",
      );
    }
  }

  private async writeRecord(record: DraftRecord): Promise<void> {
    const target = this.recordPath(record.draftId);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}-${this.newId()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(DraftRecordSchema.parse(record), null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  private async cleanupDraftAssets(record: DraftRecord): Promise<void> {
    const referenced = recordAssetPaths(record);
    await Promise.all([
      this.cleanupDraftAssetDirectory(record.draftId, "assets", referenced),
      this.cleanupDraftAssetDirectory(record.draftId, "fonts", referenced),
    ]);
  }

  private async cleanupDraftAssetDirectory(
    draftId: string,
    relativeDirectory: string,
    referenced: ReadonlySet<string>,
  ): Promise<void> {
    const directory = join(this.draftDirectory(draftId), ...relativeDirectory.split("/"));
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        await this.cleanupDraftAssetDirectory(draftId, relativePath, referenced);
      } else if (entry.isFile() && !referenced.has(relativePath)) {
        await rm(join(directory, entry.name));
      }
    }

    try {
      await rmdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }

  private previewUrl(source: "builtin" | "personal", id: string, version: string): string {
    return `/api/theme-preview?source=${source}&id=${encodeURIComponent(id)}&version=${encodeURIComponent(version)}`;
  }

  private libraryItem(
    theme: ThemeDraftDocument,
    source: "builtin" | "personal" | "recipe",
    ready: boolean,
    localOnly: boolean,
    previewUrl: string | null,
  ) {
    return {
      ref: { id: theme.id, version: theme.version },
      name: theme.name,
      ...(theme.description ? { description: theme.description } : {}),
      author: theme.author,
      homepage: theme.metadata?.homepage ?? null,
      ...(theme.metadata?.localized ? { localized: theme.metadata.localized } : {}),
      source,
      ready,
      localOnly,
      previewUrl,
    };
  }
}
