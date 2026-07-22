import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  createRuntimePaths,
  type RuntimePaths,
} from "@open-chatgpt-skin/windows-runtime";
import {
  ThemeStudioWorkspace,
} from "@open-chatgpt-skin/theme-studio-service";
import type {
  StudioRuntimeStatus,
  StudioThemeRef,
} from "@open-chatgpt-skin/theme-studio-core";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

const stopped: StudioRuntimeStatus = {
  status: "stopped",
  controllerAvailable: false,
  selectedTheme: null,
  appliedTheme: null,
  skinApplied: false,
  packageVersion: null,
  operation: null,
  nextAction: "Launch a managed Codex session.",
};

async function createWorkspace(): Promise<{
  readonly workspace: ThemeStudioWorkspace;
  readonly paths: RuntimePaths;
  readonly applyRuntimeTheme: ReturnType<typeof vi.fn>;
}> {
  const root = await mkdtemp(join(tmpdir(), "ocs-studio-"));
  temporaryRoots.push(root);
  const paths = createRuntimePaths(root, resolve("."));
  const applyRuntimeTheme = vi.fn(async (ref: StudioThemeRef): Promise<StudioRuntimeStatus> => ({
    status: "active",
    controllerAvailable: true,
    selectedTheme: ref,
    appliedTheme: ref,
    skinApplied: true,
    packageVersion: "26.707.12708.0",
    operation: null,
    nextAction: "Theme is active.",
  }));
  const result = new ThemeStudioWorkspace({
    paths,
    runtimeStatus: async () => stopped,
    applyRuntimeTheme,
    restoreRuntimeTheme: async () => stopped,
    now: () => "2026-07-18T02:00:00.000Z",
  });
  await result.initialize();
  return { workspace: result, paths, applyRuntimeTheme };
}

