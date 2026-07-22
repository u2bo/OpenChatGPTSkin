import type { ValidatedThemeBundle } from "@open-chatgpt-skin/theme-core";
import {
  createSafeAreaOverlayCss,
  createTaskSurfaceBackgroundCss,
  createThemeVisualModel,
  NATIVE_GEOMETRY_MODULE_IDS,
  type ThemeLayoutModule,
  type ThemeInterfaceImageVisual,
} from "@open-chatgpt-skin/theme-schema";
import { RuntimeThemeError } from "./errors.js";
import { surfaceSelector } from "./surface-contract.js";
import type {
  CompiledCompositionLayer,
  CompiledDecoration,
  CompiledInterfaceImage,
  CompiledTheme,
} from "./types.js";

export const RUNTIME_MAX_COMPILED_THEME_BYTES = 8 * 1024 * 1024;

export function assertRuntimeThemeSize(totalBytes: number): void {
  if (totalBytes > RUNTIME_MAX_COMPILED_THEME_BYTES) {
    throw new RuntimeThemeError(
      "THEME_RUNTIME_TOO_LARGE",
      "compiled theme exceeds 8 MiB",
    );
  }
}

function withMeasuredBytes(base: Omit<CompiledTheme, "totalBytes">): CompiledTheme {
  let totalBytes = 0;
  for (;;) {
    const candidate = { ...base, totalBytes };
    const measured = Buffer.byteLength(JSON.stringify(candidate));
    if (measured === totalBytes) return candidate;
    totalBytes = measured;
  }
}

function cssString(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\d ")
    .replaceAll("\n", "\\a ")}"`;
}

function mime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".woff2")) return "font/woff2";
  throw new RuntimeThemeError("ASSET_UNSUPPORTED", `unsupported runtime asset: ${path}`);
}

function dataUrl(path: string, bytes: Uint8Array): string {
  return `data:${mime(path)};base64,${Buffer.from(bytes).toString("base64")}`;
}

function compileDecorations(
  bundle: ValidatedThemeBundle,
  imageAsset: (path: string) => number,
): CompiledDecoration[] {
  const theme = bundle.theme;
  const decorations = theme.decorations
    .filter((item) => item.enabled)
    .map((item) => {
      let asset: number | undefined;
      if (item.assetKey) {
        const path = theme.assets.decorations?.[item.assetKey];
        if (!path) throw new RuntimeThemeError("ASSET_MISSING", item.assetKey);
        asset = imageAsset(path);
      }
      return {
        kind: item.type,
        count: Math.round(item.intensity * 24),
        opacity: item.opacity ?? Math.min(0.5, 0.12 + item.intensity * 0.3),
        scale: item.scale ?? 1,
        placement: item.placement ?? "background",
        ...(asset !== undefined ? { asset } : {}),
      };
    })
    .filter((item) => item.count > 0);
  const portraitPath = theme.assets.portrait;
  if (portraitPath) {
    decorations.unshift({
      kind: "image",
      count: 1,
      opacity: 0.92,
      scale: 1.4,
      placement: "hero",
      asset: imageAsset(portraitPath),
    });
  }
  return decorations;
}

function moduleAlignmentCss(module: ThemeLayoutModule): string {
  if (module.align === "center") return "margin-inline:auto!important;";
  if (module.align === "end") return "margin-left:auto!important;";
  if (module.align === "stretch") return "";
  return "margin-right:auto!important;";
}

function moduleSizeCss(module: ThemeLayoutModule): string {
  if (module.size === "compact") return "max-width:78%!important;";
  if (module.size === "expanded") return "max-width:100%!important;";
  return "";
}

function compileModuleCss(modules: readonly ThemeLayoutModule[]): string {
  return modules.map((module) => {
    if (NATIVE_GEOMETRY_MODULE_IDS.some((id) => id === module.id)) return "";
    if (module.id === "sidebar" || module.id === "topbar" ||
      module.id === "task-background" || module.id === "content-layer") return "";
    const selector = `[data-open-chatgpt-skin-surface="${module.id}"]`;
    if (!module.visible) return `${selector}{display:none!important;}`;
    const rules = `margin-bottom:${module.spacing}px!important;` +
      `${moduleAlignmentCss(module)}${moduleSizeCss(module)}`;
    return rules ? `${selector}{${rules}}` : "";
  }).join("");
}

function descendantSelector(
  surfaces: readonly string[],
  descendants: string,
  pseudo: "where" | "is" = "where",
): string {
  return surfaces.map((surface) => `${surface} :${pseudo}(${descendants})`).join(",");
}

