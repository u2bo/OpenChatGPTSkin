import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("local Windows release command", () => {
  it("builds validated ZIP and Setup artifacts without touching personal data", async () => {
    const [packageJson, script, gitignore] = await Promise.all([
      readFile("package.json", "utf8").then(JSON.parse) as Promise<{
        readonly scripts: Readonly<Record<string, string>>;
      }>,
      readFile("scripts/release/build-windows-local.ps1", "utf8"),
      readFile(".gitignore", "utf8"),
    ]);

    expect(packageJson.scripts["release:windows"]).toBe(
      "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/build-windows-local.ps1",
    );
    for (const expected of [
      "'install', '--no-audit', '--no-fund'",
      "'ls' '--depth=0' '--silent'",
      "'release:version'",
      "'verify'",
      "'studio:build'",
      "'release:node'",
      "'release:stage'",
      "'release:acceptance'",
      "'release:package'",
      "'release:acceptance:archive'",
      "build-windows-installer.ps1",
      "'release:checksums'",
      "artifacts\\windows-x64",
      "https://github.com/jrsoftware/issrc/releases/download/is-6_7_1/innosetup-",
      "4D11E8050B6185E0D49BD9E8CC661A7A59F44959A621D31D11033124C4E8A7B0",
      "'/PORTABLE=1'",
      "$env:INNO_SETUP_COMPILER = Resolve-InnoSetupCompiler",
    ]) {
      expect(script).toContain(expected);
    }
    expect(script).not.toContain("accept-windows-installer.ps1");
    expect(script).toContain(
      "Existing dependencies are complete; skipping dependency installation.",
    );
    expect(script).toContain("Local build files were retained for diagnosis");
    expect(gitignore).toContain("artifacts/");
  });
});
