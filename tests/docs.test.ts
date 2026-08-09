import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("project documentation", () => {
  it("does not publish links to local-only design artifacts", async () => {
    for (const readme of await Promise.all([readFile("README.md", "utf8"), readFile("README.en.md", "utf8")])) {
      expect(readme).not.toMatch(/docs\/superpowers\/|docs\/assets\/design-qa\/|design-qa\.md/);
    }
  });

  it("documents format limits, rights, and all eight catalog IDs", async () => {
    const format = await readFile("docs/theme-format.md", "utf8");
    for (const required of [
      ".ocskin", "50 MB", "32 MB", "16 MB", "5 MB", "localOnly", "manifest.json",
      "sidebar", "topbar", "composer", "content-layer", "future-idol-cyan", "rose-carpet-star",
      "mountain-mist", "glacier-aurora", "goku-saiyan-engine", "hoshimiya-ichigo-shining-stage",
      "tibo-cyber-core", "yua-mikami-starlight",
    ]) {
      expect(format).toContain(required);
    }
    expect(format).not.toContain("hatsune-miku-local");
    expect(format).not.toContain("dilraba-local");
  });

  it("documents the v0.4.2 theme release and retains the v0.4.1 Theme CLI history", async () => {
    const [readme, readmeEn, notes, previousNotes, windows, mac, macEn, studio] = await Promise.all([
      readFile("README.md", "utf8"), readFile("README.en.md", "utf8"),
      readFile("docs/releases/v0.4.2.md", "utf8"), readFile("docs/releases/v0.4.1.md", "utf8"),
      readFile("docs/runtime-windows.md", "utf8"),
      readFile("docs/runtime-macos.md", "utf8"), readFile("docs/runtime-macos.en.md", "utf8"),
      readFile("docs/theme-studio.md", "utf8"),
    ]);
    for (const document of [readme, readmeEn]) {
      expect(document).toContain("v0.4.2");
      expect(document).toContain("OpenChatGPTSkin_0.4.2_windows_x64_Setup.exe");
      expect(document).toContain("OpenChatGPTSkin_0.4.2_macos_arm64.dmg");
      expect(document).toContain("OpenChatGPTSkin_0.4.2_macos_x64.dmg");
      expect(document).toContain("npm run runtime -- list-themes");
      expect(document).toContain("OpenChatGPTSkin.exe theme help");
      expect(document).toContain("npm run runtime -- import --theme-file");
      expect(document).toContain("npm run runtime -- restore");
      expect(document).not.toContain("npm run runtime:probe");
      expect(document).not.toContain("npm run runtime:acceptance");
      expect(document).not.toContain("OpenChatGPTSkin.cmd");
    }
    expect(`${windows}\n${mac}\n${macEn}`).not.toContain("@open-chatgpt-skin/windows-runtime");
    expect(windows).toContain("release-manifest.json");
    expect(windows).toContain("OpenChatGPTSkin.exe theme help");
    expect(mac).toContain("OpenChatGPTSkin theme help");
    expect(macEn).toContain("OpenChatGPTSkin theme help");
    expect(windows).toContain("Node/Go 双写");
    expect(mac).toContain("八主题结果");
    expect(macEn).toContain("eight-theme results");
    expect(studio).toContain("单一 Go Host");
    expect(studio).toContain("OpenChatGPTSkin.exe");
    expect(notes).toContain("Tibo·赛博智核");
    expect(notes).toContain("tibo-cyber-core");
    expect(notes).toContain("八个内置主题");
    expect(notes).toContain("OpenChatGPTSkin_0.4.2_windows_x64_Setup.exe");
    expect(notes).toContain("Get-FileHash");
    expect(notes).toContain("shasum -a 256");
    expect(previousNotes).toContain("Theme CLI Contract");
    expect(previousNotes).toContain("theme contract");
    expect(previousNotes).toContain("不新增或变更社区主题目录");
    expect(previousNotes).toContain("OpenAI.Codex 26.721.4979.0");
  });

  it("ships bilingual agent guidance and executable Theme CLI workflows", async () => {
    const [guide, guideEn, patch, powershell, shell] = await Promise.all([
      readFile("docs/theme-cli-agent-guide.md", "utf8"),
      readFile("docs/theme-cli-agent-guide.en.md", "utf8"),
      readFile("examples/theme-cli/theme-patch.json", "utf8"),
      readFile("examples/theme-cli/agent-workflow.ps1", "utf8"),
      readFile("examples/theme-cli/agent-workflow.sh", "utf8"),
    ]);

    expect(JSON.parse(patch)).toEqual({
      description: "Configured by an agent through the native Theme CLI",
      colors: { accent: "#7c3aed" },
      background: { overlay: 0.45 },
    });
    for (const document of [guide, guideEn]) {
      for (const required of [
        "theme contract", "theme create", "theme config", "theme show", "theme validate",
        "theme pack", "theme unpack", "protocolVersion", "stdout", "stderr", "Node.js",
        "theme:agent-acceptance", "--executable", "CLI_ARGUMENT_INVALID", "CLI_READ",
        "CLI_WRITE", "THEME_SCHEMA_INVALID",
      ]) expect(document).toContain(required);
    }
    expect(guide).toContain("退出码 0 / 1 / 2");
    expect(guide).toContain("仓库维护者");
    expect(guide).toContain("发布应用本身仍不依赖 Node.js");
    expect(guideEn).toContain("exit codes 0 / 1 / 2");
    expect(guideEn).toContain("repository maintainer");
    expect(guideEn).toContain("released application itself remains Node-free");
    for (const document of [guide, guideEn]) {
      expect(document).toContain('"D:\\Apps\\OpenChatGPTSkin\\OpenChatGPTSkin.exe"');
      expect(document).toContain('"/Applications/OpenChatGPTSkin.app/Contents/MacOS/OpenChatGPTSkin"');
    }
    for (const script of [powershell, shell]) {
      for (const command of ["contract", "create", "config", "show", "validate", "pack", "unpack"]) {
        expect(script).toContain(`theme ${command}`);
      }
    }
    expect(powershell).not.toContain("Remove-Item");
    expect(shell).not.toMatch(/\brm\b/);
  });

  it("ships bilingual custom-theme guidance, contribution rules, and screenshots", async () => {
    const [readme, readmeEn, guide, guideEn, contributing, license] = await Promise.all([
      readFile("README.md", "utf8"), readFile("README.en.md", "utf8"),
      readFile("docs/custom-theme-guide.md", "utf8"), readFile("docs/custom-theme-guide.en.md", "utf8"),
      readFile("CONTRIBUTING.md", "utf8"), readFile("LICENSE", "utf8"),
    ]);
    for (const required of [
      "README.en.md", "docs/custom-theme-guide.md", "docs/assets/screenshots/theme-studio.webp",
      "docs/assets/screenshots/index1.webp", "docs/assets/screenshots/index2.webp",
      "docs/assets/screenshots/hoshimiya-ichigo-shining-stage-real.png",
      "docs/assets/screenshots/goku-saiyan-engine-real.png",
      "docs/assets/screenshots/tibo-cyber-core.webp",
      "CONTRIBUTING.md", "MIT License",
    ]) expect(readme).toContain(required);
    expect(readme).not.toContain("docs/assets/concepts/ichigo-hoshimiya.png");
    expect(readme).not.toContain("docs/assets/concepts/super-saiyan-goku.png");
    expect(readmeEn).toContain("README.md");
    for (const document of [readme, readmeEn]) {
      expect(document.indexOf("hoshimiya-ichigo-shining-stage")).toBeLessThan(
        document.indexOf("yua-mikami-starlight"),
      );
    }
    expect(readme).toContain("https://linux.do/");
    expect(readmeEn).toContain("https://linux.do/");
    expect(readme).toContain("[![Release v0.4.2]");
    expect(readmeEn).toContain("[![Release v0.4.2]");
    expect(readme).toContain("https://u2bo.github.io/OpenChatGPTSkin-Community/zh-CN/themes");
    expect(readme).toContain("https://u2bo.github.io/OpenChatGPTSkin-Community/zh-CN/submit");
    expect(readmeEn).toContain("https://u2bo.github.io/OpenChatGPTSkin-Community/en/themes");
    expect(readmeEn).toContain("https://u2bo.github.io/OpenChatGPTSkin-Community/en/submit");
    expect(guide).toContain("Theme Schema v4");
    expect(guideEn).toContain("Copy-ready packaging prompt");
    for (const required of [
      "{projectName}", "profile-avatar.webp", "suggestion-card1.webp", "project-icon1.webp",
      "display.woff2", "themes/builtin/yua-mikami-starlight/theme.json",
      "viewport/main/home-hero/suggestions", "future-idol-cyan",
      "goku-saiyan-engine", "hoshimiya-ichigo-shining-stage", "tibo-cyber-core",
      "yua-mikami-starlight",
    ]) {
      expect(guide).toContain(required);
      expect(guideEn).toContain(required);
    }
    expect(contributing).toContain("workflow_dispatch");
    expect(contributing).toContain("UI surface changes must include deterministic HTML fixtures/tests");
    expect(license).toContain("Asset notice");

    for (const name of [
      "theme-studio.webp", "index1.webp", "index2.webp", "future-idol-cyan.webp",
      "rose-carpet-star.webp", "mountain-mist.webp", "glacier-aurora.webp",
      "goku-saiyan-engine.webp",
      "goku-saiyan-engine-real.png",
      "hoshimiya-ichigo-shining-stage.webp", "hoshimiya-ichigo-shining-stage-real.png",
      "tibo-cyber-core.webp",
      "yua-mikami-starlight.webp",
      "surface-chatgpt-work.webp", "surface-plugins.webp", "surface-settings.webp",
    ]) {
      const info = await stat(`docs/assets/screenshots/${name}`);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(info.size).toBeLessThan(6_000_000);
    }
  });

  it("states unsigned macOS limits and requires real-device revalidation", async () => {
    const [readme, readmeEn, mac, macEn] = await Promise.all([
      readFile("README.md", "utf8"), readFile("README.en.md", "utf8"),
      readFile("docs/runtime-macos.md", "utf8"), readFile("docs/runtime-macos.en.md", "utf8"),
    ]);
    expect(readme).toContain("未签名开发者预览");
    expect(readmeEn).toContain("unsigned developer preview");
    expect(mac).toContain("Codex 升级后必须重新执行本清单");
    expect(macEn).toContain("Repeat this checklist after every Codex update");
    expect(mac).toContain("~/Library/Application Support/OpenChatGPTSkin");
    expect(macEn).toContain("Control-click");
  });
});
