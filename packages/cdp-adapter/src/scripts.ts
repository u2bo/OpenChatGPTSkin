import type { CompiledTheme } from "./types.js";

import { NATIVE_CODEX_SURFACE_SELECTORS } from "./surface-contract.js";

const MANAGED_NODE_SELECTOR = [
  'style[data-open-chatgpt-skin="theme"]',
  'style[data-open-chatgpt-skin="fonts"]',
  'div[data-open-chatgpt-skin="decorations"]',
  'div[data-open-chatgpt-skin="welcome"]',
  'div[data-open-chatgpt-skin="composition-layer"]',
  'span[data-open-chatgpt-skin-interface-image]',
].join(",");
const MANAGED_SURFACE_SELECTOR = "[data-open-chatgpt-skin-surface]";
const INTERFACE_IMAGE_SELECTOR = "span[data-open-chatgpt-skin-interface-image]";
const INTERFACE_HOST_SELECTOR = "[data-open-chatgpt-skin-interface-host]";
const NATIVE_ICON_SELECTOR = "[data-open-chatgpt-skin-native-icon]";
const SURFACE_MARKER_KEY = "__openChatgptSkinMarkSurfaces";
const SURFACE_OBSERVER_KEY = "__openChatgptSkinSurfaceObserver";
const SURFACE_REFRESH_LISTENER_KEY = "__openChatgptSkinSurfaceRefreshListener";
const SHADOW_SHEETS_KEY = "__openChatgptSkinShadowSheets";
const OVERLAP_RELIEF_PROPERTY = "--ocs-home-overlap-relief";
export const COMPOSITION_UNDERLAY_Z_INDEX = -1 as const;
const TEXTBOX_SELECTOR = "textarea,[contenteditable=true],[role=textbox]";
const COMPOSER_EXCLUSION_SELECTOR = [
  NATIVE_CODEX_SURFACE_SELECTORS.terminal,
  NATIVE_CODEX_SURFACE_SELECTORS.overlay,
].join(",");
const THREAD_CONVERSATION_SELECTOR =
  ".thread-scroll-container,[data-thread-scroll-container]";
const THREAD_RESOURCE_CARD_SELECTOR =
  '[class*="thread-resource-card"],[class*="turn-diff-row-padding"]';
const REVIEW_SHADOW_THEME_CSS = {
  diffs: [
    "@layer base{",
    ":host,pre,code,[data-gutter],[data-content],[data-line-type=\"context\"],",
    "[data-column-number][data-line-type=\"context\"]{",
    "background:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;",
    "color:var(--ocs-code-text)!important;border-color:var(--ocs-border)!important;}",
    "[data-separator-wrapper],[data-separator],[data-separator-content]{",
    "background:color-mix(in srgb,var(--ocs-panel) 88%,transparent)!important;",
    "color:var(--ocs-text-secondary)!important;border-color:var(--ocs-border)!important;}",
    "[data-line-type=\"context\"] *{color:var(--ocs-code-text)!important;}",
    "[data-line-type=\"change-addition\"]{",
    "background:color-mix(in srgb,var(--ocs-panel) 82%,var(--ocs-success))!important;}",
    "[data-line][data-line-type=\"change-addition\"],",
    "[data-line][data-line-type=\"change-addition\"] *{color:var(--ocs-code-text)!important;}",
    "[data-line-type=\"change-deletion\"]{",
    "background:color-mix(in srgb,var(--ocs-panel) 82%,var(--ocs-danger))!important;}",
    "[data-line][data-line-type=\"change-deletion\"],",
    "[data-line][data-line-type=\"change-deletion\"] *{color:var(--ocs-code-text)!important;}",
    "}",
  ].join(""),
  tree: [
    "@layer base{",
    ":host,[data-file-tree-sticky-overlay-content],[data-file-tree-virtualized-list],",
    "[data-type=\"item\"]{",
    "background:color-mix(in srgb,var(--ocs-panel) var(--ocs-elevated-panel-mix),transparent)!important;",
    "color:var(--ocs-text)!important;border-color:var(--ocs-border)!important;}",
    "[data-type=\"item\"]:hover{background:color-mix(in srgb,var(--ocs-accent) 8%,transparent)!important;}",
    "[data-type=\"item\"][aria-selected=\"true\"]{",
    "background:color-mix(in srgb,var(--ocs-accent) 14%,transparent)!important;",
    "color:var(--ocs-text)!important;}",
    "[data-truncate-marker]{background:var(--ocs-panel)!important;",
    "color:var(--ocs-text)!important;box-shadow:none!important;}",
    "}",
  ].join(""),
} as const;
const VISIBLE_COMPOSER_EXPRESSION = `Array.from(document.querySelectorAll(
  ${JSON.stringify(TEXTBOX_SELECTOR)}
)).some((node) => visible(node) &&
  !node.closest(${JSON.stringify(COMPOSER_EXCLUSION_SELECTOR)}))`;
const SETTINGS_PAGE_PATTERN_SOURCE =
  "(?:settings|preferences|account|appearance|theme|general|permissions|configuration|personalization|设置|偏好|账户|外观|主题|常规|权限|配置|个性化)";
const SETTINGS_PAGE_DETECTION_EXPRESSION = `(() => {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const pathname = (() => {
    try { return new URL(window.location.href).pathname.toLowerCase(); }
    catch { return ""; }
  })();
  const pattern = new RegExp(${JSON.stringify(SETTINGS_PAGE_PATTERN_SOURCE)}, "i");
  const settingsPath = pathname.split("/")
    .some((segment) => /^(?:settings|preferences)$/.test(segment));
  const settingsNavigation = Array.from(document.querySelectorAll(
    "nav,aside,[role=navigation]"
  )).some((node) => visible(node) && pattern.test([
    node.id,
    typeof node.className === "string" ? node.className : "",
    node.getAttribute("aria-label") || "",
    node.getAttribute("data-testid") || "",
  ].join(" ")));
  const main = document.querySelector("main,[role=main]");
  const mainSemantic = Boolean(main) && Array.from(main.querySelectorAll(
      "h1,h2,h3,[role=heading],[aria-label],[data-testid]"
    )).some((node) => visible(node) &&
      !node.closest('[role="dialog"],[role="menu"],[role="alertdialog"]') &&
      pattern.test([
      node.id,
      typeof node.className === "string" ? node.className : "",
      node.getAttribute("role") || "",
      node.getAttribute("aria-label") || "",
      node.getAttribute("data-testid") || "",
      String(node.textContent || "").slice(0, 120),
    ].join(" ")));
  return settingsPath || settingsNavigation || mainSemantic;
})()`;
const HOME_HEADING_RESOLVER_EXPRESSION = `((main, composer, suggestions, visible) => {
  const marked = Array.from(main.querySelectorAll(
    '[data-open-chatgpt-skin-surface="home-heading"]'
  )).filter((node) => visible(node));
  if (marked.length > 0) return marked.length === 1 ? marked[0] : null;

  const normalizedText = (node) => String(node.textContent || "")
    .trim().replace(/\\s+/g, " ");
  const candidates = Array.from(main.querySelectorAll("h1,h2,[role=heading],*"))
    .filter((node) => {
      if (!visible(node) || (composer && composer.contains(node)) ||
        (suggestions && suggestions.contains(node)) ||
        node.closest(${JSON.stringify(NATIVE_CODEX_SURFACE_SELECTORS.overlay)}) ||
        node.closest('[data-open-chatgpt-skin="composition-layer"]')) return false;
      const rect = node.getBoundingClientRect();
      const fontSize = Number.parseFloat(window.getComputedStyle(node).fontSize);
      const semantic = node.matches("h1,h2,[role=heading]");
      return normalizedText(node).length > 0 && (semantic ||
        (rect.width >= 100 && rect.height >= 24 && fontSize >= 24));
    });
  const roots = candidates.filter((candidate) =>
    !candidates.some((ancestor) => ancestor !== candidate &&
      ancestor.contains(candidate))
  );
  return roots.length === 1 ? roots[0] : null;
})`;

