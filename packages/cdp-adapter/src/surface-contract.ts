export const OPEN_CHATGPT_SKIN_SURFACES = [
  "main",
  "sidebar",
  "window-titlebar",
  "application-menu",
  "topbar",
  "mode-switcher",
  "mode-switcher-track",
  "mode-switcher-selection",
  "feature-page",
  "feature-toolbar",
  "feature-search",
  "top-fade",
  "scroll-fade",
  "hero",
  "suggestions",
  "card",
  "suggestion-icon-1",
  "suggestion-icon-2",
  "suggestion-icon-3",
  "suggestion-icon-4",
  "profile-avatar",
  "project-picker-stack",
  "project-picker",
  "composer",
  "composer-chrome",
  "composer-input",
  "task",
  "workbench",
  "workspace-panel",
  "resource-card",
  "terminal",
  "settings",
  "settings-panel",
  "overlay",
] as const;

export type OpenChatGPTSkinSurface = typeof OPEN_CHATGPT_SKIN_SURFACES[number];

export const NATIVE_CODEX_SURFACE_SELECTORS = {
  shellMain: "main.main-surface,main,[role=main]",
  sidebar: "aside.app-shell-left-panel,aside,nav,[role=navigation]",
  applicationMenu: '[class~="group/application-menu-top-bar"]',
  modeSwitcher: '[role="group"][aria-label="Composer mode"]',
  homeMarker: '[data-testid="home-icon"]',
  routeMain: '[role="main"]',
  terminal: '[role="terminal"],.xterm,[class*="terminal"]',
  scrollFade: [
    ".app-shell-main-content-top-fade",
    '[class*="scroll-fade"]',
    '[class*="scrollFade"]',
    '[class*="top-fade"]',
    '[class*="topFade"]',
    '[class*="bottom-fade"]',
    '[class*="bottomFade"]',
  ].join(","),
  overlay: [
    '[role="menu"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="listbox"]',
    '[data-radix-popper-content-wrapper]',
  ].join(","),
} as const;

export function surfaceSelector(...surfaces: readonly OpenChatGPTSkinSurface[]): string {
  return surfaces.map((surface) =>
    `[data-open-chatgpt-skin-surface="${surface}"]`
  ).join(",");
}