describe("ThemeStudioWorkspace", () => {
  it("creates, updates, validates, undoes, and redoes a typed draft", async () => {
    const { workspace, applyRuntimeTheme } = await createWorkspace();
    const library = await workspace.listThemes();
    expect(library.themes.filter((theme) => theme.source === "builtin")).toHaveLength(4);
    expect(library.themes.filter((theme) => theme.source === "recipe")).toHaveLength(0);

    const source = library.themes.find((theme) => theme.ref.id === "mountain-mist")!;
    expect(source).toMatchObject({
      author: "OpenChatGPTSkin",
      homepage: "https://github.com/u2bo/OpenChatGPTSkin.git",
      localized: { en: { name: "Mountain Mist" } },
    });
    await expect(workspace.applySavedTheme(source.ref)).resolves.toMatchObject({
      status: "active",
      appliedTheme: source.ref,
    });
    expect(applyRuntimeTheme).toHaveBeenCalledWith(source.ref);
    await expect(workspace.exportTheme(source.ref)).rejects.toMatchObject({
      code: "STUDIO_EXPORT_INVALID",
      message: "只有个人主题可以导出",
    });
    const draft = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      themeId: "my-mountain",
      name: "我的山岚",
    });
    expect(draft).toMatchObject({ revision: 0, dirty: true });
    expect(draft.assetUrls[draft.theme.assets.background!]).toMatch(/^\/api\/draft-asset/);
    await expect(workspace.openLatestDraft()).resolves.toMatchObject({
      draftId: draft.draftId,
      revision: draft.revision,
    });

    const reservedTheme = structuredClone(draft.theme);
    reservedTheme.id = "mountain-mist";
    await expect(workspace.updateDraft({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      theme: reservedTheme,
    })).rejects.toMatchObject({
      code: "STUDIO_DRAFT_INVALID",
      message: "Theme ID is reserved by the built-in catalog",
    });

    const invalidTheme = structuredClone(draft.theme);
    invalidTheme.colors.text = "#ffffff";
    const invalid = await workspace.updateDraft({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      theme: invalidTheme,
    });
    expect(invalid.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TEXT_CONTRAST_TOO_LOW", path: "colors.text" }),
    ]));
    await expect(workspace.saveVersion({
      draftId: invalid.draftId,
      expectedRevision: invalid.revision,
    })).rejects.toMatchObject({ code: "STUDIO_DRAFT_INVALID" });

    const undone = await workspace.undo({
      draftId: invalid.draftId,
      expectedRevision: invalid.revision,
    });
    expect(undone.theme.colors.text).toBe(draft.theme.colors.text);
    const redone = await workspace.redo({
      draftId: undone.draftId,
      expectedRevision: undone.revision,
    });
    expect(redone.theme.colors.text).toBe("#ffffff");
  });

  it("keeps one draft per theme and requires an explicit load or overwrite choice", async () => {
    const { workspace } = await createWorkspace();
    const source = (await workspace.listThemes()).themes
      .find((theme) => theme.ref.id === "mountain-mist")!;

    const first = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
    });
    expect(first.theme.id).toBe("mountain-mist-custom");
    await expect(workspace.createDraft({
      source: { source: source.source, ref: source.ref },
    })).rejects.toMatchObject({ code: "STUDIO_DRAFT_CONFLICT" });

    const loaded = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      conflictResolution: "load-existing",
    });
    expect(loaded.draftId).toBe(first.draftId);

    const overwritten = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      conflictResolution: "overwrite-existing",
    });
    expect(overwritten.draftId).toBe(first.draftId);
    expect(overwritten.theme.id).toBe(first.theme.id);
  });

  it("uploads authorized artwork, saves, exports, imports, and applies an exact version", async () => {
    const { workspace, applyRuntimeTheme } = await createWorkspace();
    const source = (await workspace.listThemes()).themes
      .find((theme) => theme.ref.id === "mountain-mist")!;
    const draft = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      themeId: "my-local-vocalist",
      name: "我的本地歌姬",
    });
    expect(draft.issues).toHaveLength(0);

    const publicWithoutAttribution = structuredClone(draft.theme);
    publicWithoutAttribution.rights.localOnly = false;
    delete publicWithoutAttribution.rights.attribution;
    const rightsInvalid = await workspace.updateDraft({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      theme: publicWithoutAttribution,
    });
    expect(rightsInvalid.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "RIGHTS_ATTRIBUTION_REQUIRED",
        path: "rights.attribution",
      }),
    ]));
    const rightsUndone = await workspace.undo({
      draftId: rightsInvalid.draftId,
      expectedRevision: rightsInvalid.revision,
    });

    const sourceImage = await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 4,
        background: { r: 32, g: 124, b: 134, alpha: 1 },
      },
    }).png().toBuffer();
    const uploaded = await workspace.uploadAsset({
      draftId: rightsUndone.draftId,
      expectedRevision: rightsUndone.revision,
      slot: "background",
      fileName: "authorized-art.png",
      mimeType: "image/png",
      bytes: sourceImage,
    });
    expect(uploaded.theme.assets.background).toMatch(/^assets\/background-[0-9a-f]{12}\.webp$/);
    expect(uploaded.issues).toHaveLength(0);

    const uploadUndone = await workspace.undo({
      draftId: uploaded.draftId,
      expectedRevision: uploaded.revision,
    });
    expect(uploadUndone.theme.assets.background).toBe(draft.theme.assets.background);
    const uploadRedone = await workspace.redo({
      draftId: uploadUndone.draftId,
      expectedRevision: uploadUndone.revision,
    });
    expect(uploadRedone.theme.assets.background).toBe(uploaded.theme.assets.background);
    await expect(workspace.readDraftAsset(
      uploadRedone.draftId,
      uploadRedone.theme.assets.background!,
    )).resolves.toMatchObject({ mimeType: "image/webp" });

    const saved = await workspace.saveVersion({
      draftId: uploadRedone.draftId,
      expectedRevision: uploadRedone.revision,
    });
    expect(saved.ref).toEqual({ id: "my-local-vocalist", version: "1.0.0" });
    expect(saved.draft.dirty).toBe(false);

    const sameContentDraft = await workspace.createDraft({
      source: { source: "personal", ref: saved.ref },
      themeId: saved.ref.id,
      name: saved.draft.theme.name,
      conflictResolution: "load-existing",
    });
    expect(sameContentDraft.draftId).toBe(saved.draft.draftId);
    const idempotentSave = await workspace.saveVersion({
      draftId: sameContentDraft.draftId,
      expectedRevision: sameContentDraft.revision,
    });
    expect(idempotentSave.ref).toEqual(saved.ref);

    const changedTheme = structuredClone(idempotentSave.draft.theme);
    changedTheme.colors.accent = "#167f8a";
    const changedDraft = await workspace.updateDraft({
      draftId: idempotentSave.draft.draftId,
      expectedRevision: idempotentSave.draft.revision,
      theme: changedTheme,
    });
    await expect(workspace.saveVersion({
      draftId: changedDraft.draftId,
      expectedRevision: changedDraft.revision,
    })).resolves.toMatchObject({
      ref: { id: saved.ref.id, version: "1.0.1" },
    });

    await expect(workspace.createDraft({
      source: { source: "personal", ref: saved.ref },
      themeId: saved.ref.id,
      name: saved.draft.theme.name,
    })).rejects.toMatchObject({ code: "STUDIO_DRAFT_CONFLICT" });

    const exported = await workspace.exportTheme(saved.ref);
    expect(exported.fileName).toBe("my-local-vocalist-1.0.0.ocskin");
    expect(exported.bytes.length).toBeGreaterThan(100);

    const imported = await workspace.importTheme({
      fileName: exported.fileName,
      bytes: exported.bytes,
    });
    expect(imported.savedRef).toEqual(saved.ref);
    expect(imported.dirty).toBe(false);

    const applied = await workspace.applyTheme({
      draftId: imported.draftId,
      expectedRevision: imported.revision,
    });
    expect(applied.runtime).toMatchObject({ status: "active", appliedTheme: saved.ref });
    expect(applyRuntimeTheme).toHaveBeenCalledWith(saved.ref);
  });

  it("normalizes interface imagery, shares the background, and keeps failed uploads atomic", async () => {
    const { workspace, paths } = await createWorkspace();
    const source = (await workspace.listThemes()).themes
      .find((theme) => theme.ref.id === "mountain-mist")!;
    const draft = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      themeId: "interface-imagery-demo",
      name: "界面素材测试",
    });
    const sourceImage = await sharp({
      create: {
        width: 900,
        height: 500,
        channels: 4,
        background: { r: 42, g: 119, b: 151, alpha: 1 },
      },
    }).png().toBuffer();

    const avatar = await workspace.uploadAsset({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      slot: "profile-avatar",
      fileName: "avatar.png",
      mimeType: "image/png",
      bytes: sourceImage,
    });
    const avatarPath = avatar.theme.assets.profileAvatar!;
    expect(avatarPath).toMatch(/^assets\/profile-avatar-[0-9a-f]{12}\.webp$/);
    expect(await sharp((await workspace.readDraftAsset(
      avatar.draftId,
      avatarPath,
    )).bytes).metadata()).toMatchObject({ width: 256, height: 256 });

    const suggestion = await workspace.uploadAsset({
      draftId: avatar.draftId,
      expectedRevision: avatar.revision,
      slot: "suggestion-card1",
      fileName: "card.png",
      mimeType: "image/png",
      bytes: sourceImage,
    });
    const suggestionPath = suggestion.theme.assets.suggestionIcons?.card1!;
    expect(suggestionPath).toMatch(/^assets\/suggestion-card1-[0-9a-f]{12}\.webp$/);
    expect(await sharp((await workspace.readDraftAsset(
      suggestion.draftId,
      suggestionPath,
    )).bytes).metadata()).toMatchObject({ width: 192, height: 192 });

    const sharedTheme = structuredClone(suggestion.theme);
    const backgroundPath = sharedTheme.assets.background!;
    sharedTheme.assets.profileAvatar = backgroundPath;
    sharedTheme.assets.suggestionIcons = {
      card1: backgroundPath,
      card2: backgroundPath,
      card3: backgroundPath,
      card4: backgroundPath,
    };
    const shared = await workspace.updateDraft({
      draftId: suggestion.draftId,
      expectedRevision: suggestion.revision,
      theme: sharedTheme,
    });
    expect(shared.assetUrls[backgroundPath]).toMatch(/^\/api\/draft-asset/);
    expect(Object.keys(shared.assetUrls).filter((path) => path === backgroundPath)).toHaveLength(1);

    await expect(workspace.uploadAsset({
      draftId: shared.draftId,
      expectedRevision: shared.revision,
      slot: "suggestion-card2",
      fileName: "broken.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("not an image"),
    })).rejects.toMatchObject({ code: "STUDIO_ASSET_INVALID" });
    await expect(workspace.openDraft(shared.draftId)).resolves.toMatchObject({
      revision: shared.revision,
      theme: { assets: { suggestionIcons: sharedTheme.assets.suggestionIcons } },
    });

    const orphanPath = join(
      paths.themeStudioDraftDirectory,
      shared.draftId,
      "assets",
      "orphan.webp",
    );
    await writeFile(orphanPath, sourceImage);
    const renamedTheme = structuredClone(shared.theme);
    renamedTheme.name = "界面素材测试（已更新）";
    await workspace.updateDraft({
      draftId: shared.draftId,
      expectedRevision: shared.revision,
      theme: renamedTheme,
    });
    await expect(readFile(orphanPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates persisted v2 draft history to v3 when it is reopened", async () => {
    const { workspace, paths } = await createWorkspace();
    const source = (await workspace.listThemes()).themes
      .find((theme) => theme.ref.id === "mountain-mist")!;
    const draft = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      themeId: "legacy-draft",
      name: "旧草稿",
    });
    const recordPath = join(paths.themeStudioDraftDirectory, draft.draftId, "draft.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    record.theme.schemaVersion = 2;
    delete record.theme.assets.profileAvatar;
    delete record.theme.assets.suggestionIcons;
    record.past = [{ ...record.theme }];
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

    const migrated = await workspace.openDraft(draft.draftId);

    expect(migrated.theme.schemaVersion).toBe(3);
    expect(migrated.undoAvailable).toBe(true);
    await expect(workspace.undo({
      draftId: migrated.draftId,
      expectedRevision: migrated.revision,
    })).resolves.toMatchObject({ theme: { schemaVersion: 3 } });
  });

  it("never creates a personal version from the apply command", async () => {
    const { workspace, applyRuntimeTheme } = await createWorkspace();
    const source = (await workspace.listThemes()).themes
      .find((theme) => theme.ref.id === "mountain-mist")!;
    const draft = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      themeId: "unsaved-mountain",
      name: "未保存山岚",
    });

    await expect(workspace.applyTheme({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
    })).rejects.toMatchObject({ code: "STUDIO_APPLY_FAILED" });
    expect((await workspace.listThemes()).themes.some((theme) =>
      theme.source === "personal" && theme.ref.id === draft.theme.id
    )).toBe(false);
    expect(applyRuntimeTheme).not.toHaveBeenCalled();
  });

  it("deletes one personal version or every version and invalidates saved draft refs", async () => {
    const { workspace } = await createWorkspace();
    const source = (await workspace.listThemes()).themes
      .find((theme) => theme.ref.id === "mountain-mist")!;
    const draft = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      themeId: "deletable-mountain",
      name: "可删除山岚",
    });
    const first = await workspace.saveVersion({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
    });
    const changedTheme = structuredClone(first.draft.theme);
    changedTheme.colors.accent = "#315f4a";
    const changed = await workspace.updateDraft({
      draftId: draft.draftId,
      expectedRevision: first.draft.revision,
      theme: changedTheme,
    });
    const second = await workspace.saveVersion({
      draftId: draft.draftId,
      expectedRevision: changed.revision,
    });

    await workspace.deletePersonalTheme({
      id: first.ref.id,
      version: first.ref.version,
    });
    expect((await workspace.listThemes()).themes.filter((theme) =>
      theme.source === "personal" && theme.ref.id === first.ref.id
    ).map((theme) => theme.ref.version)).toEqual([second.ref.version]);

    await workspace.deletePersonalTheme({ id: second.ref.id });
    expect((await workspace.listThemes()).themes.some((theme) =>
      theme.source === "personal" && theme.ref.id === second.ref.id
    )).toBe(false);
    await expect(workspace.openDraft(draft.draftId))
      .rejects.toMatchObject({ code: "STUDIO_DRAFT_NOT_FOUND" });
  });
});