export const REMOVE_EXPRESSION = `(() => {
  const observerKey = ${JSON.stringify(SURFACE_OBSERVER_KEY)};
  const markerKey = ${JSON.stringify(SURFACE_MARKER_KEY)};
  const shadowSheetsKey = ${JSON.stringify(SHADOW_SHEETS_KEY)};
  const refreshListenerKey = ${JSON.stringify(SURFACE_REFRESH_LISTENER_KEY)};
  const observer = window[observerKey];
  if (observer && typeof observer.disconnect === "function") observer.disconnect();
  delete window[observerKey];
  delete window[markerKey];
  const refreshListener = window[refreshListenerKey];
  if (typeof refreshListener === "function") {
    window.removeEventListener("resize", refreshListener);
    window.removeEventListener("scroll", refreshListener, true);
  }
  delete window[refreshListenerKey];
  const shadowRecords = Array.isArray(window[shadowSheetsKey])
    ? window[shadowSheetsKey]
    : [];
  for (const record of shadowRecords) {
    if (record.sheet && record.root?.adoptedStyleSheets) {
      record.root.adoptedStyleSheets = Array.from(record.root.adoptedStyleSheets)
        .filter((sheet) => sheet !== record.sheet);
    }
    if (record.node?.parentNode) record.node.parentNode.removeChild(record.node);
  }
  delete window[shadowSheetsKey];
  if (Array.isArray(window[shadowSheetsKey])) window[shadowSheetsKey] = undefined;
  document.documentElement.style.removeProperty(${JSON.stringify(OVERLAP_RELIEF_PROPERTY)});
  for (const node of document.querySelectorAll('[data-open-chatgpt-skin="welcome"]')) {
    const record = node.__openChatgptSkinWelcomeRecord;
    if (record?.heading?.style) record.heading.style.visibility = record.visibility;
    node.remove();
  }
  const selector = ${JSON.stringify(MANAGED_NODE_SELECTOR)};
  for (const node of document.querySelectorAll(selector)) node.remove();
  const surfaceSelector = ${JSON.stringify(MANAGED_SURFACE_SELECTOR)};
  for (const node of document.querySelectorAll(surfaceSelector)) {
    node.removeAttribute("data-open-chatgpt-skin-surface");
  }
  for (const node of document.querySelectorAll(${JSON.stringify(INTERFACE_HOST_SELECTOR)})) {
    node.removeAttribute("data-open-chatgpt-skin-interface-host");
  }
  for (const node of document.querySelectorAll(${JSON.stringify(NATIVE_ICON_SELECTOR)})) {
    node.removeAttribute("data-open-chatgpt-skin-native-icon");
  }
  const countShadowStyles = (root) => {
    let count = 0;
    for (const node of root.querySelectorAll("*")) {
      const shadow = node.shadowRoot;
      if (!shadow) continue;
      count += shadow.querySelectorAll('style[data-open-chatgpt-skin-shadow]').length;
      count += countShadowStyles(shadow);
    }
    return count;
  };
  return document.querySelectorAll(selector).length +
    document.querySelectorAll(surfaceSelector).length +
    countShadowStyles(document) +
    (Array.isArray(window[shadowSheetsKey]) ? window[shadowSheetsKey].length : 0);
})()`;

export const PROBE_EXPRESSION = `(() => {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const settingsPagePresent = ${SETTINGS_PAGE_DETECTION_EXPRESSION};
  return {
    main: visible(document.querySelector("main,[role=main]")),
    navigation: visible(document.querySelector("nav,aside,[role=navigation]")),
    composer: ${VISIBLE_COMPOSER_EXPRESSION} || settingsPagePresent
  };
})()`;

export function preflightExpression(theme: CompiledTheme): string {
  const payload = JSON.stringify(theme);
  const nativeSelectors = JSON.stringify(NATIVE_CODEX_SURFACE_SELECTORS);
  return `(() => {
    const theme = ${payload};
    const nativeSelectors = ${nativeSelectors};
    const resolveHomeHeading = ${HOME_HEADING_RESOLVER_EXPRESSION};
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const main = Array.from(document.querySelectorAll(nativeSelectors.shellMain))
      .find((node) => visible(node) &&
        !node.closest('[data-open-chatgpt-skin="composition-layer"]')) || null;
    if (!main) {
      return { valid: false, welcomeSupported: false, requiredLayersResolved: false };
    }
    const pathname = (() => {
      try { return new URL(window.location.href).pathname.toLowerCase(); }
      catch { return ""; }
    })();
    const routeSegments = pathname.split("/");
    const taskPath = routeSegments.some((segment) =>
      /^(?:tasks?|threads?|workspaces?)$/.test(segment)
    );
    const settingsPath = routeSegments.some((segment) =>
      /^(?:settings|preferences)$/.test(segment)
    );
    const settingsPagePresent = ${SETTINGS_PAGE_DETECTION_EXPRESSION};
    const composer = Array.from(main.querySelectorAll(
      ${JSON.stringify(TEXTBOX_SELECTOR)}
    )).find((node) => visible(node) &&
      !node.closest(${JSON.stringify(COMPOSER_EXCLUSION_SELECTOR)})) || null;
    const managedHomeRoutes = Array.from(document.querySelectorAll(
      '[data-open-chatgpt-skin-surface="home-route"]'
    )).filter((node) => visible(node) && main.contains(node));
    const routeMains = Array.from(main.querySelectorAll(nativeSelectors.routeMain))
      .filter((node) => node !== main && visible(node));
    const modeSwitcher = Array.from(document.querySelectorAll(nativeSelectors.modeSwitcher))
      .find((node) => visible(node));
    const chatGptLandingRoutes = modeSwitcher && composer ? routeMains.filter((node) => {
      if (!node.contains(composer)) return false;
      const routeRect = node.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      return composerRect.bottom <= routeRect.bottom - Math.max(96, routeRect.height * 0.15);
    }) : [];
    const activeHome = (managedHomeRoutes.length === 1 ||
      Boolean(main.querySelector(nativeSelectors.homeMarker)) ||
      chatGptLandingRoutes.length === 1) &&
      !taskPath && !settingsPath && !settingsPagePresent;
    const suggestionMarkers = Array.from(document.querySelectorAll(
      '[data-open-chatgpt-skin-surface="suggestions"]'
    )).filter((node) => visible(node) && main.contains(node));
    const inferredSuggestions = Array.from(main.querySelectorAll("section,div"))
      .filter((node) => visible(node) && (!composer || !node.contains(composer)))
      .filter((node) => {
        const buttons = Array.from(node.children).filter((child) =>
          child.matches("button,[role=button]") && visible(child)
        );
        return buttons.length >= 3 && buttons.length <= 8;
      });
    const suggestionCandidates = suggestionMarkers.length > 0
      ? suggestionMarkers
      : inferredSuggestions;
    const suggestions = suggestionCandidates.length === 1 ? suggestionCandidates[0] : null;
    const heading = resolveHomeHeading(main, composer, suggestions, visible);
    const heroMarkers = Array.from(document.querySelectorAll(
      '[data-open-chatgpt-skin-surface="hero"]'
    )).filter((node) => visible(node) && main.contains(node));
    const heroCandidates = heroMarkers.length > 0
      ? heroMarkers
      : (heading ? [heading] : []);
    const hero = heroCandidates.length === 1 ? heroCandidates[0] : null;
    const locale = String(document.documentElement.lang || "en").toLowerCase()
      .startsWith("zh") ? "zh-CN" : "en";
    const welcomeLines = theme.welcome?.localized?.[locale];
    const projectButton = Array.from(main.querySelectorAll("button,[role=button]"))
      .filter((node) => visible(node) && /(?:switch project|project|项目)/i.test(
        [node.getAttribute("aria-label") || "", node.getAttribute("data-testid") || ""]
          .join(" ")
      ))[0];
    const projectName = String(projectButton?.textContent || "").trim();
    const needsProjectName = Array.isArray(welcomeLines) && welcomeLines.some((line) =>
      Array.isArray(line) && line.some((token) => token?.kind === "projectName")
    );
    const nativeWelcomeFallback = !Array.isArray(welcomeLines) || welcomeLines.length === 0 ||
      (needsProjectName && !projectName);
    const welcomeSupported = !theme.welcome || !activeHome || nativeWelcomeFallback ||
      Boolean(heading && hero);
    const applicable = (surface) => surface === "viewport" || surface === "main" ||
      activeHome;
    const resolved = (surface) => {
      if (surface === "viewport") return Boolean(document.documentElement);
      if (surface === "main") return Boolean(main);
      if (surface === "home-hero") return Boolean(hero);
      if (surface === "suggestions") return Boolean(suggestions);
      return false;
    };
    const requiredLayersResolved = theme.compositionLayers
      .filter((layer) => layer.required && applicable(layer.surface))
      .every((layer) => resolved(layer.surface));
    return {
      valid: welcomeSupported && requiredLayersResolved,
      welcomeSupported,
      requiredLayersResolved,
    };
  })()`;
}

