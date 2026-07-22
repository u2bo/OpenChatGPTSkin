import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadThemeDirectory } from "@open-chatgpt-skin/theme-core";

describe("loadThemeDirectory", () => {
  it("loads the validated mountain-mist bundle", async () => {
    const bundle = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
    expect(bundle.theme).toMatchObject({ id: "mountain-mist", version: "1.3.0" });
    expect(bundle.files.has("assets/background.webp")).toBe(true);
  });

  it("rejects unsafe theme documents before reading referenced files", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-directory-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "theme.json"), JSON.stringify({
      schemaVersion: 1,
      kind: "theme",
      id: "bad-theme",
      name: "bad",
      version: "1.0.0",
      author: "test",
      assets: { background: "../secret.webp" },
    }));
    await expect(loadThemeDirectory(root)).rejects.toMatchObject({
      code: "THEME_SCHEMA_INVALID",
    });
  });
});
