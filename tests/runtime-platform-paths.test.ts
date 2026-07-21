import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProductionRuntimePaths,
  createRuntimePaths,
  createProductionDesktopProvider,
  PowerShellWindowsProvider,
  prepareProductionRuntimePaths,
} from "@open-chatgpt-skin/windows-runtime";

const metaUrl = new URL("../runtime/windows/src/paths.ts", import.meta.url).href;

describe("desktop Runtime platform selection", () => {
  it("keeps the Windows data root under LOCALAPPDATA", () => {
    const paths = createProductionRuntimePaths(metaUrl, {
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    });
    expect(paths.dataRoot.replaceAll("\\", "/"))
      .toBe("C:/Users/tester/AppData/Local/OpenChatGPTSkin");
  });

  it("uses Application Support on macOS", () => {
    const paths = createProductionRuntimePaths(metaUrl, {
      platform: "darwin",
      env: {},
      homeDirectory: "/Users/tester",
    });
    expect(paths.dataRoot.replaceAll("\\", "/"))
      .toBe("/Users/tester/Library/Application Support/OpenChatGPTSkin");
  });

  it("fails closed on unsupported desktop platforms", () => {
    expect(() => createProductionRuntimePaths(metaUrl, {
      platform: "linux",
      env: {},
      homeDirectory: "/home/tester",
    })).toThrow(expect.objectContaining({ code: "RUNTIME_ENVIRONMENT_INVALID" }));
    expect(() => createProductionDesktopProvider(
      createRuntimePaths("D:/data", "D:/install"),
      "linux",
    )).toThrow(expect.objectContaining({ code: "RUNTIME_ENVIRONMENT_INVALID" }));
  });

  it.skipIf(process.platform !== "win32")("selects the Windows provider on Windows", () => {
    const provider = createProductionDesktopProvider(
      createRuntimePaths("D:/data", "D:/install"),
      "win32",
    );
    expect(provider).toBeInstanceOf(PowerShellWindowsProvider);
    expect(provider.platform).toBe("win32");
  });

  it("atomically adopts pre-rename data when the new directory is absent", async () => {
    const localAppData = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-migrate-"));
    const legacyRoot = join(localAppData, "OpenCodexSkin");
    await mkdir(legacyRoot);
    await writeFile(join(legacyRoot, "marker.txt"), "preserved", "utf8");

    const paths = await prepareProductionRuntimePaths(metaUrl, {
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
    });

    await expect(readFile(join(paths.dataRoot, "marker.txt"), "utf8"))
      .resolves.toBe("preserved");
  });

  it("never merges previous data over an existing new-brand directory", async () => {
    const localAppData = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-authority-"));
    const legacyRoot = join(localAppData, "OpenCodexSkin");
    const currentRoot = join(localAppData, "OpenChatGPTSkin");
    await Promise.all([mkdir(legacyRoot), mkdir(currentRoot)]);
    await Promise.all([
      writeFile(join(legacyRoot, "legacy.txt"), "legacy", "utf8"),
      writeFile(join(currentRoot, "current.txt"), "current", "utf8"),
    ]);

    const paths = await prepareProductionRuntimePaths(metaUrl, {
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
    });

    expect(paths.dataRoot).toBe(currentRoot);
    await expect(readFile(join(paths.dataRoot, "current.txt"), "utf8"))
      .resolves.toBe("current");
    await expect(readFile(join(legacyRoot, "legacy.txt"), "utf8"))
      .resolves.toBe("legacy");
  });
});
