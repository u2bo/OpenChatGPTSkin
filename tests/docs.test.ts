import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("project documentation", () => {
  it("does not publish links to local-only design artifacts", async () => {
    const readmes = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("README.en.md", "utf8"),
    ]);

    for (const readme of readmes) {
      expect(readme).not.toMatch(
        /docs\/superpowers\/|docs\/assets\/design-qa\/|design-qa\.md/,
      );
    }
  });

  it("documents format limits, rights, and all catalog IDs", async () => {
    const [readme, text] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("docs/theme-format.md", "utf8"),
    ]);

    for (const required of [
      ".ocskin",
      "50 MB",
      "32 MB",
      "16 MB",
      "5 MB",
      "localOnly",
      "manifest.json",
      "sidebar",
      "topbar",
      "composer",
      "content-layer",
      "future-idol-cyan",
      "rose-carpet-star",
      "mountain-mist",
      "glacier-aurora",
    ]) {
      expect(text).toContain(required);
    }
    expect(readme).toContain("Windows 开发者预览版");
    expect(readme).toContain("当前 Runtime 能识别的全部 Codex UI 表面");
    expect(readme).toContain("npm run verify:foundation");
    expect(text).not.toContain("hatsune-miku-local");
    expect(text).not.toContain("dilraba-local");
    expect(readme).not.toContain("初音未来或迪丽热巴");
    expect(readme).toContain("npm run runtime:probe -- --record-evidence");
    expect(readme).toContain("npm run runtime:probe -- --finalize");
    expect(readme).toContain("不会强制结束已有 Codex");
  });

  it("documents the Windows compatibility gate without overstating runtime availability", async () => {
    const [readme, runtime, evidenceRaw] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("docs/runtime-windows.md", "utf8"),
      readFile("docs/runtime-probes/codex-26.707.12708.0.json", "utf8"),
    ]);
    const documented = `${readme}\n${runtime}`;

    for (const required of [
      "Windows 兼容性门已通过",
      "npm run runtime -- list-themes",
      "npm run runtime -- launch --theme mountain-mist",
      "npm run runtime -- switch --theme glacier-aurora",
      "npm run runtime -- import --theme-file",
      "npm run runtime -- pause",
      "npm run runtime -- resume",
      "npm run runtime -- restore",
      "npm run runtime:acceptance -- --begin",
      "npm run runtime:acceptance -- --finalize",
      "future-idol-cyan",
      "rose-carpet-star",
      "mountain-mist",
      "glacier-aurora",
      "npm run runtime:probe -- --record-evidence",
      "npm run runtime:probe -- --finalize",
      "127.0.0.1",
      "不会修改 WindowsApps、`app.asar`",
      "不要使用任务管理器强制结束",
      "Theme Studio 完整本地闭环",
      "Windows x64 便携 ZIP 与用户级 Setup",
    ]) {
      expect(documented).toContain(required);
    }
    const evidence = JSON.parse(evidenceRaw) as Record<string, unknown>;
    expect(evidence).toMatchObject({
      schemaVersion: 2,
      packageIdentity: "OpenAI.Codex",
      markerRoundTrip: true,
      loopbackOnly: true,
      managedExitVerified: true,
      cdpClosedVerified: true,
    });
    expect(JSON.stringify(evidence)).not.toMatch(
      /127\.0\.0\.1|Program Files|Users|ws:\/\/|project|title|text|pid|port/i,
    );
  });

  it("documents the delivered Theme Studio editing and Runtime application closure", async () => {
    const [readme, studio] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("docs/theme-studio.md", "utf8"),
    ]);

    expect(readme).toContain("docs/theme-studio.md");
    expect(studio).toContain("npm run studio:dev");
    expect(studio).toContain("创建草稿 → 隔离预览 → 校验 → 保存不可变版本 → 导入导出 → 应用到真实 Codex");
    expect(studio).toContain("完整语义字体颜色");
    expect(studio).toContain("精确 `{id, version}` Runtime 应用");
    expect(studio).toContain("首页与任务工作区双视图预览");
    expect(studio).toContain("真实 Codex 会持续识别首页、任务路由、设置页、工作台面板、终端、应用菜单和弹层");
    expect(studio).toContain("刷新或重启 Studio 后自动打开最近草稿");
    expect(studio).toContain("点击主题后会立即加载并在成功后自动切换到编辑工具");
    expect(studio).toContain("取消则保持主题库不变");
    expect(studio).toContain("只有点击“保存版本”才会写入个人主题版本");
    expect(studio).toContain("加载已有草稿或覆盖现有草稿");
    expect(studio).toContain("单版本或整个个人主题删除");
  });

  it("ships bilingual release documentation, custom-theme prompts, and screenshots", async () => {
    const [readme, readmeEn, guide, guideEn, contributing, license, macRuntime, macRuntimeEn, releaseNotes] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("README.en.md", "utf8"),
      readFile("docs/custom-theme-guide.md", "utf8"),
      readFile("docs/custom-theme-guide.en.md", "utf8"),
      readFile("CONTRIBUTING.md", "utf8"),
      readFile("LICENSE", "utf8"),
      readFile("docs/runtime-macos.md", "utf8"),
      readFile("docs/runtime-macos.en.md", "utf8"),
      readFile("docs/releases/v0.1.0-alpha.1.md", "utf8"),
    ]);

    for (const required of [
      "README.en.md",
      "status-alpha",
      "docs/custom-theme-guide.md",
      "docs/assets/screenshots/theme-studio.webp",
      "docs/assets/screenshots/index1.webp",
      "docs/assets/screenshots/index2.webp",
      "CONTRIBUTING.md",
      "MIT License",
    ]) {
      expect(readme).toContain(required);
    }
    expect(readmeEn).toContain("README.md");
    expect(readme).toContain("[![LINUX DO 社区]");
    expect(readmeEn).toContain("[![LINUX DO Community]");
    expect(readme).toContain("https://linux.do/");
    expect(readmeEn).toContain("https://linux.do/");
    expect(readme).toContain("# OpenChatGPTSkin");
    expect(readmeEn).toContain("# OpenChatGPTSkin");
    expect(contributing).toContain("OpenChatGPTSkin");
    expect(guide).toContain("OpenChatGPTSkin 自定义主题指南");
    expect(guideEn).toContain("OpenChatGPTSkin Custom Theme Guide");
    expect(readmeEn).toContain("docs/custom-theme-guide.en.md");
    expect(readme).toContain("docs/runtime-macos.md");
    expect(readmeEn).toContain("docs/runtime-macos.en.md");
    expect(guide).toContain("可复制的 AI 封装提示词");
    expect(guide).toContain("Theme Schema v2");
    expect(guide).toContain("npm run runtime -- import --theme-file");
    expect(guideEn).toContain("Copy-ready packaging prompt");
    expect(contributing).toContain("UI surface 适配必须包含确定性的 HTML fixture/测试");
    expect(contributing).toContain("UI surface changes must include deterministic HTML fixtures/tests");
    expect(license).toContain("Asset notice");
    expect(macRuntime).toContain("/Applications/Codex.app/Contents/Resources/codex --version");
    expect(macRuntime).toContain("当前 UID、权限 `0600` 的 Unix socket");
    expect(macRuntime).toContain("尚未在真实 Mac 上完成 Codex 视觉闭环验收");
    expect(macRuntimeEn).toContain("real Mac");
    expect(macRuntimeEn).toContain("RUNTIME_ENVIRONMENT_INVALID");
    expect(readme).toContain("OpenChatGPTSkin_0.1.0-alpha.1_windows_x64_Setup.exe");
    expect(readme).toContain("checksums.txt");
    expect(readme).toContain("SmartScreen");
    expect(readme).toContain("默认保留个人主题");
    expect(readmeEn).toContain("Windows x64 portable ZIP");
    expect(releaseNotes).toContain("Windows x64");
    expect(releaseNotes).toContain("SHA-256");
    expect(releaseNotes).toContain("SmartScreen");
    expect(releaseNotes).toContain("macOS");
    expect(releaseNotes).toContain("English");

    for (const name of [
      "theme-studio.webp",
      "index1.webp",
      "index2.webp",
      "future-idol-cyan.webp",
      "rose-carpet-star.webp",
      "mountain-mist.webp",
      "glacier-aurora.webp",
      "surface-chatgpt-work.webp",
      "surface-plugins.webp",
      "surface-settings.webp",
    ]) {
      const info = await stat(`docs/assets/screenshots/${name}`);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(0);
      expect(info.size).toBeLessThan(500_000);
    }
  });
});