export function compileTheme(bundle: ValidatedThemeBundle): CompiledTheme {
  const backgroundPath = bundle.theme.assets.background;
  if (bundle.theme.kind !== "theme" || !backgroundPath) {
    throw new RuntimeThemeError("THEME_RUNTIME_UNSUPPORTED", "runtime requires a complete theme");
  }

  const theme = bundle.theme;
  const visual = createThemeVisualModel(theme);
  const assetDataUrls: string[] = [];
  const assetIndexes = new Map<string, number>();
  const imageDataUrl = (path: string): string => {
    const bytes = bundle.files.get(path);
    if (!bytes) throw new RuntimeThemeError("ASSET_MISSING", path);
    return dataUrl(path, bytes);
  };
  const imageAsset = (path: string): number => {
    const cached = assetIndexes.get(path);
    if (cached !== undefined) return cached;
    const index = assetDataUrls.length;
    assetIndexes.set(path, index);
    assetDataUrls.push(imageDataUrl(path));
    return index;
  };
  const safeAreaOverlay = createSafeAreaOverlayCss(
    visual.background.safeArea,
    visual.background.overlayColor,
    "var(--ocs-panel)",
  );
  const taskSurfaceBackground = createTaskSurfaceBackgroundCss(
    visual.background.taskMode,
    "var(--ocs-panel)",
    visual.surfaces.baseOpacityPercent,
    visual.background.taskOpacityPercent,
  );
  const taskSurface = surfaceSelector("task");
  const workbenchSurface = surfaceSelector("workbench");
  const workspacePanelSurface = surfaceSelector("workspace-panel");
  const resourceCardSurface = surfaceSelector("resource-card");
  const terminalSurface = surfaceSelector("terminal");
  const topFadeSurface = surfaceSelector("top-fade");
  const scrollFadeSurface = surfaceSelector("scroll-fade");
  const modeSwitcherSurface = surfaceSelector("mode-switcher");
  const modeSwitcherTrackSurface = surfaceSelector("mode-switcher-track");
  const modeSwitcherSelectionSurface = surfaceSelector("mode-switcher-selection");
  const featurePageSurface = surfaceSelector("feature-page");
  const featureToolbarSurface = surfaceSelector("feature-toolbar");
  const featureSearchSurface = surfaceSelector("feature-search");
  const composerSurface = surfaceSelector("composer");
  const composerChromeSurface = surfaceSelector("composer-chrome");
  const projectPickerStackSurface = surfaceSelector("project-picker-stack");
  const settingsSurface = surfaceSelector("settings");
  const settingsPanelSurface = surfaceSelector("settings-panel");
  const overlaySurface = surfaceSelector("overlay");
  const applicationMenuSurface = surfaceSelector("application-menu");
  const taskContentSurfaces = [taskSurface, workbenchSurface, workspacePanelSurface];
  const conversationSurfaces = [taskSurface, workbenchSurface];
  const taskPrimaryText = descendantSelector(
    taskContentSurfaces,
    ".text-token-foreground,.text-token-text-primary",
    "is",
  );
  const taskSecondaryText = descendantSelector(
    taskContentSurfaces,
    ".text-token-description-foreground,.text-token-text-secondary,.text-token-text-tertiary,.text-token-muted-foreground",
    "is",
  );
  const conversationBodyText = descendantSelector(
    conversationSurfaces,
    ".text-token-conversation-body",
    "is",
  );
  const conversationMarkdown = descendantSelector(
    conversationSurfaces,
    '[class*="_markdownContent_"],[class*="_markdownText_"]',
    "is",
  );
  const conversationMarkdownText = conversationSurfaces.map((surface) =>
    `${surface} :is([class*="_markdownContent_"],[class*="_markdownText_"]) ` +
    `:where(p,li,ul,ol,blockquote)`
  ).join(",");
  const conversationMetadataIcons = conversationSurfaces.map((surface) =>
    `${surface} :is(.text-token-text-secondary,.text-token-text-tertiary) ` +
    `:where(.text-token-conversation-body,svg,path)`
  ).join(",");
  const taskCodeBlocks = descendantSelector(
    conversationSurfaces,
    '[class*="bg-token-text-code-block-background"],[class*="_codeBlock_"]',
    "is",
  );
  const workspaceElevatedDescendants = [
    '[class*="bg-token-main-surface"]',
    '[class*="bg-token-dropdown-background"]',
    '[class*="bg-token-bg-fog"]',
    '[class*="bg-token-list-"]',
    '[class*="bg-token-input-background"]',
    ".file-tree-container",
    "file-tree-container",
    ".diffs-container",
    "diffs-container",
    ".codex-review-diff-card",
    '[class*="app-shell-tab-background"]',
    '[class*="sticky"][class*="backdrop-blur"]',
  ].join(",");
  const workspaceElevatedSurfaces = [workbenchSurface, workspacePanelSurface]
    .map((surface) =>
      `${surface} :is(${workspaceElevatedDescendants})` +
      `:not(${workspacePanelSurface})`
    ).join(",");
  const settingsTextRoots = [settingsSurface, settingsPanelSurface];
  const settingsInheritedText = descendantSelector(
    settingsTextRoots,
    "div,section,article,span,p,label,small,li,dd,dt,th,td",
  );
  const priorityThemeCss = [
    `@layer base{`,
    `[data-open-chatgpt-skin-surface="sidebar"] :is(`,
    `[class*="text-token-input-placeholder-foreground"],`,
    `[class*="text-token-muted-foreground"],[class*="text-token-text-tertiary"]){`,
    `color:var(--ocs-text-secondary)!important;}`,
    `${taskSurface} :is([class*="text-token-foreground"],[class*="text-token-text-primary"]),`,
    `${workbenchSurface} :is([class*="text-token-foreground"],[class*="text-token-text-primary"]),`,
    `${workspacePanelSurface} :is([class*="text-token-foreground"],[class*="text-token-text-primary"]){`,
    `color:var(--ocs-text)!important;}`,
    `${taskSurface} :is([class*="text-token-description-foreground"],`,
    `[class*="text-token-text-secondary"],[class*="text-token-text-tertiary"],`,
    `[class*="text-token-muted-foreground"]),`,
    `${workbenchSurface} :is([class*="text-token-description-foreground"],`,
    `[class*="text-token-text-secondary"],[class*="text-token-text-tertiary"],`,
    `[class*="text-token-muted-foreground"]),`,
    `${workspacePanelSurface} :is([class*="text-token-description-foreground"],`,
    `[class*="text-token-text-secondary"],[class*="text-token-text-tertiary"],`,
    `[class*="text-token-muted-foreground"]){color:var(--ocs-text-secondary)!important;}`,
    `${taskSurface} :is([class*="text-token-conversation-body"]),`,
    `${workbenchSurface} :is([class*="text-token-conversation-body"]){`,
    `color:inherit!important;}`,
    `${taskSurface} :is([class*="_markdownContent_"],[class*="_markdownText_"]),`,
    `${workbenchSurface} :is([class*="_markdownContent_"],[class*="_markdownText_"]){`,
    `color:var(--ocs-text)!important;}`,
    `${settingsSurface} :is([class*="text-token-foreground"],[class*="text-token-text-primary"]),`,
    `${settingsPanelSurface} :is([class*="text-token-foreground"],[class*="text-token-text-primary"]){`,
    `color:var(--ocs-text)!important;}`,
    `${settingsSurface} :is([class*="text-token-description-foreground"],`,
    `[class*="text-token-text-secondary"],[class*="text-token-text-tertiary"],`,
    `[class*="text-token-muted-foreground"],[class*="description"],[class*="Description"]),`,
    `${settingsPanelSurface} :is([class*="text-token-description-foreground"],`,
    `[class*="text-token-text-secondary"],[class*="text-token-text-tertiary"],`,
    `[class*="text-token-muted-foreground"],[class*="description"],[class*="Description"]){`,
    `color:var(--ocs-text-secondary)!important;}`,
    `${settingsSurface} :is([class*="bg-token-main-surface"],[class*="bg-token-input-background"],`,
    `[class*="bg-token-bg-fog"],[class*="bg-token-dropdown-background"],`,
    `[class*="bg-token-sidebar-surface"],[class*="bg-token-elevated-surface"],`,
    `[class*="bg-token-list-background"]),`,
    `${settingsPanelSurface} :is([class*="bg-token-main-surface"],[class*="bg-token-input-background"],`,
    `[class*="bg-token-bg-fog"],[class*="bg-token-dropdown-background"],`,
    `[class*="bg-token-sidebar-surface"],[class*="bg-token-elevated-surface"],`,
    `[class*="bg-token-list-background"]){`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;}`,
    `${overlaySurface} :is([class*="text-token-foreground"],[class*="text-token-text-primary"]){`,
    `color:var(--ocs-text)!important;}`,
    `${overlaySurface} :is([class*="text-token-description-foreground"],`,
    `[class*="text-token-text-secondary"],[class*="text-token-text-tertiary"],`,
    `[class*="text-token-muted-foreground"]){color:var(--ocs-text-secondary)!important;}`,
    `${overlaySurface} :is(.composer-surface-chrome,[class*="bg-token-input-background"],`,
    `[class*="bg-token-dropdown-background"]){`,
    `color:var(--ocs-input-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;}`,
    `}`,
  ].join("");
  const backgroundDataUrl = imageDataUrl(backgroundPath);
  const compileInterfaceImage = (
    image: ThemeInterfaceImageVisual,
  ): CompiledInterfaceImage | undefined => {
    if (!image.path) return undefined;
    if (image.path === backgroundPath) {
      return {
        asset: "background",
        positionXPercent: image.positionXPercent,
        positionYPercent: image.positionYPercent,
      };
    }
    return {
      asset: imageAsset(image.path),
      positionXPercent: image.positionXPercent,
      positionYPercent: image.positionYPercent,
    };
  };
  const profileAvatar = compileInterfaceImage(visual.interfaceImagery.profileAvatar);
  const suggestionIcons = Object.fromEntries(
    Object.entries(visual.interfaceImagery.suggestionIcons)
      .map(([slot, image]) => [slot, compileInterfaceImage(image)] as const)
      .filter((entry): entry is readonly [string, CompiledInterfaceImage] =>
        entry[1] !== undefined
      ),
  );
  const interfaceImagery = {
    ...(profileAvatar ? { profileAvatar } : {}),
    suggestionIcons,
  };
  const uiFamily = cssString(theme.typography.uiFamily);
  const codeFamily = cssString(theme.typography.codeFamily);
  const themeCss = [
    `:root{--ocs-accent:${theme.colors.accent};--ocs-secondary:${theme.colors.secondary};`,
    `--ocs-text:${theme.colors.text};--ocs-text-secondary:${theme.colors.textSecondary};`,
    `--ocs-muted:${theme.colors.muted};--ocs-link:${theme.colors.link};`,
    `--ocs-input-text:${theme.colors.inputText};--ocs-placeholder:${theme.colors.placeholder};`,
    `--ocs-code-text:${theme.colors.codeText};--ocs-panel:${theme.colors.panel};`,
    `--ocs-border:${theme.colors.border};--ocs-success:${theme.colors.success};`,
    `--ocs-warning:${theme.colors.warning};--ocs-danger:${theme.colors.danger};`,
    `--ocs-info:${theme.colors.info};--ocs-color-scheme:${visual.appearance.resolved};`,
    `--ocs-module-gap:${visual.layout.moduleGap}px;`,
    `--ocs-home-overlap-relief:0px;`,
    `--ocs-composer-width:${visual.layout.composerWidth * 100}%;`,
    `--ocs-card-columns:${visual.layout.cardColumns};--ocs-hero-height:${visual.layout.heroHeight}px;`,
    `--ocs-background-x:${visual.background.positionXPercent}%;`,
    `--ocs-background-y:${visual.background.positionYPercent}%;`,
    `--ocs-background-scale:${visual.background.scale};`,
    `--ocs-surface-panel-mix:${visual.surfaces.baseOpacityPercent}%;`,
    `--ocs-task-panel-mix:${visual.background.taskOpacityPercent}%;`,
    `--ocs-elevated-panel-mix:${visual.surfaces.elevatedOpacityPercent}%;`,
    `--ocs-terminal-panel-mix:${visual.surfaces.terminalOpacityPercent}%;`,
    `--ocs-surface-blur:${visual.surfaces.blurPx}px;`,
    `color-scheme:${visual.appearance.resolved}!important;}`,
    `html{background:#17191a!important;}body{color:var(--ocs-text)!important;`,
    `font-family:${uiFamily}!important;position:relative!important;isolation:isolate!important;`,
    `font-size:${visual.typography.uiSize}px!important;`,
    `font-weight:${visual.typography.uiWeight}!important;`,
    `line-height:${visual.typography.lineHeight}!important;background:transparent!important;}`,
    `body::before{content:"";position:fixed;inset:-32px;z-index:-3;pointer-events:none;`,
    "background-image:var(--ocs-background-image);",
    `background-position:var(--ocs-background-x) var(--ocs-background-y);`,
    `background-size:cover;background-repeat:no-repeat;`,
    `transform:scale(var(--ocs-background-scale));`,
    `transform-origin:var(--ocs-background-x) var(--ocs-background-y);`,
    `filter:blur(${visual.background.blurPx}px) brightness(${visual.background.brightness});}`,
    `body::after{content:"";position:fixed;inset:0;z-index:-2;pointer-events:none;`,
    `background:${safeAreaOverlay};}`,
    `p,li,dd,dt{color:var(--ocs-text-secondary)!important;}`,
    `small,[aria-description]{color:var(--ocs-muted)!important;}`,
    `a,[role=link]{color:var(--ocs-link)!important;}`,
    `input,textarea,[contenteditable=true],[role=textbox]{color:var(--ocs-input-text)!important;`,
    `caret-color:var(--ocs-accent)!important;}`,
    `input::placeholder,textarea::placeholder{color:var(--ocs-placeholder)!important;opacity:1!important;}`,
    `pre,code{color:var(--ocs-code-text)!important;font-family:${codeFamily}!important;`,
    `font-size:${theme.typography.codeSize}px!important;`,
    `font-weight:${theme.typography.codeWeight}!important;}`,
    `[role=alert]{color:var(--ocs-danger)!important;}`,
    `[role=status]{color:var(--ocs-info)!important;}`,
    `[data-open-chatgpt-skin-surface="main"]{backdrop-filter:none!important;}`,
    `[data-open-chatgpt-skin-surface="main"],[data-open-chatgpt-skin-surface="sidebar"]{`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-surface-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;}`,
    `[data-open-chatgpt-skin-surface="sidebar"]{` +
      `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${taskSurface}{position:relative!important;isolation:isolate!important;`,
    `color:var(--ocs-text)!important;background:${taskSurfaceBackground}!important;`,
    `border-color:var(--ocs-border)!important;}`,
    `${taskSurface} :where(article,[data-message-author-role]){`,
    `color:var(--ocs-text)!important;}`,
    `${workbenchSurface}{color:var(--ocs-text)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-surface-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${workspacePanelSurface}{color:var(--ocs-text)!important;`,
    `background:transparent!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;`,
    `backdrop-filter:none!important;}`,
    `${workspaceElevatedSurfaces}{color:var(--ocs-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `background-image:none!important;border-color:var(--ocs-border)!important;`,
    `box-shadow:none!important;}`,
    `${taskPrimaryText}{color:var(--ocs-text)!important;}`,
    `${taskSecondaryText}{color:var(--ocs-text-secondary)!important;}`,
    `${conversationBodyText}{color:inherit!important;}`,
    `${conversationMarkdown}{color:var(--ocs-text)!important;}`,
    `${conversationMarkdownText}{color:inherit!important;}`,
    `${conversationMetadataIcons}{color:inherit!important;}`,
    `${taskCodeBlocks}{color:var(--ocs-code-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;}`,
    `${resourceCardSurface}{color:var(--ocs-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `background-image:none!important;border-color:var(--ocs-border)!important;`,
    `box-shadow:none!important;backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${resourceCardSurface} :where(button,[role=button],svg){color:inherit!important;}`,
    `${taskSurface} :where(th,td){color:var(--ocs-text)!important;}`,
    `${workspacePanelSurface} :where(button,[role=button],svg){`,
    `color:inherit!important;}`,
    `${terminalSurface}{color:var(--ocs-code-text)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-terminal-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;font-family:${codeFamily}!important;}`,
    `${terminalSurface} :where(.xterm,.xterm-viewport,.xterm-screen,pre,code){`,
    `color:inherit!important;background:transparent!important;}`,
    `${settingsSurface}{position:relative!important;isolation:isolate!important;`,
    `color:var(--ocs-text)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-surface-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${settingsPanelSurface}{color:var(--ocs-text)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${settingsInheritedText}{color:inherit!important;}`,
    `${settingsSurface} :where(h1,h2,h3,h4,h5,h6,[role=heading]),`,
    `${settingsPanelSurface} :where(h1,h2,h3,h4,h5,h6,[role=heading]){`,
    `color:var(--ocs-text)!important;}`,
    `${settingsSurface} :is(.text-token-text-primary,.text-token-foreground),`,
    `${settingsPanelSurface} :is(.text-token-text-primary,.text-token-foreground){`,
    `color:var(--ocs-text)!important;}`,
    `${settingsSurface} :is(.text-token-input-foreground),`,
    `${settingsPanelSurface} :is(.text-token-input-foreground){`,
    `color:var(--ocs-input-text)!important;}`,
    `${settingsSurface} :where(p,span,label,small),`,
    `${settingsPanelSurface} :where(p,span,label,small){color:var(--ocs-text-secondary)!important;}`,
    `${settingsSurface} :is(.text-token-text-secondary,.text-token-description-foreground,.text-token-text-tertiary,.text-token-muted-foreground,[class*="description"],[class*="Description"]),`,
    `${settingsPanelSurface} :is(.text-token-text-secondary,.text-token-description-foreground,.text-token-text-tertiary,.text-token-muted-foreground,[class*="description"],[class*="Description"]){`,
    `color:var(--ocs-text-secondary)!important;}`,
    `${settingsSurface} :is(.text-token-input-placeholder-foreground),`,
    `${settingsPanelSurface} :is(.text-token-input-placeholder-foreground){`,
    `color:var(--ocs-muted)!important;}`,
    `${settingsSurface} :is(a,[role=link],.text-token-text-link-foreground),`,
    `${settingsPanelSurface} :is(a,[role=link],.text-token-text-link-foreground){`,
    `color:var(--ocs-link)!important;}`,
    `${settingsPanelSurface} :where(button,[role=button],input,textarea,select,svg){`,
    `color:inherit!important;border-color:var(--ocs-border)!important;}`,
    `${settingsSurface} :is([class*="bg-token-main-surface"],[class*="bg-token-input-background"],`,
    `[class*="bg-token-bg-fog"],[class*="bg-token-dropdown-background"],`,
    `[class*="bg-token-sidebar-surface"],[class*="bg-token-elevated-surface"],`,
    `[class*="bg-token-list-background"]),`,
    `${settingsPanelSurface} :is([class*="bg-token-main-surface"],[class*="bg-token-input-background"],`,
    `[class*="bg-token-bg-fog"],[class*="bg-token-dropdown-background"],`,
    `[class*="bg-token-sidebar-surface"],[class*="bg-token-elevated-surface"],`,
    `[class*="bg-token-list-background"]){`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;}`,
    `${settingsSurface} :is([class*="bg-token-text-link-foreground"]),`,
    `${settingsPanelSurface} :is([class*="bg-token-text-link-foreground"]){`,
    `background-color:var(--ocs-accent)!important;color:white!important;`,
    `border-color:transparent!important;}`,
    `${overlaySurface}{color:var(--ocs-text)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:0 14px 44px rgba(0,0,0,.22)!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${overlaySurface} :where(div,section,article,span,p,label,small,li,dd,dt,button,[role=menuitem],svg){`,
    `color:inherit!important;border-color:var(--ocs-border)!important;}`,
    `${overlaySurface} :is(.text-token-description-foreground,.text-token-text-secondary,`,
    `.text-token-text-tertiary,.text-token-muted-foreground){`,
    `color:var(--ocs-text-secondary)!important;}`,
    `${overlaySurface} :is(.composer-surface-chrome,[class*="bg-token-input-background"],`,
    `[class*="bg-token-dropdown-background"]){`,
    `color:var(--ocs-input-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;}`,
    `${overlaySurface} :where(input,textarea,[contenteditable=true],[role=textbox]){`,
    `color:var(--ocs-input-text)!important;background:transparent!important;}`,
    `${applicationMenuSurface}{color:var(--ocs-text-secondary)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${applicationMenuSurface} :where(button,svg){color:inherit!important;}`,
    `${modeSwitcherSurface}{color:var(--ocs-text-secondary)!important;`,
    `background:transparent!important;border-color:transparent!important;`,
    `box-shadow:none!important;backdrop-filter:none!important;}`,
    `${modeSwitcherSurface} :where(button){color:var(--ocs-text-secondary)!important;}`,
    `${modeSwitcherSurface} :is(.text-token-text-primary,[class*="text-token-text-primary"]){`,
    `color:var(--ocs-text)!important;}`,
    `${modeSwitcherTrackSurface}{`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-surface-panel-mix),transparent)!important;`,
    `border:1px solid var(--ocs-border)!important;box-shadow:none!important;`,
    `filter:none!important;backdrop-filter:none!important;}`,
    `${modeSwitcherSelectionSurface}{`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border:1px solid var(--ocs-border)!important;box-shadow:none!important;`,
    `filter:none!important;backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${featurePageSurface}{color:var(--ocs-text)!important;`,
    `background:transparent!important;border-color:var(--ocs-border)!important;`,
    `box-shadow:none!important;backdrop-filter:none!important;}`,
    `${featurePageSurface} :where(h1,h2,h3,h4,h5,h6,[role=heading]){`,
    `color:var(--ocs-text)!important;}`,
    `${featurePageSurface} :is(.text-token-foreground,.text-token-text-primary,`,
    `[class*="text-token-foreground"],[class*="text-token-text-primary"]){`,
    `color:var(--ocs-text)!important;}`,
    `${featurePageSurface} :is(.text-token-description-foreground,.text-token-text-secondary,`,
    `.text-token-text-tertiary,.text-token-muted-foreground,`,
    `[class*="text-token-description-foreground"],[class*="text-token-text-secondary"],`,
    `[class*="text-token-text-tertiary"],[class*="text-token-muted-foreground"]){`,
    `color:var(--ocs-text-secondary)!important;}`,
    `${featurePageSurface} :is([class*="bg-token-main-surface-primary"]):not(`,
    `[data-open-chatgpt-skin-surface]){`,
    `background-color:transparent!important;background-image:none!important;}`,
    `${featurePageSurface} :is([class*="bg-token-dropdown-background"],`,
    `[class*="bg-token-bg-fog"],[class*="bg-token-input-background"]):not(`,
    `[data-open-chatgpt-skin-surface]){`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;}`,
    `${featureToolbarSurface}{color:var(--ocs-text)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-surface-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${featureToolbarSurface}::before,${featureToolbarSurface}::after{`,
    `background:linear-gradient(to bottom,`,
    `color-mix(in srgb,var(--ocs-panel) var(--ocs-surface-panel-mix),transparent),`,
    `transparent)!important;box-shadow:none!important;}`,
    `${featureSearchSurface}{color:var(--ocs-input-text)!important;`,
    `background:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `${featureSearchSurface} :where(input,textarea,[contenteditable=true],[role=textbox]){`,
    `color:var(--ocs-input-text)!important;background:transparent!important;}`,
    `${featureSearchSurface} :where(input::placeholder,textarea::placeholder){`,
    `color:var(--ocs-placeholder)!important;opacity:1!important;}`,
    `[data-open-chatgpt-skin-surface="main"] :where(h1,h2,h3,h4,h5,h6,[role=heading]),`,
    `[data-open-chatgpt-skin-surface="hero"],`,
    `[data-open-chatgpt-skin-surface="hero"] :where(h1,h2,h3,[role=heading]){`,
    `color:var(--ocs-text)!important;}`,
    `[data-open-chatgpt-skin-surface="sidebar"]{padding:${visual.layout.sidebarDensity === "compact" ? 8 : 14}px!important;`,
    `color:var(--ocs-text-secondary)!important;}`,
    `[data-open-chatgpt-skin-surface="sidebar"] *{`,
    `color:inherit!important;}`,
    `[data-open-chatgpt-skin-surface="sidebar"] :is(.text-token-foreground,.text-token-text-primary,`,
    `.text-token-text-secondary,.text-token-text-tertiary,.text-token-muted-foreground){`,
    `color:var(--ocs-text-secondary)!important;}`,
    `[data-open-chatgpt-skin-surface="window-titlebar"],`,
    `[data-open-chatgpt-skin-surface="topbar"]{color:var(--ocs-text-secondary)!important;`,
    `background:transparent!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;}`,
    `[data-open-chatgpt-skin-surface="window-titlebar"] *,`,
    `[data-open-chatgpt-skin-surface="topbar"] *{color:inherit!important;`,
    `box-shadow:none!important;filter:none!important;}`,
    `[data-open-chatgpt-skin-surface="topbar"]::before,`,
    `[data-open-chatgpt-skin-surface="topbar"]::after{background:transparent!important;`,
    `box-shadow:none!important;filter:none!important;border-color:var(--ocs-border)!important;}`,
    `${topFadeSurface}{background:transparent!important;`,
    `background-color:transparent!important;background-image:none!important;`,
    `box-shadow:none!important;filter:none!important;backdrop-filter:none!important;`,
    `pointer-events:none!important;}`,
    `${scrollFadeSurface}{background:transparent!important;`,
    `background-color:transparent!important;background-image:none!important;`,
    `box-shadow:none!important;filter:none!important;backdrop-filter:none!important;`,
    `pointer-events:none!important;}`,
    `${topFadeSurface}::before,${topFadeSurface}::after,`,
    `${scrollFadeSurface}::before,${scrollFadeSurface}::after{`,
    `background:transparent!important;background-image:none!important;`,
    `box-shadow:none!important;filter:none!important;backdrop-filter:none!important;}`,
    `${composerSurface}{width:var(--ocs-composer-width)!important;`,
    `max-width:var(--ocs-composer-width)!important;margin-inline:auto!important;`,
    `color:var(--ocs-text)!important;`,
    `background:transparent!important;border-color:transparent!important;box-shadow:none!important;}`,
    `${composerSurface} :where(button,[role=button],span,svg){` +
      `color:var(--ocs-text)!important;}`,
    `${composerChromeSurface}{width:100%!important;max-width:100%!important;`,
    `margin-inline:0!important;background:transparent!important;`,
    `border-color:transparent!important;box-shadow:none!important;backdrop-filter:none!important;}`,
    `${composerSurface}::before,${composerSurface}::after,`,
    `${composerChromeSurface}::before,${composerChromeSurface}::after{`,
    `background:transparent!important;background-image:none!important;`,
    `border-color:transparent!important;box-shadow:none!important;filter:none!important;}`,
    `[data-open-chatgpt-skin-surface="composer-input"]{width:100%!important;max-width:100%!important;`,
    `color:var(--ocs-input-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;`,
    `box-shadow:none!important;`,
    `backdrop-filter:blur(var(--ocs-surface-blur))!important;}`,
    `[data-open-chatgpt-skin-surface="composer-input"] *{color:inherit!important;}`,
    `[data-open-chatgpt-skin-surface="composer-input"] :where(input,textarea,[contenteditable=true],[role=textbox]){`,
    `color:var(--ocs-input-text)!important;background:transparent!important;}`,
    `[data-open-chatgpt-skin-surface="composer-input"] [data-placeholder]::before,`,
    `[data-open-chatgpt-skin-surface="composer-input"] [data-placeholder]::after{`,
    `color:var(--ocs-placeholder)!important;opacity:1!important;}`,
    `[data-open-chatgpt-skin-surface="composer-input"] :where(button,[role=button]){`,
    `color:var(--ocs-text)!important;background-color:transparent!important;}`,
    `${composerSurface} :where([role=alert]){color:var(--ocs-danger)!important;}`,
    `${composerSurface} :where([role=status]){color:var(--ocs-info)!important;}`,
    `${composerSurface} :where(button:disabled,[role=button][aria-disabled=true]){`,
    `color:var(--ocs-muted)!important;}`,
    `${projectPickerStackSurface}{overflow:hidden!important;pointer-events:none!important;}`,
    `${projectPickerStackSurface} :is(`,
    `button,[role=button],[role=group],a,input,select){pointer-events:auto!important;}`,
    `[data-open-chatgpt-skin-surface="project-picker"]{color:var(--ocs-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;box-shadow:none!important;}`,
    `[data-open-chatgpt-skin-surface="project-picker"] *{color:inherit!important;}`,
    `[data-open-chatgpt-skin-surface="suggestions"]{display:grid!important;`,
    `grid-template-columns:repeat(var(--ocs-card-columns),minmax(0,1fr))!important;`,
    `grid-auto-rows:1fr!important;align-items:stretch!important;`,
    `gap:var(--ocs-module-gap)!important;}`,
    `[data-open-chatgpt-skin-surface="suggestions"] > *{`,
    `width:100%!important;min-width:0!important;max-width:none!important;}`,
    `[data-open-chatgpt-skin-surface="card"]{width:100%!important;max-width:none!important;`,
    `min-width:0!important;height:100%!important;position:relative!important;`,
    `color:var(--ocs-text)!important;`,
    `background-color:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;`,
    `border-color:var(--ocs-border)!important;border-radius:12px!important;}`,
    `[data-open-chatgpt-skin-surface="card"] :where(span,strong,p){color:inherit!important;}`,
    `[data-open-chatgpt-skin-interface-host]{position:relative!important;}`,
    `[data-open-chatgpt-skin-native-icon]{opacity:0!important;}`,
    `[data-open-chatgpt-skin-surface="hero"]{`,
    `min-height:max(180px,calc(min(var(--ocs-hero-height),45vh) - var(--ocs-home-overlap-relief)))!important;}`,
    `[data-open-chatgpt-skin-surface="hero"] *{color:inherit!important;}`,
    priorityThemeCss,
    compileModuleCss(visual.layout.modules),
  ].join("");

  const fontCss = Object.entries(theme.assets.fonts ?? {}).map(([key, path]) => {
    const bytes = bundle.files.get(path);
    if (!bytes) throw new RuntimeThemeError("ASSET_MISSING", path);
    return `@font-face{font-family:${cssString(`ocs-${key}`)};src:url(${cssString(dataUrl(path, bytes))}) format("woff2");}`;
  }).join("");
  const decorations = compileDecorations(bundle, imageAsset);
  const compositionLayers: CompiledCompositionLayer[] = visual.composition.layers.map((layer) => {
    const path = layer.asset.kind === "portrait"
      ? theme.assets.portrait
      : theme.assets.decorations?.[layer.asset.assetKey];
    if (!path) throw new RuntimeThemeError("ASSET_MISSING", layer.id);
    return {
      id: layer.id,
      asset: imageAsset(path),
      surface: layer.surface,
      anchor: layer.anchor,
      positionXPercent: layer.positionXPercent,
      positionYPercent: layer.positionYPercent,
      widthPercent: layer.widthPercent,
      opacity: layer.opacity,
      rotationDeg: layer.rotationDeg,
      required: layer.required,
    };
  });
  const welcome = visual.welcome ? {
    localized: visual.welcome.localized,
    displayFamily: visual.displayTypography.fontAssetKey
      ? `ocs-${visual.displayTypography.fontAssetKey}`
      : visual.displayTypography.family,
    displaySizePx: visual.displayTypography.size,
    displayWeight: visual.displayTypography.weight,
    displayLineHeight: visual.displayTypography.lineHeight,
    displayLetterSpacingEm: visual.displayTypography.letterSpacingEm,
  } : undefined;
  const compiled = withMeasuredBytes({
    themeId: theme.id,
    themeVersion: theme.version,
    backgroundDataUrl,
    themeCss,
    fontCss,
    layout: visual.layout,
    decorations,
    interfaceImagery,
    assetDataUrls,
    ...(welcome ? { welcome } : {}),
    compositionLayers,
  });
  assertRuntimeThemeSize(compiled.totalBytes);
  return compiled;
}
