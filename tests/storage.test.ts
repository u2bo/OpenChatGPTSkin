import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_MODULES } from "@open-chatgpt-skin/theme-schema";
import { ThemeStore, validateThemeBundle } from "@open-chatgpt-skin/theme-core";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const alternatePng = Uint8Array.from([...png, 0x01]);

const makeTheme = (id: string, version: string) => ({
  schemaVersion: 1,
  kind: "theme",
  id,
  name: id,
  version,
  author: "test",
  assets: { background: "assets/background.png" },
  colors: {
    accent: "#112233",
    secondary: "#223344",
    text: "#ffffff",
    muted: "#aabbcc",
    panel: "#101010",
    border: "#333333",
    success: "#228855",
    warning: "#bb7711",
    danger: "#cc3344",
    info: "#3388cc",
  },
  typography: {
    uiFamily: "Segoe UI",
    codeFamily: "Cascadia Code",
    scale: 1,
    uiSize: 14,
    codeSize: 13,
    uiWeight: 500,
    codeWeight: 400,
    lineHeight: 1.5,
  },
  background: {
    positionX: 0.5,
    positionY: 0.5,
    scale: 1,
    blur: 0,
    brightness: 1,
    overlay: 0.2,
  },
  decorations: [],
  layout: {
    heroHeight: 320,
    cardColumns: 4,
    composerWidth: 0.7,
    sidebarDensity: "comfortable",
    moduleGap: 16,
    modules: DEFAULT_LAYOUT_MODULES,
  },
  rights: { licenseId: "test", attribution: "test", localOnly: false },
});

describe("ThemeStore", () => {
  it("installs immutable versions and rolls active state back", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-store-"));
    const store = new ThemeStore(root);
    const first = await store.install(validateThemeBundle(
      makeTheme("demo", "1.0.0"),
      new Map([["assets/background.png", png]]),
    ));
    const second = await store.install(validateThemeBundle(
      makeTheme("demo", "1.1.0"),
      new Map([["assets/background.png", png]]),
    ));

    await store.activate(first);
    await store.activate(second);
    await store.activate(second);
    expect(await store.readState()).toMatchObject({ active: second, previous: first });

    await store.rollback();
    expect(await store.readState()).toMatchObject({ active: first, previous: second });
    expect(JSON.parse(await readFile(join(root, "state.json"), "utf8")).schemaVersion).toBe(1);
    expect((await store.readTheme(first)).theme.version).toBe("1.0.0");
  });

  it("rejects version conflicts, unsafe references, and corrupt state", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-store-"));
    const store = new ThemeStore(root);
    const original = validateThemeBundle(
      makeTheme("demo", "1.0.0"),
      new Map([["assets/background.png", png]]),
    );
    const ref = await store.install(original);
    expect(await store.install(original)).toEqual(ref);

    await expect(store.install(validateThemeBundle(
      makeTheme("demo", "1.0.0"),
      new Map([["assets/background.png", alternatePng]]),
    ))).rejects.toMatchObject({ code: "THEME_VERSION_CONFLICT" });
    await expect(store.readTheme({ id: "../escape", version: "1.0.0" }))
      .rejects.toMatchObject({ code: "THEME_REF_INVALID" });

    await writeFile(join(root, "state.json"), JSON.stringify({
      schemaVersion: 1,
      active: { id: "../escape", version: "1.0.0" },
    }));
    await expect(store.readState()).rejects.toMatchObject({ code: "THEME_STATE_INVALID" });
  });

  it("fails rollback when no previous theme exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-store-"));
    await expect(new ThemeStore(root).rollback())
      .rejects.toMatchObject({ code: "ROLLBACK_UNAVAILABLE" });
  });

  it("removes only unreferenced immutable versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-store-"));
    const store = new ThemeStore(root);
    const first = await store.install(validateThemeBundle(
      makeTheme("demo", "1.0.0"),
      new Map([["assets/background.png", png]]),
    ));
    const second = await store.install(validateThemeBundle(
      makeTheme("demo", "1.1.0"),
      new Map([["assets/background.png", png]]),
    ));

    await store.remove(first);
    expect(await store.list()).toEqual([second]);
    await store.activate(second);
    await expect(store.remove(second)).rejects.toMatchObject({ code: "THEME_IN_USE" });
  });

  it("rejects a stored document whose identity differs from its directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-store-"));
    const store = new ThemeStore(root);
    const ref = await store.install(validateThemeBundle(
      makeTheme("demo", "1.0.0"),
      new Map([["assets/background.png", png]]),
    ));
    await writeFile(
      join(root, "themes", ref.id, ref.version, "theme.json"),
      JSON.stringify(makeTheme("other-theme", "2.0.0")),
    );

    await expect(store.readTheme(ref)).rejects.toMatchObject({
      code: "STORED_THEME_IDENTITY_MISMATCH",
    });
  });
});
