import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Go production cutover", () => {
  it("makes Go the only default business host", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly version: string;
      readonly scripts: Readonly<Record<string, string>>;
    };
    expect(packageJson.version).toBe("0.3.2");
    expect(packageJson.scripts["studio:dev"]).toContain("go:cdp-adapter:build");
    expect(packageJson.scripts["go:verify"]).toContain("go:cdp-adapter:verify");
    expect(packageJson.scripts.runtime).toContain("host/go");
    expect(packageJson.scripts["release:build"]).toContain("build-go-release.ts");
    expect(packageJson.scripts["release:acceptance"]).toContain("accept-go-release.ts");
    expect(packageJson.scripts["release:merge"]).toContain("merge-go-release.ts");
    expect(packageJson.scripts["release:node"]).toBeUndefined();
  });

  it("keeps the checked-in Go adapter aligned with current surface rules", async () => {
    const manifest = JSON.parse(await readFile(
      "host/go/internal/cdp/generated/adapter-manifest.json",
      "utf8",
    )) as { readonly source?: string };
    expect(manifest.source).toContain("data-sonner-toast");
    expect(manifest.source).toContain("environment");
  });

  it("documents and publishes Node-free Go artifacts", async () => {
    const [workflow, readme, readmeEn] = await Promise.all([
      readFile(".github/workflows/release.yml", "utf8"),
      readFile("README.md", "utf8"),
      readFile("README.en.md", "utf8"),
    ]);
    for (const text of [workflow, readme, readmeEn]) {
      expect(text).not.toContain("release:node");
      expect(text).not.toContain("OpenChatGPTSkin.cmd");
    }
    expect(readme).toContain("OpenChatGPTSkin_0.3.2_windows_x64_Setup.exe");
    expect(readmeEn).toContain("OpenChatGPTSkin_0.3.2_windows_x64_Setup.exe");
    expect(workflow).toContain("npm run release:build -- --native-only");
  });

  it("removes the Node production hosts and release graph", async () => {
    for (const path of [
      "runtime/windows/package.json",
      "runtime/theme-studio-service/package.json",
      "scripts/release/payload.ts",
      "scripts/release/fetch-node-runtime.ts",
      ".github/workflows/go-host-spike.yml",
    ]) {
      await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const graph = await Promise.all([
      readFile("package.json", "utf8"), readFile("package-lock.json", "utf8"),
      readFile("tsconfig.json", "utf8"), readFile("vitest.config.ts", "utf8"),
    ]).then((documents) => documents.join("\n"));
    expect(graph).not.toContain("runtime/theme-studio-service");
    expect(graph).not.toContain("runtime/windows");
    expect(graph).not.toContain("@open-chatgpt-skin/windows-runtime");
  });
});
