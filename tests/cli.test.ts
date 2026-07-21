import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_MODULES } from "@open-chatgpt-skin/theme-schema";
import { runCli } from "@open-chatgpt-skin/theme-core";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function createThemeDirectory(root: string): Promise<string> {
  const directory = join(root, "theme");
  await mkdir(join(directory, "assets"), { recursive: true });
  const theme = {
    schemaVersion: 1,
    kind: "theme",
    id: "cli-demo",
    name: "CLI Demo",
    version: "1.0.0",
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
  };
  await writeFile(join(directory, "theme.json"), JSON.stringify(theme));
  await writeFile(join(directory, "assets", "background.png"), png);
  return directory;
}

describe("foundation CLI", () => {
  it("lists the built-in catalog as JSON", async () => {
    const output: string[] = [];
    const code = await runCli(["catalog", "--root", resolve("themes")], {
      stdout: (value) => output.push(value),
      stderr: (value) => output.push(`ERR:${value}`),
    });

    expect(code).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({ schemaVersion: 1 });
  });

  it("returns a stable nonzero code for an unknown command", async () => {
    const errors: string[] = [];
    const code = await runCli(["unknown"], {
      stdout: () => {},
      stderr: (value) => errors.push(value),
    });

    expect(code).toBe(64);
    expect(JSON.parse(errors.join("")).error.code).toBe("CLI_USAGE");
  });

  it("keeps non-file asset paths in the CLI write-error category", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-cli-"));
    const themeDir = await createThemeDirectory(root);
    const background = join(themeDir, "assets", "background.png");
    await rm(background);
    await mkdir(background);
    const errors: string[] = [];

    const code = await runCli(["validate", "--dir", themeDir], {
      stdout: () => {},
      stderr: (value) => errors.push(value),
    });

    expect(code).toBe(73);
    expect(JSON.parse(errors.join("")).error.code).toBe("CLI_WRITE");
  });

  it("validates, packs, and safely unpacks a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-cli-"));
    const themeDir = await createThemeDirectory(root);
    const archivePath = join(root, "theme.ocskin");
    const existingArchivePath = join(root, "existing.ocskin");
    const unpackedDir = join(root, "unpacked");
    const existingEmptyDir = join(root, "existing-empty");
    const nonEmptyDir = join(root, "non-empty");
    const malformedDir = join(root, "malformed");
    await writeFile(existingArchivePath, "keep");
    await mkdir(existingEmptyDir);
    await mkdir(nonEmptyDir);
    await writeFile(join(nonEmptyDir, "keep.txt"), "keep");
    await mkdir(malformedDir);
    await writeFile(join(malformedDir, "theme.json"), JSON.stringify({
      schemaVersion: 1,
      kind: "theme",
      id: "bad",
      version: "1.0.0",
      assets: { background: "../secret.png" },
    }));
    const output: string[] = [];
    const io = {
      stdout: (value: string) => output.push(value),
      stderr: (value: string) => output.push(value),
    };

    expect(await runCli(["validate", "--dir", themeDir], io)).toBe(0);
    expect(await runCli(["pack", "--dir", themeDir, "--out", archivePath], io)).toBe(0);
    expect((await readFile(archivePath)).length).toBeGreaterThan(0);
    expect(await runCli(["pack", "--dir", themeDir, "--out", existingArchivePath], io)).toBe(73);
    expect(await readFile(existingArchivePath, "utf8")).toBe("keep");
    expect(await runCli(["unpack", "--file", archivePath, "--out", unpackedDir], io)).toBe(0);
    expect(JSON.parse(await readFile(join(unpackedDir, "manifest.json"), "utf8")).schemaVersion).toBe(1);
    expect(await runCli(["unpack", "--file", archivePath, "--out", existingEmptyDir], io)).toBe(73);
    expect(await runCli(["unpack", "--file", archivePath, "--out", nonEmptyDir], io)).toBe(73);
    expect(await runCli(["validate", "--dir", malformedDir], io)).toBe(65);
  });
});