export function applyExpression(theme: CompiledTheme): string {
  const payload = JSON.stringify(theme);
  const nativeSelectors = JSON.stringify(NATIVE_CODEX_SURFACE_SELECTORS);
  return `(async () => {
    const theme = ${payload};
    const nativeSelectors = ${nativeSelectors};
    const resolveHomeHeading = ${HOME_HEADING_RESOLVER_EXPRESSION};
    const observerKey = ${JSON.stringify(SURFACE_OBSERVER_KEY)};
    const markerKey = ${JSON.stringify(SURFACE_MARKER_KEY)};
    const shadowSheetsKey = ${JSON.stringify(SHADOW_SHEETS_KEY)};
    const refreshListenerKey = ${JSON.stringify(SURFACE_REFRESH_LISTENER_KEY)};
    const shadowThemeCss = ${JSON.stringify(REVIEW_SHADOW_THEME_CSS)};
    const compositionUnderlayZIndex = ${COMPOSITION_UNDERLAY_Z_INDEX};
    const detachShadowThemeRecord = (record) => {
      if (record.sheet && record.root?.adoptedStyleSheets) {
        record.root.adoptedStyleSheets = Array.from(record.root.adoptedStyleSheets)
          .filter((sheet) => sheet !== record.sheet);
      }
      if (record.node?.parentNode) record.node.parentNode.removeChild(record.node);
    };
    const clearShadowThemes = () => {
      const records = Array.isArray(window[shadowSheetsKey])
        ? window[shadowSheetsKey]
        : [];
      for (const record of records) detachShadowThemeRecord(record);
      delete window[shadowSheetsKey];
      if (Array.isArray(window[shadowSheetsKey])) window[shadowSheetsKey] = undefined;
    };
    const previousObserver = window[observerKey];
    if (previousObserver && typeof previousObserver.disconnect === "function") {
      previousObserver.disconnect();
    }
    delete window[observerKey];
    delete window[markerKey];
    const previousRefreshListener = window[refreshListenerKey];
    if (typeof previousRefreshListener === "function") {
      window.removeEventListener("resize", previousRefreshListener);
      window.removeEventListener("scroll", previousRefreshListener, true);
    }
    delete window[refreshListenerKey];
    clearShadowThemes();
    const overlapReliefProperty = ${JSON.stringify(OVERLAP_RELIEF_PROPERTY)};
    document.documentElement.style.removeProperty(overlapReliefProperty);
    const managedSelector = ${JSON.stringify(MANAGED_NODE_SELECTOR)};
    const restoreWelcome = (node) => {
      const record = node?.__openChatgptSkinWelcomeRecord;
      if (record?.heading?.style) record.heading.style.visibility = record.visibility;
      if (node?.parentNode) node.parentNode.removeChild(node);
    };
    for (const node of document.querySelectorAll('[data-open-chatgpt-skin="welcome"]')) {
      restoreWelcome(node);
    }
    for (const node of document.querySelectorAll(managedSelector)) node.remove();
    const surfaceSelector = ${JSON.stringify(MANAGED_SURFACE_SELECTOR)};
    for (const node of document.querySelectorAll(surfaceSelector)) {
      node.removeAttribute("data-open-chatgpt-skin-surface");
    }
    const interfaceImageSelector = ${JSON.stringify(INTERFACE_IMAGE_SELECTOR)};
    const interfaceHostSelector = ${JSON.stringify(INTERFACE_HOST_SELECTOR)};
    const nativeIconSelector = ${JSON.stringify(NATIVE_ICON_SELECTOR)};
    for (const node of document.querySelectorAll(interfaceHostSelector)) {
      node.removeAttribute("data-open-chatgpt-skin-interface-host");
    }
    for (const node of document.querySelectorAll(nativeIconSelector)) {
      node.removeAttribute("data-open-chatgpt-skin-native-icon");
    }

    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const hasSurfaceBackground = (node) => {
      if (!node) return false;
      const background = window.getComputedStyle(node).backgroundColor;
      return typeof background === "string" && background !== "transparent" &&
        background !== "rgba(0, 0, 0, 0)";
    };
    const insideOverlay = (node) => Boolean(node && node.closest(nativeSelectors.overlay));
    const insideTerminal = (node) => Boolean(node && node.closest(nativeSelectors.terminal));
    const insideThreadConversation = (node) => Boolean(node && node.closest(
      ${JSON.stringify(THREAD_CONVERSATION_SELECTOR)}
    ));
    const verificationRecord = {
      themeId: theme.themeId,
      welcomeExpected: false,
      welcomeSupported: true,
      requiredLayerIds: [],
      requiredLayersResolved: true,
    };
    const resolveThemeLocale = () => {
      const declared = String(document.documentElement.lang || "").toLowerCase();
      if (declared.startsWith("zh")) return "zh-CN";
      const uiSample = Array.from(document.querySelectorAll(
        "button,[role=button],[role=navigation],[aria-label]"
      )).filter((node) => visible(node)).slice(0, 40).map((node) => [
        node.getAttribute("aria-label") || "",
        String(node.textContent || "").slice(0, 80)
      ].join(" ")).join(" ");
      return /[\u3400-\u9fff]/u.test(uiSample) ? "zh-CN" : "en";
    };
    const syncWelcome = (main, hero, heading, activeHome) => {
      const existing = document.querySelector('[data-open-chatgpt-skin="welcome"]');
      verificationRecord.welcomeExpected = false;
      verificationRecord.welcomeSupported = true;
      if (!theme.welcome || !activeHome) {
        if (existing) restoreWelcome(existing);
        return;
      }
      const locale = resolveThemeLocale();
      const lines = theme.welcome.localized[locale];
      if (!Array.isArray(lines) || lines.length === 0) {
        if (existing) restoreWelcome(existing);
        return;
      }
      const projectButton = Array.from(main.querySelectorAll("button,[role=button]"))
        .filter((node) => visible(node) && /(?:switch project|project|项目)/i.test(
          [node.getAttribute("aria-label") || "", node.getAttribute("data-testid") || ""]
            .join(" ")
        ))[0];
      const projectName = String(projectButton?.textContent || "").trim();
      if (projectButton && !projectButton.dataset.openChatgptSkinSurface) {
        projectButton.dataset.openChatgptSkinSurface = "project-name";
      }
      const needsProjectName = lines.some((line) => Array.isArray(line) &&
        line.some((token) => token?.kind === "projectName"));
      if (needsProjectName && !projectName) {
        if (existing) restoreWelcome(existing);
        return;
      }
      if (!hero || !heading) {
        verificationRecord.welcomeSupported = false;
        if (existing) restoreWelcome(existing);
        return;
      }
      const resolvedLines = lines.map((line) => line.map((token) => {
        if (token.kind === "text") return token.value;
        if (token.kind === "projectName") return projectName;
        throw new Error("THEME_WELCOME_INVALID");
      }).join(""));
      verificationRecord.welcomeExpected = true;
      let overlay = existing;
      if (overlay?.__openChatgptSkinWelcomeRecord?.heading !== heading) {
        restoreWelcome(overlay);
        overlay = null;
      }
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.dataset.openChatgptSkin = "welcome";
        overlay.dataset.openChatgptSkinOwner = theme.themeId;
        overlay.setAttribute("aria-hidden", "true");
        overlay.__openChatgptSkinWelcomeRecord = {
          heading,
          visibility: heading.style.visibility,
        };
        document.body.append(overlay);
      }
      const currentLines = Array.from(overlay.children)
        .map((node) => String(node.textContent || ""));
      const linesMatch = overlay.childNodes.length === resolvedLines.length &&
        currentLines.length === resolvedLines.length &&
        currentLines.every((line, index) => line === resolvedLines[index]);
      if (!linesMatch) {
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
        for (const line of resolvedLines) {
          const lineNode = document.createElement("div");
          lineNode.append(document.createTextNode(line));
          overlay.append(lineNode);
        }
      }
      const nativeRect = heading.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const layout = theme.welcome.layout;
      const anchorTransforms = {
        "top-left": "translate(0%, 0%)",
        "top-center": "translate(-50%, 0%)",
        "top-right": "translate(-100%, 0%)",
        "center-left": "translate(0%, -50%)",
        "center": "translate(-50%, -50%)",
        "center-right": "translate(-100%, -50%)",
        "bottom-left": "translate(0%, -100%)",
        "bottom-center": "translate(-50%, -100%)",
        "bottom-right": "translate(-100%, -100%)"
      };
      const left = layout
        ? heroRect.left + heroRect.width * layout.positionXPercent / 100
        : nativeRect.left;
      const top = layout
        ? heroRect.top + heroRect.height * layout.positionYPercent / 100
        : nativeRect.top;
      const width = layout ? heroRect.width * layout.widthPercent / 100 : nativeRect.width;
      Object.assign(overlay.style, {
        position: "fixed",
        left: String(left) + "px",
        top: String(top) + "px",
        width: String(width) + "px",
        transform: layout ? anchorTransforms[layout.anchor] : "none",
        textAlign: layout?.textAlign || "",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: "0",
        color: "var(--ocs-text)",
        fontFamily: theme.welcome.displayFamily,
        fontSize: String(theme.welcome.displaySizePx) + "px",
        fontWeight: String(theme.welcome.displayWeight),
        lineHeight: String(theme.welcome.displayLineHeight),
        letterSpacing: String(theme.welcome.displayLetterSpacingEm) + "em",
      });
      if (layout?.hideNativeIcon) {
        const nativeHeroIcon = Array.from(hero.querySelectorAll("svg,img"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return visible(node) && rect.width >= 12 && rect.width <= 96 &&
              rect.height >= 12 && rect.height <= 96 &&
              !node.closest('[data-open-chatgpt-skin="composition-layer"]');
          })[0];
        const iconHost = nativeHeroIcon?.parentElement || nativeHeroIcon;
        if (iconHost) iconHost.dataset.openChatgptSkinSurface = "home-native-icon";
      }
      heading.style.visibility = "hidden";
    };
    const syncCompositionLayers = (main, hero, suggestions, activeHome) => {
      const descriptors = Array.isArray(theme.compositionLayers)
        ? theme.compositionLayers
        : [];
      const anchorTransforms = {
        "top-left": "translate(0%, 0%)",
        "top-center": "translate(-50%, 0%)",
        "top-right": "translate(-100%, 0%)",
        "center-left": "translate(0%, -50%)",
        "center": "translate(-50%, -50%)",
        "center-right": "translate(-100%, -50%)",
        "bottom-left": "translate(0%, -100%)",
        "bottom-center": "translate(-50%, -100%)",
        "bottom-right": "translate(-100%, -100%)",
      };
      const targetFor = (surface) => {
        if (surface === "viewport") return document.documentElement;
        if (surface === "main") return main;
        if (!activeHome) return null;
        if (surface === "home-hero") return hero;
        if (surface === "suggestions") return suggestions;
        return null;
      };
      const existingHosts = Array.from(document.querySelectorAll(
        '[data-open-chatgpt-skin="composition-layer"]'
      ));
      const applicable = (descriptor) => descriptor.surface === "viewport" ||
        descriptor.surface === "main" || activeHome;
      verificationRecord.requiredLayerIds = descriptors
        .filter((descriptor) => descriptor.required && applicable(descriptor))
        .map((descriptor) => descriptor.id);
      verificationRecord.requiredLayersResolved = true;
      const desiredHosts = new Set();
      for (const surface of ["viewport", "main", "home-hero", "suggestions"]) {
        const surfaceLayers = descriptors.filter((descriptor) => descriptor.surface === surface);
        if (surfaceLayers.length === 0) continue;
        const target = targetFor(surface);
        if (!target) continue;
        let host = existingHosts.find((candidate) =>
          candidate.dataset.openChatgptSkinCompositionSurface === surface &&
          candidate.dataset.openChatgptSkinOwner === theme.themeId
        );
        if (!host) {
          host = document.createElement("div");
          host.dataset.openChatgptSkin = "composition-layer";
          host.dataset.openChatgptSkinCompositionSurface = surface;
          host.dataset.openChatgptSkinOwner = theme.themeId;
          host.setAttribute("aria-hidden", "true");
          document.body.append(host);
        }
        desiredHosts.add(host);
        host.dataset.openChatgptSkinSurface = "composition-host";
        const rect = surface === "viewport" ? null : target.getBoundingClientRect();
        Object.assign(host.style, {
          position: "fixed",
          left: rect ? String(rect.left) + "px" : "0px",
          top: rect ? String(rect.top) + "px" : "0px",
          width: rect ? String(rect.width) + "px" : "100vw",
          height: rect ? String(rect.height) + "px" : "100vh",
          pointerEvents: "none",
          overflow: "visible",
          zIndex: String(compositionUnderlayZIndex),
        });
        const desiredLayers = new Set();
        for (const descriptor of surfaceLayers) {
          const dataUrl = theme.assetDataUrls[descriptor.asset];
          const anchorTransform = anchorTransforms[descriptor.anchor];
          if (typeof dataUrl !== "string" || typeof anchorTransform !== "string") continue;
          let layer = Array.from(host.querySelectorAll('[data-open-chatgpt-skin-layer-id]'))
            .find((candidate) => candidate.dataset.openChatgptSkinLayerId === descriptor.id);
          if (!layer) {
            layer = document.createElement("img");
            layer.dataset.openChatgptSkinLayerId = descriptor.id;
            layer.setAttribute("aria-hidden", "true");
            layer.tabIndex = -1;
            host.append(layer);
          }
          desiredLayers.add(layer);
          layer.src = dataUrl;
          Object.assign(layer.style, {
            position: "absolute",
            left: String(descriptor.positionXPercent) + "%",
            top: String(descriptor.positionYPercent) + "%",
            width: String(descriptor.widthPercent) + "%",
            height: "auto",
            opacity: String(descriptor.opacity),
            transform: anchorTransform + " rotate(" + String(descriptor.rotationDeg) + "deg)",
            pointerEvents: "none",
            userSelect: "none",
          });
        }
        for (const layer of host.querySelectorAll('[data-open-chatgpt-skin-layer-id]')) {
          if (!desiredLayers.has(layer)) layer.remove();
        }
      }
      for (const host of existingHosts) {
        if (!desiredHosts.has(host)) host.remove();
      }
      verificationRecord.requiredLayersResolved = verificationRecord.requiredLayerIds
        .every((layerId) => document.querySelectorAll(
          '[data-open-chatgpt-skin="composition-layer"]' +
          '[data-open-chatgpt-skin-owner="' + theme.themeId + '"] ' +
          '[data-open-chatgpt-skin-layer-id="' + layerId + '"]'
        ).length === 1);
    };
    const overlapsThreadConversation = (node) => Boolean(node && (
      insideThreadConversation(node) || node.querySelector(
        ${JSON.stringify(THREAD_CONVERSATION_SELECTOR)}
      )
    ));
    const syncReviewShadowThemes = () => {
      const currentRecords = Array.isArray(window[shadowSheetsKey])
        ? window[shadowSheetsKey]
        : [];
      const records = [];
      for (const record of currentRecords) {
        const adopted = record.sheet && record.root?.adoptedStyleSheets
          ? Array.from(record.root.adoptedStyleSheets).includes(record.sheet)
          : false;
        const connected = Boolean(record.host?.isConnected &&
          record.host.shadowRoot === record.root &&
          (adopted || record.node?.isConnected));
        if (connected) records.push(record);
        else detachShadowThemeRecord(record);
      }
      const roots = new Set(records.map((record) => record.root));
      const attach = (host, kind) => {
        const root = host?.shadowRoot;
        if (!root || roots.has(root)) return;
        const css = shadowThemeCss[kind];
        const canAdopt = typeof window.CSSStyleSheet === "function" &&
          typeof window.CSSStyleSheet.prototype?.replaceSync === "function" &&
          root.adoptedStyleSheets !== undefined;
        if (canAdopt) {
          const sheet = new window.CSSStyleSheet();
          sheet.replaceSync(css);
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
          records.push({ host, root, sheet, kind });
        } else {
          const node = document.createElement("style");
          node.dataset.openChatgptSkinShadow = kind;
          node.textContent = css;
          root.append(node);
          records.push({ host, root, node, kind });
        }
        roots.add(root);
      };
      for (const host of document.querySelectorAll("diffs-container")) {
        attach(host, "diffs");
      }
      for (const host of document.querySelectorAll("file-tree-container")) {
        attach(host, "tree");
      }
      window[shadowSheetsKey] = records;
    };
    const markSurfaces = () => {
      for (const node of document.querySelectorAll(surfaceSelector)) {
        node.removeAttribute("data-open-chatgpt-skin-surface");
      }
      for (const node of document.querySelectorAll(interfaceHostSelector)) {
        node.removeAttribute("data-open-chatgpt-skin-interface-host");
      }
      for (const node of document.querySelectorAll(nativeIconSelector)) {
        node.removeAttribute("data-open-chatgpt-skin-native-icon");
      }
      const usedInterfaceImages = new Set();
      const mark = (node, surface) => {
        if (node) node.dataset.openChatgptSkinSurface = surface;
        return node;
      };
      const syncInterfaceImage = (host, key, descriptor, nativeIcon, fallbackSize) => {
        if (!host || !descriptor) return;
        const dataUrl = descriptor.asset === "background"
          ? theme.backgroundDataUrl
          : theme.assetDataUrls[descriptor.asset];
        if (typeof dataUrl !== "string") return;
        host.dataset.openChatgptSkinInterfaceHost = key;
        if (nativeIcon) nativeIcon.dataset.openChatgptSkinNativeIcon = key;
        let overlay = Array.from(host.children).find((child) =>
          child.dataset?.openChatgptSkinInterfaceImage === key
        );
        if (!overlay) {
          overlay = document.createElement("span");
          overlay.dataset.openChatgptSkinInterfaceImage = key;
          overlay.setAttribute("aria-hidden", "true");
          host.append(overlay);
        }
        const hostRect = host.getBoundingClientRect();
        const nativeRect = nativeIcon?.getBoundingClientRect();
        const nativeSizeValid = nativeRect && nativeRect.width >= 6 && nativeRect.width <= 64 &&
          nativeRect.height >= 6 && nativeRect.height <= 64;
        const configuredSize = Number(descriptor.sizePx);
        const size = Number.isFinite(configuredSize) && configuredSize >= 6 &&
          configuredSize <= 64 ? configuredSize : null;
        const width = size || (nativeSizeValid ? nativeRect.width : fallbackSize);
        const height = size || (nativeSizeValid ? nativeRect.height : fallbackSize);
        const left = nativeSizeValid
          ? nativeRect.left - hostRect.left + (nativeRect.width - width) / 2
          : 12;
        const top = nativeSizeValid
          ? nativeRect.top - hostRect.top + (nativeRect.height - height) / 2
          : Math.max(2, (hostRect.height - height) / 2);
        Object.assign(overlay.style, {
          position: "absolute",
          left: String(left) + "px",
          top: String(top) + "px",
          width: String(width) + "px",
          height: String(height) + "px",
          zIndex: "2",
          pointerEvents: "none",
          borderRadius: key === "profile-avatar" ? "999px" : "6px",
          backgroundImage: "url(" + dataUrl + ")",
          backgroundPosition: String(descriptor.positionXPercent) + "% " +
            String(descriptor.positionYPercent) + "%",
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat"
        });
        overlay.dataset.openChatgptSkinSurface = key === "profile-avatar"
          ? "profile-avatar"
          : key.replace("suggestion-card", "suggestion-icon-");
        usedInterfaceImages.add(overlay);
      };
      const main = mark(document.querySelector(nativeSelectors.shellMain), "main");
      const sidebar = Array.from(document.querySelectorAll(nativeSelectors.sidebar))
        .filter((node) => visible(node) && (!main || !main.contains(node)) &&
          !insideOverlay(node))
        .map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
          nativeShell: node.matches("aside.app-shell-left-panel,.app-shell-left-panel"),
          semanticAside: node.tagName === "ASIDE",
        }))
        .sort((left, right) => Number(right.nativeShell) - Number(left.nativeShell) ||
          Number(right.semanticAside) - Number(left.semanticAside) ||
          right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0]?.node;
      mark(sidebar, "sidebar");
      const accountEntry = sidebar ? Array.from(sidebar.querySelectorAll("button,[role=button]"))
        .filter((node) => visible(node) && !insideOverlay(node))
        .map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
          semantic: /(?:account|profile|user|avatar|settings|账户|个人|头像|用户)/i.test([
            node.getAttribute("aria-label") || "",
            node.getAttribute("data-testid") || "",
            String(node.textContent || "").slice(0, 80)
          ].join(" "))
        }))
        .filter((entry) => {
          const sidebarRect = sidebar.getBoundingClientRect();
          return entry.rect.bottom > sidebarRect.top && entry.rect.top < sidebarRect.bottom;
        })
        .sort((left, right) => Number(right.semantic) - Number(left.semantic) ||
          right.rect.bottom - left.rect.bottom)[0] : null;
      const accountButton = accountEntry?.semantic ? accountEntry.node : null;
      const accountAvatar = accountButton ? Array.from(accountButton.querySelectorAll("img,svg,span"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return visible(node) && rect.width >= 6 && rect.width <= 64 &&
            rect.height >= 6 && rect.height <= 64;
        }).map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
          image: node.tagName === "IMG",
          round: /(?:rounded-full|avatar)/i.test(String(node.className || "")),
        })).sort((left, right) => Number(right.image) - Number(left.image) ||
          Number(right.round) - Number(left.round) || left.rect.left - right.rect.left)[0]?.node : null;
      syncInterfaceImage(
        accountButton,
        "profile-avatar",
        theme.interfaceImagery.profileAvatar,
        accountAvatar,
        24
      );
      const projectIcons = Array.isArray(theme.interfaceImagery.projectIcons)
        ? theme.interfaceImagery.projectIcons
        : [];
      if (sidebar && projectIcons.length > 0) {
        const sidebarRect = sidebar.getBoundingClientRect();
        const projectRows = Array.from(sidebar.querySelectorAll("[role=button][aria-label]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return visible(node) && String(node.className || "").includes("folder-row") &&
              rect.bottom > sidebarRect.top && rect.top < sidebarRect.bottom;
          });
        for (const [index, row] of projectRows.slice(0, 12).entries()) {
          const nativeIcon = Array.from(row.querySelectorAll("svg,img"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return visible(node) && rect.width >= 6 && rect.width <= 40 &&
                rect.height >= 6 && rect.height <= 40;
            })[0];
          const host = nativeIcon?.parentElement;
          if (!host || !nativeIcon) continue;
          syncInterfaceImage(
            host,
            "project-icon-" + String(index + 1),
            projectIcons[index % projectIcons.length],
            nativeIcon,
            16
          );
        }
      }
      const windowTitlebar = Array.from(document.body.querySelectorAll("header,div"))
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter((entry) => entry.rect.top >= -1 && entry.rect.top <= 2 &&
          entry.rect.height >= 24 && entry.rect.height <= 48 &&
          entry.rect.width >= window.innerWidth * 0.7)
        .sort((left, right) => right.rect.width - left.rect.width)[0]?.node;
      mark(windowTitlebar, "window-titlebar");
      const applicationMenu = Array.from(document.querySelectorAll(nativeSelectors.applicationMenu))
        .find((node) => visible(node));
      mark(applicationMenu, "application-menu");
      const modeSwitcher = Array.from(document.querySelectorAll(nativeSelectors.modeSwitcher))
        .find((node) => visible(node));
      mark(modeSwitcher, "mode-switcher");
      if (modeSwitcher) {
        const layers = Array.from(modeSwitcher.children)
          .filter((node) => node.tagName === "SPAN" && visible(node))
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .sort((left, right) => right.rect.width * right.rect.height -
            left.rect.width * left.rect.height);
        mark(layers[0]?.node, "mode-switcher-track");
        mark(layers[1]?.node, "mode-switcher-selection");
      }

      const currentPath = (() => {
        try { return new URL(window.location.href).pathname.toLowerCase(); }
        catch { return ""; }
      })();
      const routeSegments = currentPath.split("/");
      const taskPath = routeSegments
        .some((segment) => /^(?:tasks?|threads?|workspaces?)$/.test(segment));
      const settingsPath = routeSegments
        .some((segment) => /^(?:settings|preferences)$/.test(segment));
      const settingsPagePattern = new RegExp(
        ${JSON.stringify(SETTINGS_PAGE_PATTERN_SOURCE)}, "i"
      );
      const settingsPagePresent = ${SETTINGS_PAGE_DETECTION_EXPRESSION};

      const textbox = settingsPagePresent
        ? null
        : Array.from(document.querySelectorAll(
          ${JSON.stringify(TEXTBOX_SELECTOR)}
        )).filter((node) => visible(node) && !insideOverlay(node) &&
          !insideTerminal(node) && (!main || main.contains(node)))
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            nativeComposer: Boolean(node.closest(
              ".composer-surface-chrome,[class*='composer']," +
              "[data-testid*='composer'],[data-testid*='prompt']"
            )),
          }))
          .sort((left, right) => Number(right.nativeComposer) - Number(left.nativeComposer) ||
            right.rect.bottom - left.rect.bottom || right.rect.width - left.rect.width)[0]?.node || null;
      let composerInput = textbox;
      let composer = textbox;
      let composerChromeCandidates = [];
      if (textbox) {
        const textboxRect = textbox.getBoundingClientRect();
        const inputCandidates = [];
        const stackCandidates = [];
        const composerAncestors = [];
        let ancestor = textbox.parentElement;
        while (ancestor && ancestor !== main && ancestor !== document.body) {
          composerAncestors.push(ancestor);
          const rect = ancestor.getBoundingClientRect();
          const enclosesTextbox = rect.width >= textboxRect.width &&
            rect.height >= textboxRect.height;
          if (enclosesTextbox && rect.height <= 360 &&
            rect.width <= textboxRect.width * 1.35) stackCandidates.push(ancestor);
          if (enclosesTextbox && rect.height >= 40 && rect.height <= 220) {
            inputCandidates.push({
              node: ancestor,
              nativeComposer: typeof ancestor.className === "string" &&
                ancestor.className.includes("composer-surface-chrome"),
              hasControls: Boolean(ancestor.querySelector("button,[role=button]")),
              hasSurfaceBackground: hasSurfaceBackground(ancestor) ||
                (typeof ancestor.className === "string" &&
                  ancestor.className.includes("composer-surface-chrome"))
            });
          }
          ancestor = ancestor.parentElement;
        }
        const nativeWidthContainer = composerAncestors.find((node) =>
          typeof node.className === "string" &&
          (node.className.includes("thread-content-max-width") ||
            node.className.includes("max-w-(--thread-content"))
        );
        composerInput = inputCandidates.find((entry) => entry.nativeComposer)?.node ||
          inputCandidates.find((entry) => entry.hasSurfaceBackground)?.node ||
          inputCandidates.find((entry) => entry.hasControls)?.node ||
          inputCandidates[inputCandidates.length - 1]?.node || textbox;
        composer = nativeWidthContainer ||
          stackCandidates[stackCandidates.length - 1] || composerInput;
        composerChromeCandidates = stackCandidates.filter((node) =>
          node !== composer && node !== composerInput && hasSurfaceBackground(node)
        );
      }
      mark(composer, "composer");
      for (const node of composerChromeCandidates) mark(node, "composer-chrome");
      if (composerInput && composerInput !== composer) mark(composerInput, "composer-input");

      if (!main) return;

      const featureSearchInput = Array.from(main.querySelectorAll(
        'input[id$="-page-search"],input#appgen-site-search'
      ))
        .find((node) => visible(node));
      if (featureSearchInput) {
        const searchAncestors = [];
        let searchAncestor = featureSearchInput.parentElement;
        while (searchAncestor && searchAncestor !== main) {
          if (visible(searchAncestor)) searchAncestors.push(searchAncestor);
          searchAncestor = searchAncestor.parentElement;
        }
        const searchInputRect = featureSearchInput.getBoundingClientRect();
        const featureSearch = searchAncestors
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width >= searchInputRect.width && rect.height >= 24 &&
              rect.height <= 72 && hasSurfaceBackground(node);
          })
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
          })[0] || null;
        const featureToolbar = searchAncestors.find((node) => {
          const className = typeof node.className === "string" ? node.className : "";
          return /(?:^|\\s)sticky(?:\\s|$)/.test(className) ||
            window.getComputedStyle(node).position === "sticky";
        }) || null;
        const featureMainRect = main.getBoundingClientRect();
        const featureMainArea = featureMainRect.width * featureMainRect.height;
        const featurePage = searchAncestors
          .filter((node) => node !== featureSearch && node !== featureToolbar &&
            hasSurfaceBackground(node))
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .filter((entry) => entry.rect.width >= featureMainRect.width * 0.65 &&
            entry.rect.height >= featureMainRect.height * 0.4 &&
            entry.rect.width * entry.rect.height <= featureMainArea * 0.98)
          .sort((left, right) => right.rect.width * right.rect.height -
            left.rect.width * left.rect.height)[0]?.node || null;
        mark(featurePage, "feature-page");
        mark(featureToolbar, "feature-toolbar");
        mark(featureSearch, "feature-search");
      }

      const signature = (node) => [
        node.id,
        typeof node.className === "string" ? node.className : "",
        node.getAttribute("role") || "",
        node.getAttribute("aria-label") || "",
        node.getAttribute("data-testid") || "",
      ].join(" ").toLowerCase();
      const workspacePattern = /(?:workbench|workspace|review|terminal|browser|files|工作区|审阅|终端|浏览器|文件)/i;
      const isTerminalSurface = (node) => {
        if (!visible(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width >= 160 && rect.height >= 60;
      };
      const routeMains = Array.from(main.querySelectorAll(nativeSelectors.routeMain))
        .filter((node) => node !== main && visible(node));
      const chatGptLandingRoute = modeSwitcher && composer ? routeMains.find((node) => {
        if (!node.contains(composer)) return false;
        const routeRect = node.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        return composerRect.bottom <= routeRect.bottom - Math.max(96, routeRect.height * 0.15);
      }) : null;
      const homeRoute = routeMains.find((node) =>
        Boolean(node.querySelector(nativeSelectors.homeMarker))
      ) || chatGptLandingRoute;
      let taskRoute = settingsPagePresent ? null : routeMains
        .filter((node) => node !== homeRoute)
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
        })[0] || null;
      if (!settingsPagePresent && !homeRoute && !taskRoute &&
        !main.querySelector(nativeSelectors.homeMarker)) {
        const hasTaskTool = taskPath || Array.from(main.querySelectorAll(nativeSelectors.terminal))
          .some((node) => isTerminalSurface(node)) ||
          Array.from(main.querySelectorAll("[aria-label],[data-testid]"))
            .some((node) => workspacePattern.test(signature(node)));
        if (hasTaskTool) {
          const mainRect = main.getBoundingClientRect();
          taskRoute = Array.from(main.children)
            .filter((node) => {
              if (!visible(node) || node === composer || (composer && composer.contains(node))) {
                return false;
              }
              const rect = node.getBoundingClientRect();
              return rect.width >= mainRect.width * 0.7 && rect.height >= mainRect.height * 0.55;
            })
            .sort((left, right) => {
              const leftRect = left.getBoundingClientRect();
              const rightRect = right.getBoundingClientRect();
              return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
            })[0] || null;
        }
      }
      mark(taskRoute, "task");

      let settingsRoute = null;
      if (!taskRoute && !homeRoute && settingsPagePresent) {
        const mainRect = main.getBoundingClientRect();
        const mainArea = mainRect.width * mainRect.height;
        settingsRoute = Array.from(main.querySelectorAll(
          "main,section,article,aside,div,[role=region],[role=tabpanel],[aria-label]"
        )).filter((node) => {
          if (!visible(node) || node === main || node === composer ||
            (composer && node.contains(composer)) ||
            node.getAttribute("data-open-chatgpt-skin-surface")) return false;
          const rect = node.getBoundingClientRect();
          const area = rect.width * rect.height;
          const semantic = settingsPagePattern.test(signature(node));
          return rect.width >= mainRect.width * 0.55 &&
            rect.height >= mainRect.height * 0.45 &&
            area <= mainArea * 0.96 &&
            (semantic || (settingsPagePresent && hasSurfaceBackground(node)));
        }).map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
          semantic: settingsPagePattern.test(signature(node)),
          background: hasSurfaceBackground(node),
        })).sort((left, right) =>
          Number(right.background) - Number(left.background) ||
          Number(right.semantic) - Number(left.semantic) ||
          right.rect.width * right.rect.height - left.rect.width * left.rect.height
        )[0]?.node || null;
      }
      mark(settingsRoute, "settings");

      const settingsPanels = settingsRoute ? Array.from(settingsRoute.querySelectorAll(
        "section,article,aside,div,[role=region],[role=tabpanel],[aria-label]"
      )).filter((node) => {
        if (!visible(node) || node === settingsRoute || node === composer ||
          (composer && node.contains(composer)) ||
          node.getAttribute("data-open-chatgpt-skin-surface")) return false;
        const rootRect = settingsRoute.getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        return rect.width >= Math.max(180, rootRect.width * 0.45) &&
          rect.width <= rootRect.width * 0.98 && rect.height >= 56 &&
          (hasSurfaceBackground(node) || settingsPagePattern.test(signature(node)));
      }).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
      }).slice(0, 128) : [];
      for (const panel of settingsPanels) mark(panel, "settings-panel");

      const taskRoot = taskRoute || main;
      const terminalNodes = taskRoute
        ? Array.from(taskRoot.querySelectorAll(nativeSelectors.terminal))
          .filter((node) => isTerminalSurface(node))
        : [];
      for (const terminal of terminalNodes) mark(terminal, "terminal");

      const resourceCards = taskRoute ? Array.from(taskRoot.querySelectorAll(
        ${JSON.stringify(THREAD_RESOURCE_CARD_SELECTOR)}
      )).filter((node) => visible(node) && insideThreadConversation(node) &&
        node !== composer && (!composer || !composer.contains(node))) : [];
      for (const resourceCard of resourceCards) mark(resourceCard, "resource-card");

      const workspacePanels = taskRoute ? Array.from(taskRoot.querySelectorAll(
        "section,[role=region],[role=tabpanel],[aria-label]"
      )).filter((node) => {
        if (!visible(node) || node === taskRoute || node === composer ||
          (composer && node.contains(composer)) || insideThreadConversation(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width >= 180 && rect.height >= 80 && workspacePattern.test(signature(node));
      }) : [];
      for (const panel of workspacePanels) mark(panel, "workspace-panel");

      if (taskRoute) {
        const taskRect = taskRoute.getBoundingClientRect();
        const taskArea = taskRect.width * taskRect.height;
        const opaquePanels = Array.from(taskRoute.querySelectorAll("section,aside,div"))
          .filter((node) => {
            if (!visible(node) || node === taskRoute || node === composer ||
              (composer && node.contains(composer)) ||
              insideThreadConversation(node) ||
              node.getAttribute("data-open-chatgpt-skin-surface")) return false;
            const rect = node.getBoundingClientRect();
            const area = rect.width * rect.height;
            return rect.width >= Math.max(180, taskRect.width * 0.25) &&
              rect.height >= Math.max(80, taskRect.height * 0.16) &&
              area <= taskArea * 0.82 && hasSurfaceBackground(node);
          })
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
          })
          .slice(0, 8);
        for (const panel of opaquePanels) mark(panel, "workspace-panel");
      }

      if (!taskRoute && !settingsRoute && !main.querySelector(nativeSelectors.homeMarker)) {
        const mainRect = main.getBoundingClientRect();
        const mainArea = mainRect.width * mainRect.height;
        const secondaryPanels = Array.from(main.querySelectorAll(
          "section,aside,div[class*='bg-token-main-surface-primary']," +
          "[role=region],[role=tabpanel],[aria-label]"
        )).filter((node) => {
          if (!visible(node) || node === composer || (composer && node.contains(composer)) ||
            node.getAttribute("data-open-chatgpt-skin-surface")) return false;
          const rect = node.getBoundingClientRect();
          const area = rect.width * rect.height;
          return rect.width >= 180 && rect.height >= 64 && area <= mainArea * 0.98 &&
            (hasSurfaceBackground(node) || settingsPagePattern.test(signature(node)));
        }).sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
        }).slice(0, 12);
        for (const panel of secondaryPanels) mark(panel, "workspace-panel");
      }

      for (const terminal of terminalNodes) {
        let ancestor = terminal.parentElement;
        while (ancestor && ancestor !== taskRoot && ancestor !== main) {
          if (workspacePattern.test(signature(ancestor)) && visible(ancestor)) {
            mark(ancestor, "workspace-panel");
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }

      const markedPanels = Array.from(taskRoot.querySelectorAll(
        '[data-open-chatgpt-skin-surface="workspace-panel"]'
      ));
      const taskWorkbench = taskRoute ? Array.from(taskRoot.querySelectorAll("section,aside,div"))
        .filter((node) => node !== taskRoute && node !== composer && visible(node) &&
          !overlapsThreadConversation(node))
        .map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
          panels: markedPanels.filter((panel) => node.contains(panel)).length,
          semantic: /(?:workbench|workspace|工作区)/i.test(signature(node)),
        }))
        .filter((entry) => entry.semantic || entry.panels >= 2)
        .sort((left, right) => Number(right.semantic) - Number(left.semantic) ||
          right.panels - left.panels ||
          right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0]?.node : null;
      const auxiliaryMainRect = main.getBoundingClientRect();
      const auxiliaryMainArea = auxiliaryMainRect.width * auxiliaryMainRect.height;
      const auxiliaryWorkbench = !settingsPagePresent
        ? Array.from(main.querySelectorAll("aside"))
          .filter((node) => visible(node) && node !== composer &&
            (!composer || !node.contains(composer)) && !insideOverlay(node) &&
            Boolean(node.querySelector("[class*='bg-token-main-surface-primary']")))
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .filter(({ rect }) => {
            const area = rect.width * rect.height;
            return rect.width >= Math.max(180, auxiliaryMainRect.width * 0.25) &&
              rect.width <= auxiliaryMainRect.width * 0.85 &&
              rect.height >= auxiliaryMainRect.height * 0.55 &&
              area <= auxiliaryMainArea * 0.88 &&
              rect.left >= auxiliaryMainRect.left + auxiliaryMainRect.width * 0.15 &&
              rect.right >= auxiliaryMainRect.right - 8;
          })
          .sort((left, right) => right.rect.width * right.rect.height -
            left.rect.width * left.rect.height)[0]?.node || null
        : null;
      const workbench = taskWorkbench || auxiliaryWorkbench;
      mark(workbench, "workbench");

      for (const overlay of document.querySelectorAll(nativeSelectors.overlay)) {
        if (!visible(overlay)) continue;
        mark(overlay, "overlay");
        const overlayRect = overlay.getBoundingClientRect();
        for (const child of overlay.children) {
          if (!visible(child) || !hasSurfaceBackground(child)) continue;
          const childRect = child.getBoundingClientRect();
          if (childRect.width >= overlayRect.width * 0.8 &&
            childRect.height >= overlayRect.height * 0.5) {
            mark(child, "overlay");
          }
        }
      }

      if (composer && composerInput) {
        const composerRect = composer.getBoundingClientRect();
        const inputRect = composerInput.getBoundingClientRect();
        const statusBanners = Array.from(composer.querySelectorAll(
          "aside,[role=alert],[role=status]"
        )).filter((node) => node !== composerInput && !node.contains(composerInput) &&
          visible(node) && Boolean(node.querySelector("h1,h2,h3,h4,[role=heading]")));
        for (const banner of statusBanners) mark(banner, "status-banner");
        const projectPickerCandidates = Array.from(composer.querySelectorAll("*"))
          .filter((node) => node !== composerInput && !composerInput.contains(node) &&
            !node.contains(composerInput) && visible(node) &&
            !node.closest('[data-open-chatgpt-skin-surface="status-banner"]'))
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            hasSurfaceBackground: hasSurfaceBackground(node)
          }))
          .filter((entry) => entry.rect.top < inputRect.bottom &&
            entry.rect.bottom <= inputRect.bottom + 1 && entry.rect.height >= 24 &&
            entry.rect.height <= 80 && entry.rect.width >= composerRect.width * 0.55)
          .sort((left, right) => Number(right.hasSurfaceBackground) -
            Number(left.hasSurfaceBackground) ||
            left.rect.width * left.rect.height - right.rect.width * right.rect.height);
        const compactProjectControl = Array.from(composer.querySelectorAll(
          "button,[role=button]"
        )).filter((node) => visible(node) && /(?:switch project|project|项目)/i.test([
          node.getAttribute("aria-label") || "",
          node.getAttribute("data-testid") || "",
        ].join(" ")))[0];
        const projectPicker = projectPickerCandidates[0]?.node || compactProjectControl;
        let projectPickerStack = projectPicker;
        let projectPickerAncestor = projectPicker?.parentElement;
        while (projectPickerCandidates.length > 0 && projectPickerAncestor &&
          projectPickerAncestor !== composer &&
          !projectPickerAncestor.contains(composerInput)) {
          projectPickerStack = projectPickerAncestor;
          projectPickerAncestor = projectPickerAncestor.parentElement;
        }
        mark(projectPickerStack, "project-picker-stack");
        mark(projectPicker, "project-picker");
      }

      const buttons = Array.from(main.querySelectorAll("button,[role=button]"))
        .filter((node) => visible(node) && (!composer || !composer.contains(node)));
      const interactiveCards = buttons.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 64;
      });
      const groups = new Map();
      for (const card of interactiveCards) {
        let ancestor = card.parentElement;
        while (ancestor && ancestor !== main) {
          const entry = groups.get(ancestor) || { count: 0, cards: [] };
          entry.count += 1;
          entry.cards.push(card);
          groups.set(ancestor, entry);
          ancestor = ancestor.parentElement;
        }
      }
      for (const parent of main.querySelectorAll("*")) {
        const cards = Array.from(parent.children).filter((child) => {
          const rect = child.getBoundingClientRect();
          return visible(child) && rect.width >= 100 && rect.height >= 50;
        });
        if (cards.length < 3 || cards.length > 8) continue;
        const existing = groups.get(parent);
        if (!existing || existing.count < cards.length) {
          groups.set(parent, { count: cards.length, cards });
        }
      }
      const suggestionsEntry = taskRoute || settingsRoute ? null : Array.from(groups.entries())
        .filter(([, entry]) => entry.count >= 3 && entry.count <= 8)
        .map(([node, entry]) => ({
          node,
          cards: entry.cards,
          rect: node.getBoundingClientRect()
        }))
        .filter((entry) => entry.rect.width >= 360 && entry.rect.height >= 64 &&
          entry.rect.height <= 480 && (!composer || !entry.node.contains(composer)))
        .sort((left, right) =>
          left.rect.width * left.rect.height - right.rect.width * right.rect.height
        )[0];
      const suggestions = suggestionsEntry?.node;
      if (suggestionsEntry) {
        mark(suggestionsEntry.node, "suggestions");
        const suggestionCards = suggestionsEntry.cards.slice(0, 8).sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
        });
        for (const card of suggestionCards) {
          mark(card, "card");
        }
        for (const [index, card] of suggestionCards.slice(0, 4).entries()) {
          const nativeIcon = Array.from(card.querySelectorAll("svg,img"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return visible(node) && rect.width >= 6 && rect.width <= 64 &&
                rect.height >= 6 && rect.height <= 64;
            })[0];
          const key = "suggestion-card" + String(index + 1);
          syncInterfaceImage(
            card,
            key,
            theme.interfaceImagery.suggestionIcons["card" + String(index + 1)],
            nativeIcon,
            20
          );
        }
      }

      const heading = taskRoute || settingsRoute
        ? null
        : resolveHomeHeading(main, composer, suggestions, visible);
      let hero = heading;
      if (heading) {
        const heroCandidates = [];
        let ancestor = heading.parentElement;
        while (ancestor && ancestor !== main) {
          const rect = ancestor.getBoundingClientRect();
          if (visible(ancestor) && rect.height <= 480 &&
            (!suggestions || !ancestor.contains(suggestions)) &&
            (!composer || !ancestor.contains(composer))) {
            heroCandidates.push(ancestor);
          }
          ancestor = ancestor.parentElement;
        }
        hero = heroCandidates[heroCandidates.length - 1] || heading;
      }
      mark(hero, "hero");
      const activeHome = Boolean(homeRoute || main.querySelector(nativeSelectors.homeMarker)) &&
        !taskPath && !settingsPath && !taskRoute && !settingsRoute;
      mark(activeHome ? homeRoute : null, "home-route");
      mark(activeHome ? heading : null, "home-heading");
      syncWelcome(
        main,
        hero,
        heading,
        activeHome,
      );
      syncCompositionLayers(main, hero, suggestions, activeHome);

      const mainRect = main.getBoundingClientRect();
      const explicitTopbar = Array.from(main.querySelectorAll(
        "header.app-header-tint,header,[class~='app-header-tint']"
      )).filter((node) => visible(node) && !insideOverlay(node) &&
        node !== composer && (!composer || !node.contains(composer)))
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter((entry) => entry.rect.width >= mainRect.width * 0.5 &&
          entry.rect.height >= 24 && entry.rect.height <= 96 &&
          entry.rect.top >= mainRect.top - 2 &&
          entry.rect.top <= mainRect.top + 120)
        .sort((left, right) => left.rect.top - right.rect.top ||
          right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0]?.node;
      const topbar = explicitTopbar || Array.from(main.children)
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0 &&
          entry.rect.height <= 96 && entry.rect.top >= mainRect.top - 2 &&
          entry.rect.top <= mainRect.top + 96)
        .sort((left, right) => left.rect.top - right.rect.top)[0]?.node;
      if (topbar && topbar !== hero && topbar !== suggestions && topbar !== composer) {
        mark(topbar, "topbar");
      }
      const explicitScrollFades = Array.from(main.querySelectorAll(nativeSelectors.scrollFade));
      const topFade = main.querySelector(".app-shell-main-content-top-fade") ||
        Array.from(main.querySelectorAll("div"))
          .map((node) => ({
            node,
            rect: node.getBoundingClientRect(),
            backgroundImage: window.getComputedStyle(node).backgroundImage
          }))
          .find((entry) => entry.rect.width >= mainRect.width * 0.75 &&
            entry.rect.height > 0 && entry.rect.height <= 32 &&
            entry.rect.top >= mainRect.top && entry.rect.top <= mainRect.top + 120 &&
            typeof entry.backgroundImage === "string" &&
            entry.backgroundImage.includes("gradient"))?.node;
      mark(topFade, "top-fade");
      for (const fade of explicitScrollFades) {
        const interactive = fade.matches(
          "button,[role=button],input,textarea,[contenteditable=true]"
        ) || Boolean(fade.querySelector(
          "button,[role=button],input,textarea,[contenteditable=true]"
        ));
        if (fade !== topFade && !interactive) mark(fade, "scroll-fade");
      }
      const scrollFadePattern = /(?:fade|gradient|mask|scroll-shadow)/i;
      const composerFadeMinimumWidth = composer
        ? composer.getBoundingClientRect().width * 0.75
        : Number.POSITIVE_INFINITY;
      const gradientScrollFades = Array.from(main.querySelectorAll("div"))
        .map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
          backgroundImage: window.getComputedStyle(node).backgroundImage,
          insideComposer: Boolean(composer && composer.contains(node)),
          signature: [
            node.id,
            typeof node.className === "string" ? node.className : "",
            node.getAttribute("data-testid") || "",
          ].join(" "),
        }))
        .filter((entry) => entry.node !== topFade &&
          !entry.node.getAttribute("data-open-chatgpt-skin-surface") &&
          !entry.node.matches("button,[role=button],input,textarea,[contenteditable=true]") &&
          !entry.node.querySelector("button,[role=button],input,textarea,[contenteditable=true]") &&
          (entry.rect.width >= mainRect.width * 0.5 ||
            (entry.insideComposer && entry.rect.width >= composerFadeMinimumWidth)) &&
          entry.rect.height > 0 && entry.rect.height <= 120 &&
          typeof entry.backgroundImage === "string" &&
          entry.backgroundImage.includes("gradient") &&
          scrollFadePattern.test(entry.signature))
        .slice(0, 8);
      for (const entry of gradientScrollFades) mark(entry.node, "scroll-fade");

      syncReviewShadowThemes();

      for (const overlay of document.querySelectorAll(interfaceImageSelector)) {
        if (!usedInterfaceImages.has(overlay)) overlay.remove();
      }

      if (hero && suggestions && composer) {
        const currentRelief = Number.parseFloat(
          document.documentElement.style.getPropertyValue(overlapReliefProperty)
        ) || 0;
        const heroRect = hero.getBoundingClientRect();
        const suggestionsRect = suggestions.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const baseOverlap = suggestionsRect.bottom + 16 - composerRect.top + currentRelief;
        const baseHeroHeight = heroRect.height + currentRelief;
        const maximumRelief = Math.max(0, baseHeroHeight - 180);
        const relief = Math.ceil(Math.min(Math.max(0, baseOverlap), maximumRelief));
        if (Math.abs(relief - currentRelief) >= 1) {
          document.documentElement.style.setProperty(
            overlapReliefProperty,
            String(relief) + "px"
          );
        }
      } else if (document.documentElement.style.getPropertyValue(overlapReliefProperty)) {
        document.documentElement.style.removeProperty(overlapReliefProperty);
      }
    };

    const image = new window.Image();
    image.src = theme.backgroundDataUrl;
    if (typeof image.decode === "function") {
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = () => resolve(undefined);
        image.onerror = () => reject(new Error("background image failed to load"));
      });
    }

    const style = document.createElement("style");
    style.dataset.openChatgptSkin = "theme";
    style.dataset.openChatgptSkinOwner = theme.themeId;
    style.dataset.openChatgptSkinBackgroundReady = "true";
    style.__openChatgptSkinVerificationRecord = verificationRecord;
    style.textContent = ":root{--ocs-background-image:url(" + theme.backgroundDataUrl + ")}" +
      theme.themeCss;
    document.head.append(style);

    if (theme.fontCss) {
      const fonts = document.createElement("style");
      fonts.dataset.openChatgptSkin = "fonts";
      fonts.textContent = theme.fontCss;
      document.head.append(fonts);
    }

    const decorationPosition = (placement, index) => {
      if (placement === "corners") {
        const corners = [[4, 4], [92, 4], [4, 88], [92, 88]];
        const corner = corners[index % corners.length];
        return { left: corner[0] + "%", top: corner[1] + "%" };
      }
      if (placement === "hero") {
        return { left: String(12 + ((index * 19) % 76)) + "%", top: String(8 + ((index * 7) % 18)) + "%" };
      }
      if (placement === "cards") {
        return { left: String(8 + ((index * 29) % 80)) + "%", top: String(28 + ((index * 17) % 56)) + "%" };
      }
      return { left: String((index * 37) % 100) + "%", top: String((index * 61) % 100) + "%" };
    };

    const decorations = document.createElement("div");
    decorations.dataset.openChatgptSkin = "decorations";
    Object.assign(decorations.style, {
      position: "fixed",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "-1",
      contain: "strict"
    });

    for (const descriptor of theme.decorations) {
      for (let index = 0; index < descriptor.count; index += 1) {
        const item = document.createElement("span");
        item.dataset.openChatgptSkinDecoration = descriptor.kind;
        Object.assign(item.style, {
          position: "absolute",
          pointerEvents: "none",
          zIndex: "-1",
          opacity: String(descriptor.opacity),
          width: String(8 * descriptor.scale) + "px",
          height: String(8 * descriptor.scale) + "px",
          borderRadius: "999px",
          background: "var(--ocs-secondary)",
          ...decorationPosition(descriptor.placement, index)
        });
        if (descriptor.asset !== undefined) {
          const dataUrl = theme.assetDataUrls[descriptor.asset];
          if (typeof dataUrl !== "string") continue;
          Object.assign(item.style, {
            backgroundImage: "url(" + dataUrl + ")",
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            backgroundColor: "transparent"
          });
        }
        decorations.append(item);
      }
    }

    document.body.append(decorations);
    markSurfaces();
    window[markerKey] = markSurfaces;
    window[refreshListenerKey] = markSurfaces;
    window.addEventListener("resize", markSurfaces);
    window.addEventListener("scroll", markSurfaces, true);
    const observer = new window.MutationObserver(() => markSurfaces());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden"]
    });
    window[observerKey] = observer;
    return true;
  })()`;
}

