import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadThemeDirectory } from "@open-chatgpt-skin/theme-core";
import { parseThemeDocument } from "@open-chatgpt-skin/theme-schema";
import {
  applyExpression,
  assertRuntimeThemeSize,
  compileTheme,
  RUNTIME_MAX_COMPILED_THEME_BYTES,
} from "@open-chatgpt-skin/cdp-adapter";

const RUNTIME_THEME_IDS = [
  "future-idol-cyan",
  "rose-carpet-star",
  "mountain-mist",
  "glacier-aurora",
  "yua-mikami-starlight",
] as const;

function cssPercent(value: number): number {
  return Math.round(value * 10_000) / 100;
}

describe("compileTheme", () => {
  it("enforces the exact 8 MiB compiled-theme boundary", () => {
    expect(RUNTIME_MAX_COMPILED_THEME_BYTES).toBe(8 * 1024 * 1024);
    expect(() => assertRuntimeThemeSize(RUNTIME_MAX_COMPILED_THEME_BYTES))
      .not.toThrow();
    expect(() => assertRuntimeThemeSize(RUNTIME_MAX_COMPILED_THEME_BYTES + 1))
      .toThrow(expect.objectContaining({ code: "THEME_RUNTIME_TOO_LARGE" }));
  });

  it("compiles v4 welcome, display typography, and exact composition layers", async () => {
    const bundle = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
    const signaturePath = "assets/hero-signature.webp";
    const theme = parseThemeDocument({
      ...bundle.theme,
      assets: {
        ...bundle.theme.assets,
        decorations: {
          ...bundle.theme.assets.decorations,
          "hero-signature": signaturePath,
        },
      },
      typography: {
        ...bundle.theme.typography,
        displayFamily: "Noto Serif SC",
        displaySize: 42,
        displayWeight: 500,
        displayLineHeight: 1.45,
        displayLetterSpacing: 0.04,
      },
      home: {
        welcome: {
          localized: {
            "zh-CN": {
              lines: ["在「{projectName}」中，", "你想一起打造什么呢？"],
            },
          },
          layout: {
            anchor: "top-left",
            positionX: 0.06,
            positionY: 0.46,
            width: 0.76,
            textAlign: "left",
            hideNativeIcon: true,
          },
        },
      },
      composition: {
        layers: [{
          id: "hero-signature",
          asset: { kind: "decoration", assetKey: "hero-signature" },
          surface: "home-hero",
          anchor: "top-left",
          positionX: 0.1,
          positionY: 0.08,
          width: 0.22,
          opacity: 1,
          rotation: 0,
          required: true,
        }],
      },
    });
    const compiled = compileTheme({
      ...bundle,
      theme,
      files: new Map([
        ...bundle.files,
        [signaturePath, bundle.files.get(bundle.theme.assets.background!)!],
      ]),
    });

    expect(compiled.welcome?.localized["zh-CN"]).toEqual([
      [
        { kind: "text", value: "在「" },
        { kind: "projectName" },
        { kind: "text", value: "」中，" },
      ],
      [{ kind: "text", value: "你想一起打造什么呢？" }],
    ]);
    expect(compiled.welcome).toMatchObject({
      displayFamily: "Noto Serif SC",
      displaySizePx: 42,
      displayWeight: 500,
      displayLineHeight: 1.45,
      displayLetterSpacingEm: 0.04,
      layout: {
        anchor: "top-left",
        positionXPercent: 6,
        positionYPercent: 46,
        widthPercent: 76,
        textAlign: "left",
        hideNativeIcon: true,
      },
    });
    expect(compiled.compositionLayers[0]).toMatchObject({
      id: "hero-signature",
      surface: "home-hero",
      required: true,
    });
    const layerAsset = compiled.compositionLayers[0]?.asset;
    expect(layerAsset).toBeTypeOf("number");
    expect(compiled.assetDataUrls[layerAsset!]).toMatch(/^data:image\/webp;base64,/);
    expect(compiled.totalBytes).toBe(Buffer.byteLength(JSON.stringify(compiled)));
  });

  it.each(RUNTIME_THEME_IDS)("compiles %s within the fixed Runtime limit", async (themeId) => {
    const bundle = await loadThemeDirectory(
      resolve("themes", "builtin", themeId),
    );
    const compiled = compileTheme(bundle);
    expect(compiled).toMatchObject({
      themeId,
      themeVersion: bundle.theme.version,
    });
    expect(compiled.backgroundDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(compiled.themeCss).toContain("var(--ocs-background-image)");
    expect(compiled.totalBytes).toBeLessThanOrEqual(RUNTIME_MAX_COMPILED_THEME_BYTES);
  });

  it("deduplicates shared background and custom interface imagery", async () => {
    const bundle = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
    const backgroundPath = bundle.theme.assets.background!;
    const customPath = "assets/custom-interface.webp";
    const background = bundle.files.get(backgroundPath)!;
    const compiled = compileTheme({
      ...bundle,
      theme: {
        ...bundle.theme,
        assets: {
          ...bundle.theme.assets,
          profileAvatar: backgroundPath,
          suggestionIcons: {
            card1: backgroundPath,
            card2: customPath,
            card3: customPath,
            card4: backgroundPath,
          },
          projectIcons: [customPath, backgroundPath],
        },
      },
      files: new Map([...bundle.files, [customPath, background]]),
    });

    expect(compiled.assetDataUrls).toHaveLength(1);
    expect(compiled.interfaceImagery.profileAvatar).toEqual({
      asset: "background",
      positionXPercent: 50,
      positionYPercent: 35,
      sizePx: 24,
    });
    expect(compiled.interfaceImagery.suggestionIcons).toMatchObject({
      card1: { asset: "background", positionXPercent: 20, positionYPercent: 25 },
      card2: { asset: 0, positionXPercent: 50, positionYPercent: 50 },
      card3: { asset: 0, positionXPercent: 50, positionYPercent: 50 },
      card4: { asset: "background", positionXPercent: 80, positionYPercent: 75 },
    });
    expect(compiled.interfaceImagery.projectIcons).toEqual([
      { asset: 0, positionXPercent: 50, positionYPercent: 50, sizePx: 16 },
      { asset: "background", positionXPercent: 50, positionYPercent: 50, sizePx: 16 },
    ]);
  });

  it("compiles mountain-mist into fixed CSS and bounded data resources", async () => {
    const bundle = await loadThemeDirectory(
      resolve("themes/builtin/mountain-mist"),
    );
    const compiled = compileTheme(bundle);
    expect(compiled).toMatchObject({
      themeId: "mountain-mist",
      themeVersion: bundle.theme.version,
    });
    expect(compiled.themeCss).toContain(`--ocs-accent:${bundle.theme.colors.accent}`);
    expect(compiled.themeCss).toContain("--ocs-card-columns:4");
    expect(compiled.themeCss).toContain("--ocs-hero-height:380px");
    expect(compiled.themeCss).toContain("--ocs-home-overlap-relief:0px");
    expect(compiled.themeCss).toContain(
      `--ocs-task-panel-mix:${cssPercent(bundle.theme.background.taskOpacity)}%`,
    );
    expect(compiled.themeCss).toContain(
      `--ocs-elevated-panel-mix:${cssPercent(bundle.theme.surfaces.elevatedOpacity)}%`,
    );
    expect(compiled.themeCss).toContain(
      `--ocs-terminal-panel-mix:${cssPercent(bundle.theme.surfaces.terminalOpacity)}%`,
    );
    expect(compiled.themeCss).toContain(
      `--ocs-surface-blur:${bundle.theme.surfaces.blur}px`,
    );
    expect(compiled.themeCss).toContain(
      `color-scheme:${bundle.theme.appearance}!important`,
    );
    expect(compiled.themeCss).toContain(
      `--ocs-color-scheme:${bundle.theme.appearance}`,
    );
    expect(compiled.themeCss).toContain(
      'body::after{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;background:rgba(0,0,0,0);}',
    );
    expect(compiled.themeCss).not.toContain("background:rgba(255,255,255,");
    expect(compiled.themeCss).not.toContain(
      "nav,aside,[role=navigation],main,[role=main]",
    );
    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="sidebar"]{order:',
    );
    expect(compiled.themeCss).not.toMatch(/(?:^|[;{])order:/);
    expect(compiled.themeCss).not.toContain("max-width:92%!important");
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="composer-input"]',
    );
    expect(compiled.themeCss).toContain(
      "color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)",
    );
    expect(compiled.themeCss).not.toContain("#2c2c2c");
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="topbar"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="top-fade"]{background:transparent!important;',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="composer-input"] *{color:inherit!important;}',
    );
    expect(compiled.themeCss).not.toContain(
      'border-radius:14px!important;box-shadow:none!important;',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="composer-input"] [data-placeholder]::after',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="composer"] :where([role=alert]){color:var(--ocs-danger)!important;}',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="composer"] :where([role=status]){color:var(--ocs-info)!important;}',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="composer"] :where(button:disabled,[role=button][aria-disabled=true]){color:var(--ocs-muted)!important;}',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="status-banner"] :is([class*="bg-token-input-background"],[class*="bg-token-main-surface"],[class*="bg-token-elevated-surface"]){background:transparent!important;',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="status-banner"] :where(button,[role=button]){color:var(--ocs-text)!important;background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-surface-panel-mix),transparent)!important;',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="status-banner"] :where(button,[role=button])[class~="bg-token-foreground"]{color:var(--ocs-panel)!important;background-color:var(--ocs-accent)!important;',
    );
    expect(compiled.themeCss).toContain(
      "min-height:max(180px,calc(min(var(--ocs-hero-height),45vh) - var(--ocs-home-overlap-relief)))",
    );
    expect(compiled.themeCss).toContain("grid-auto-rows:1fr!important;");
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="card"]{width:100%!important;',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="main"] :where(h1,h2,h3',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="task"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="workspace-panel"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="workspace-panel"]{color:var(--ocs-text)!important;background:transparent!important;',
    );
    expect(compiled.themeCss).toContain('.file-tree-container,file-tree-container');
    expect(compiled.themeCss).toContain('.codex-review-diff-card');
    expect(compiled.themeCss).toContain('.diffs-container,diffs-container');
    expect(compiled.themeCss).toContain('[class*="app-shell-tab-background"]');
    expect(compiled.themeCss).toContain(
      '[class*="sticky"][class*="backdrop-blur"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="resource-card"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="settings"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="settings-panel"]',
    );
    expect(compiled.themeCss).toContain(".text-token-text-primary");
    expect(compiled.themeCss).toContain(".text-token-text-secondary");
    expect(compiled.themeCss).toContain(".text-token-input-foreground");
    expect(compiled.themeCss).toContain('[class*="bg-token-main-surface"]');
    expect(compiled.themeCss).toContain('[class*="bg-token-text-link-foreground"]');
    expect(compiled.themeCss).toContain(
      "background-color:var(--ocs-accent)!important;color:white!important;",
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="overlay"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="overlay"] :is(.composer-surface-chrome',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="workspace-panel"] :is(.text-token-foreground',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="sidebar"] :is(.text-token-foreground',
    );
    expect(compiled.themeCss).toContain(
      '@layer base{[data-open-chatgpt-skin-surface="sidebar"] :is([class*="text-token-input-placeholder-foreground"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="task"] :where(th,td)',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="terminal"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="task"] :is([class*="text-token-description-foreground"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="composer-chrome"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="scroll-fade"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="mode-switcher-track"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="mode-switcher-selection"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="feature-page"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="feature-toolbar"]',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="feature-search"]',
    );
    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="project-picker"]{margin-bottom:16px!important;',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="project-picker-stack"]{overflow:hidden!important;pointer-events:none!important;}',
    );
    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="project-picker-stack"]{z-index:',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="project-picker-stack"] :is(button,[role=button],[role=group],a,input,select){pointer-events:auto!important;}',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="project-picker"]{color:var(--ocs-text)!important;',
    );
    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="project-picker"]{position:',
    );
    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="main"]{gap:var(--ocs-module-gap)!important;}',
    );
    expect(compiled.themeCss).toContain(
      '[data-open-chatgpt-skin-surface="main"]{backdrop-filter:none!important;',
    );
    expect(compiled.themeCss).not.toContain('border-radius:14px!important;');
    expect(compiled.themeCss).toContain(".text-token-conversation-body");
    expect(compiled.themeCss).toContain('[class*="_markdownContent_"]');
    expect(compiled.themeCss).toContain('[class*="_markdownText_"]');
    expect(compiled.themeCss).toContain('[class*="bg-token-text-code-block-background"]');
    expect(compiled.themeCss).toContain("box-shadow:none!important");
    expect(compiled.layout).toMatchObject({
      heroHeight: 380,
      cardColumns: 4,
      composerWidth: 0.74,
      sidebarDensity: "comfortable",
    });
    const expression = applyExpression(compiled);
    expect(expression).toContain("openChatgptSkinSurface");
    expect(expression).toContain("__openChatgptSkinShadowSheets");
    expect(expression).toContain("[data-line-type=\\\"context\\\"]");
    expect(expression).toContain("[data-separator-content]");
    expect(expression).toContain("[data-line-type=\\\"change-addition\\\"]");
    expect(expression).toContain("[data-file-tree-virtualized-list]");
    expect(expression).toContain("__openChatgptSkinSurfaceObserver");
    expect(expression).toContain("new window.MutationObserver");
    expect(expression).toContain("composer-surface-chrome");
    expect(compiled.themeCss).toContain("font-weight:500!important");
    expect(compiled.themeCss).toContain("font-weight:400!important");
    expect(compiled.backgroundDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(compiled.themeCss).not.toContain("data:image/webp;base64,");
    expect(compiled.themeCss).not.toContain("<script");
    expect(compiled.totalBytes).toBeLessThanOrEqual(RUNTIME_MAX_COMPILED_THEME_BYTES);
    expect(compiled.decorations).toEqual([
      expect.objectContaining({ kind: "particles", count: 5 }),
    ]);
    expect(compiled.totalBytes).toBe(Buffer.byteLength(JSON.stringify(compiled)));
  });

  it("ignores project picker geometry from imported theme layout values", async () => {
    const bundle = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
    const customized = {
      ...bundle,
      theme: {
        ...bundle.theme,
        layout: {
          ...bundle.theme.layout,
          modules: bundle.theme.layout.modules.map((module) => module.id === "project-picker"
            ? { ...module, size: "compact" as const, align: "center" as const, spacing: 48 }
            : module),
        },
      },
    };

    const compiled = compileTheme(customized);

    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="project-picker"]{margin-bottom:',
    );
    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="project-picker"]{max-width:',
    );
    expect(compiled.themeCss).not.toContain(
      '[data-open-chatgpt-skin-surface="project-picker"]{margin-inline:',
    );
  });

  it("escapes font-family values before inserting them into CSS", async () => {
    const bundle = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
    const compiled = compileTheme({
      ...bundle,
      theme: {
        ...bundle.theme,
        typography: { ...bundle.theme.typography, uiFamily: "Safe\";color:red;/*" },
      },
    });
    expect(compiled.themeCss).not.toContain('font-family:"Safe";color:red');
    expect(compiled.themeCss).toContain('font-family:"Safe\\\";color:red;/*"');
  });

  it("omits enabled decorations whose intensity is zero", async () => {
    const bundle = await loadThemeDirectory(resolve("themes/builtin/mountain-mist"));
    const compiled = compileTheme({
      ...bundle,
      theme: {
        ...bundle.theme,
        decorations: bundle.theme.decorations.map((decoration) => ({
          ...decoration,
          intensity: 0,
        })),
      },
    });
    expect(compiled.decorations).toEqual([]);
  });
});
