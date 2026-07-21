import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadThemeDirectory,
  packTheme,
  ThemeStore,
  validateThemeBundle,
} from "@open-chatgpt-skin/theme-core";
import {
  RUNTIME_BUILTIN_THEME_IDS,
  RuntimeThemeRepository,
} from "@open-chatgpt-skin/windows-runtime";

describe("RuntimeThemeRepository", () => {
  const repository = new RuntimeThemeRepository(resolve("themes"));

  it("lists exactly the four reviewed public themes", async () => {
    expect((await repository.list()).map((theme) => theme.id)).toEqual(
      RUNTIME_BUILTIN_THEME_IDS,
    );
  });

  it.each(RUNTIME_BUILTIN_THEME_IDS)("loads and compiles %s", async (themeId) => {
    const loaded = await repository.load(themeId);
    expect(loaded.descriptor).toMatchObject({ id: themeId, ready: true });
    expect(loaded.compiled.themeId).toBe(themeId);
  });

  it("reports removed local recipes and unknown IDs as unavailable", async () => {
    await expect(repository.load("missing-theme"))
      .rejects.toMatchObject({ code: "THEME_NOT_FOUND" });
    await expect(repository.load("hatsune-miku-local"))
      .rejects.toMatchObject({ code: "THEME_NOT_FOUND" });
    await expect(repository.load("dilraba-local"))
      .rejects.toMatchObject({ code: "THEME_NOT_FOUND" });
  });

  it("rejects a theme whose validated metadata differs from its catalog entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-runtime-theme-"));
    try {
      await mkdir(join(root, "builtin"), { recursive: true });
      await cp(
        resolve("themes/builtin/mountain-mist"),
        join(root, "builtin", "mountain-mist"),
        { recursive: true },
      );
      await writeFile(join(root, "catalog.json"), JSON.stringify({
        schemaVersion: 1,
        builtins: [{
          id: "mountain-mist",
          name: "山岚云海",
          version: "9.9.9",
          kind: "theme",
          path: "builtin/mountain-mist",
          ready: true,
          localOnly: false,
          licenseId: "LicenseRef-OpenChatGPTSkin-Original",
          preview: "builtin/mountain-mist/preview.webp",
        }],
        recipes: [],
      }));

      await expect(new RuntimeThemeRepository(root).load("mountain-mist"))
        .rejects.toMatchObject({ code: "THEME_NOT_READY" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads personal themes only by an exact immutable store reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-runtime-personal-"));
    try {
      const storeRoot = join(root, "theme-store");
      const source = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
      const personal = validateThemeBundle({
        ...source.theme,
        id: "personal-mountain",
        name: "个人山岚",
        version: "2.3.4",
        rights: {
          licenseId: "LicenseRef-User-Supplied",
          localOnly: true,
        },
      }, source.files);
      await new ThemeStore(storeRoot).install(personal);
      const repository = new RuntimeThemeRepository(resolve("themes"), storeRoot);

      await expect(repository.load({ id: "personal-mountain", version: "2.3.4" }))
        .resolves.toMatchObject({
          descriptor: { id: "personal-mountain", version: "2.3.4" },
          compiled: { themeId: "personal-mountain", themeVersion: "2.3.4" },
        });
      await expect(repository.load({ id: "personal-mountain" }))
        .rejects.toMatchObject({ code: "THEME_NOT_READY" });
      await expect(repository.load({ id: "personal-mountain", version: "9.9.9" }))
        .rejects.toMatchObject({ code: "THEME_NOT_FOUND" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("imports a validated ocskin file into the personal Runtime store", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-runtime-import-"));
    try {
      const storeRoot = join(root, "theme-store");
      const source = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
      const personal = validateThemeBundle({
        ...source.theme,
        id: "imported-mountain",
        name: "导入山岚",
        version: "3.2.1",
      }, source.files);
      const archive = join(root, "imported-mountain.ocskin");
      await writeFile(archive, packTheme(personal));
      const repositoryWithStore = new RuntimeThemeRepository(resolve("themes"), storeRoot);

      await expect(repositoryWithStore.importFile(archive)).resolves.toEqual({
        id: "imported-mountain",
        name: "导入山岚",
        version: "3.2.1",
        ready: true,
      });
      await expect(repositoryWithStore.load({ id: "imported-mountain", version: "3.2.1" }))
        .resolves.toMatchObject({ compiled: { themeId: "imported-mountain" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