export const VERIFY_EXPRESSION = `(() => {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const marker = window[${JSON.stringify(SURFACE_MARKER_KEY)}];
  if (typeof marker === "function") marker();
  const shadowRecords = Array.isArray(window[${JSON.stringify(SHADOW_SHEETS_KEY)}])
    ? window[${JSON.stringify(SHADOW_SHEETS_KEY)}]
    : [];
  const themedShadowRoots = new Set(shadowRecords.map((record) => record.root));
  const reviewShadowHosts = Array.from(document.querySelectorAll(
    "diffs-container,file-tree-container"
  )).filter((host) => visible(host));
  const main = document.querySelector("main,[role=main]");
  const composerVisible = ${VISIBLE_COMPOSER_EXPRESSION};
  const decorations = document.querySelector('[data-open-chatgpt-skin="decorations"]');
  const theme = document.querySelector('[data-open-chatgpt-skin="theme"]');
  const verificationRecord = theme?.__openChatgptSkinVerificationRecord;
  const managedLayers = Array.from(document.querySelectorAll(
    '[data-open-chatgpt-skin-layer-id]'
  ));
  const welcomeNodes = Array.from(document.querySelectorAll(
    '[data-open-chatgpt-skin="welcome"]'
  ));
  const welcomeValid = Boolean(verificationRecord?.welcomeSupported) &&
    (verificationRecord.welcomeExpected
      ? welcomeNodes.length === 1 &&
        welcomeNodes[0].dataset.openChatgptSkinOwner === verificationRecord.themeId &&
        welcomeNodes[0].style.pointerEvents === "none" &&
        welcomeNodes[0].__openChatgptSkinWelcomeRecord?.heading?.style?.visibility === "hidden"
      : welcomeNodes.length === 0);
  const requiredLayersResolved = Boolean(verificationRecord?.requiredLayersResolved) &&
    verificationRecord.requiredLayerIds.every((layerId) => managedLayers.filter((layer) =>
      layer.dataset.openChatgptSkinLayerId === layerId &&
      layer.closest('[data-open-chatgpt-skin="composition-layer"]')
        ?.dataset.openChatgptSkinOwner === verificationRecord.themeId
    ).length === 1);
  const mainSurface = document.querySelector('[data-open-chatgpt-skin-surface="main"]');
  const sidebarSurface = document.querySelector('[data-open-chatgpt-skin-surface="sidebar"]');
  const composerSurface = document.querySelector('[data-open-chatgpt-skin-surface="composer"]');
  const composerInputSurface = document.querySelector(
    '[data-open-chatgpt-skin-surface="composer-input"]'
  );
  const composerRect = (composerInputSurface || composerSurface)
    ? (composerInputSurface || composerSurface).getBoundingClientRect()
    : null;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const composerOptional = ${SETTINGS_PAGE_DETECTION_EXPRESSION};
  return {
    themeMarkers: document.querySelectorAll('[data-open-chatgpt-skin="theme"]').length,
    welcomeValid,
    requiredLayersResolved,
    managedLayerCount: managedLayers.length,
    fontMarkers: document.querySelectorAll('[data-open-chatgpt-skin="fonts"]').length,
    decorationMarkers: document.querySelectorAll('[data-open-chatgpt-skin="decorations"]').length,
    backgroundReady: Boolean(theme && theme.dataset.openChatgptSkinBackgroundReady === "true"),
    decorationPointerEvents: decorations ? window.getComputedStyle(decorations).pointerEvents : null,
    surfaceMarkers: document.querySelectorAll('[data-open-chatgpt-skin-surface]').length,
    mainSurfaceReady: Boolean(mainSurface),
    sidebarSurfaceReady: Boolean(sidebarSurface),
    composerSurfaceReady: Boolean(composerSurface) || composerOptional,
    composerWithinViewport: composerOptional || (Boolean(composerRect) &&
      (!Number.isFinite(viewportHeight) || viewportHeight <= 0 ||
        (composerRect.top >= 0 && composerRect.bottom <= viewportHeight))),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    mainVisible: Boolean(main),
    composerVisible: composerVisible || composerOptional,
    reviewShadowReady: reviewShadowHosts.every((host) =>
      Boolean(host.shadowRoot && themedShadowRoots.has(host.shadowRoot))
    )
  };
})()`;

export const VERIFY_OFFICIAL_EXPRESSION = `(() => {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const composerOptional = ${SETTINGS_PAGE_DETECTION_EXPRESSION};
  const countShadowStyles = (root) => {
    let count = 0;
    for (const node of root.querySelectorAll("*")) {
      const shadow = node.shadowRoot;
      if (!shadow) continue;
      count += shadow.querySelectorAll('style[data-open-chatgpt-skin-shadow]').length;
      count += countShadowStyles(shadow);
    }
    return count;
  };
  const shadowRecords = Array.isArray(window[${JSON.stringify(SHADOW_SHEETS_KEY)}])
    ? window[${JSON.stringify(SHADOW_SHEETS_KEY)}].length
    : 0;
  return {
    managedMarkers: document.querySelectorAll("[data-open-chatgpt-skin]").length +
      document.querySelectorAll('[data-open-chatgpt-skin-surface]').length +
      countShadowStyles(document) + shadowRecords,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    mainVisible: visible(document.querySelector("main,[role=main]")),
    navigationVisible: visible(document.querySelector("nav,aside,[role=navigation]")),
    composerVisible: ${VISIBLE_COMPOSER_EXPRESSION} || composerOptional
  };
})()`;
