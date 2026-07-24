import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  CurrentCodexAdapter,
  waitForCompatibleAdapter,
  type CdpRuntimeClient,
} from "@open-chatgpt-skin/cdp-adapter";

interface ClientOptions {
  readonly backgroundDecodeFails?: boolean;
  readonly mutationController?: {
    flush?: () => void;
    disconnectCalls?: number;
    observerOptions?: MutationObserverInit;
  };
}

function clientFor(
  url: string,
  html: string,
  options: ClientOptions = {},
): CdpRuntimeClient {
  const { document, window } = parseHTML(html);
  const runtimeWindow = Object.create(window) as Window;
  Object.defineProperty(runtimeWindow, "location", {
    configurable: false,
    value: { href: url },
  });
  Object.defineProperty(runtimeWindow, "getComputedStyle", {
    configurable: false,
    value: (node: HTMLElement) => ({
      pointerEvents: node.style.pointerEvents,
      backgroundColor: node.style.backgroundColor || "rgba(0, 0, 0, 0)",
      backgroundImage: node.style.backgroundImage || "none",
      fontSize: node.dataset.fontSize ?? (node.tagName === "H1" ? "32px" : "14px"),
    }),
  });
  class TestImage {
    src = "";

    constructor(private readonly fail: boolean) {}

    decode(): Promise<void> {
      return this.fail
        ? Promise.reject(new Error("decode failed"))
        : Promise.resolve();
    }
  }
  Object.defineProperty(runtimeWindow, "Image", {
    configurable: false,
    value: class extends TestImage {
      constructor() { super(options.backgroundDecodeFails ?? false); }
    },
  });
  Object.defineProperty(runtimeWindow, "MutationObserver", {
    configurable: false,
    value: class TestMutationObserver {
      constructor(callback: () => void) {
        if (options.mutationController) {
          options.mutationController.flush = callback;
        }
      }

      observe(_target: Node, observerOptions: MutationObserverInit): void {
        if (options.mutationController) {
          options.mutationController.observerOptions = observerOptions;
        }
      }

      disconnect(): void {
        if (options.mutationController) {
          options.mutationController.disconnectCalls =
            (options.mutationController.disconnectCalls ?? 0) + 1;
        }
      }
    },
  });
  for (const node of document.querySelectorAll<HTMLElement>("[data-rect]")) {
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => {
        const [left, top, width, height] = (node.dataset.rect ?? "0,0,0,0")
          .split(",")
          .map(Number);
        const relief = Number.parseFloat(document.documentElement.style
          .getPropertyValue("--ocs-home-overlap-relief")) || 0;
        const adjustedTop = node.id === "native-suggestions" ? top - relief : top;
        const adjustedHeight = node.id === "native-hero"
          ? Math.max(180, height - relief)
          : height;
        return {
          width,
          height: adjustedHeight,
          top: adjustedTop,
          left,
          right: left + width,
          bottom: adjustedTop + adjustedHeight,
        };
      },
    });
  }

  return {
    evaluate: async <T>(expression: string) => Function(
      "document",
      "window",
      `return (${expression});`,
    )(document, runtimeWindow) as T,
  };
}

function compiledTheme() {
  return {
    themeId: "mountain-mist",
    themeVersion: "1.0.0",
    backgroundDataUrl: "data:image/webp;base64,AA==",
    themeCss: ":root{--ocs-accent:#4f8f78}body{background-image:var(--ocs-background-image)}",
    fontCss: "",
    assetDataUrls: [],
    interfaceImagery: {
      profileAvatar: {
        asset: "background" as const,
        positionXPercent: 50,
        positionYPercent: 35,
      },
      suggestionIcons: {
        card1: { asset: "background" as const, positionXPercent: 20, positionYPercent: 25 },
        card2: { asset: "background" as const, positionXPercent: 80, positionYPercent: 25 },
        card3: { asset: "background" as const, positionXPercent: 20, positionYPercent: 75 },
        card4: { asset: "background" as const, positionXPercent: 80, positionYPercent: 75 },
      },
    },
    layout: {
      heroHeight: 380,
      cardColumns: 4,
      composerWidth: 0.72,
      sidebarDensity: "comfortable" as const,
      moduleGap: 16,
      modules: [
        { id: "sidebar" as const, order: 0, visible: true, size: "regular" as const, align: "stretch" as const, spacing: 12 },
        { id: "topbar" as const, order: 1, visible: true, size: "regular" as const, align: "stretch" as const, spacing: 12 },
        { id: "hero" as const, order: 2, visible: true, size: "expanded" as const, align: "stretch" as const, spacing: 16 },
        { id: "suggestions" as const, order: 3, visible: true, size: "regular" as const, align: "stretch" as const, spacing: 16 },
        { id: "project-picker" as const, order: 4, visible: true, size: "regular" as const, align: "stretch" as const, spacing: 16 },
        { id: "composer" as const, order: 5, visible: true, size: "regular" as const, align: "center" as const, spacing: 12 },
        { id: "task-background" as const, order: 6, visible: true, size: "regular" as const, align: "stretch" as const, spacing: 0 },
        { id: "content-layer" as const, order: 7, visible: true, size: "regular" as const, align: "stretch" as const, spacing: 12 },
      ],
    },
    decorations: [{
      kind: "particles" as const,
      count: 4,
      opacity: 0.2,
      scale: 1,
      placement: "background" as const,
    }],
    compositionLayers: [],
    totalBytes: 100,
  };
}

function compiledWelcomeTheme() {
  return {
    ...compiledTheme(),
    welcome: {
      localized: {
        "zh-CN": [
          [
            { kind: "text" as const, value: "在「" },
            { kind: "projectName" as const },
            { kind: "text" as const, value: "」中，" },
          ],
          [{ kind: "text" as const, value: "你想一起打造什么呢？" }],
        ],
      },
      displayFamily: "Noto Serif SC",
      displaySizePx: 42,
      displayWeight: 500,
      displayLineHeight: 1.45,
      displayLetterSpacingEm: 0.04,
      layout: {
        anchor: "top-left" as const,
        positionXPercent: 6,
        positionYPercent: 46,
        widthPercent: 76,
        textAlign: "left" as const,
      },
    },
  };
}

function compiledInterfaceTheme() {
  const base = compiledTheme();
  return {
    ...base,
    assetDataUrls: [
      "data:image/webp;base64,AQ==",
      "data:image/webp;base64,Ag==",
      "data:image/webp;base64,Aw==",
      "data:image/webp;base64,BA==",
    ],
    interfaceImagery: {
      profileAvatar: {
        ...base.interfaceImagery.profileAvatar,
        sizePx: 24,
      },
      suggestionIcons: Object.fromEntries(Object.entries(base.interfaceImagery.suggestionIcons)
        .map(([slot, image], index) => [slot, {
          ...image,
          asset: index,
          sizePx: 36,
        }])),
      projectIcons: [0, 1, 2, 3].map((asset) => ({
        asset,
        positionXPercent: 50,
        positionYPercent: 50,
        sizePx: 20,
      })),
    },
  };
}

function compiledLayerTheme() {
  return {
    ...compiledWelcomeTheme(),
    assetDataUrls: ["data:image/webp;base64,AA=="],
    compositionLayers: [{
      id: "hero-signature",
      asset: 0,
      surface: "home-hero" as const,
      anchor: "top-left" as const,
      positionXPercent: 10,
      positionYPercent: 8,
      widthPercent: 22,
      opacity: 1,
      rotationDeg: -3,
      required: true,
    }],
  };
}

describe("CurrentCodexAdapter", () => {
  it("uses the visible application language when html lang is stale", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="en">')
      .replace("Tasks", "新建任务")
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const client = clientFor("app://-/index.html", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledWelcomeTheme());

    await expect(client.evaluate(
      'document.querySelector(\'[data-open-chatgpt-skin="welcome"]\')?.textContent ?? null',
    )).resolves.toBe("在「DataMate」中，你想一起打造什么呢？");
  });

  it("renders localized welcome with the real project name", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledWelcomeTheme());

    await expect(client.evaluate(`(() => ({
      welcome: document.querySelector('[data-open-chatgpt-skin="welcome"]')?.textContent ?? null,
      nativeVisibility: document.querySelector('#native-hero h1')?.style.visibility ?? null,
      left: document.querySelector('[data-open-chatgpt-skin="welcome"]')?.style.left ?? null,
      top: document.querySelector('[data-open-chatgpt-skin="welcome"]')?.style.top ?? null,
      width: document.querySelector('[data-open-chatgpt-skin="welcome"]')?.style.width ?? null,
      textAlign: document.querySelector('[data-open-chatgpt-skin="welcome"]')?.style.textAlign ?? null,
    }))()`)).resolves.toEqual({
      welcome: "在「DataMate」中，你想一起打造什么呢？",
      nativeVisibility: "hidden",
      left: "428px",
      top: "182.8px",
      width: "608px",
      textAlign: "left",
    });
  });

  it("supports the current nested home title without semantic heading tags", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace(
        '<h1 data-rect="500,180,560,48">What should we build?</h1>',
        '<div class="heading-xl" data-font-size="28px" data-rect="500,180,560,48">' +
          '<span class="group/title" data-font-size="28px" ' +
            'data-rect="500,180,560,48">What should we build in ' +
            '<button data-font-size="28px" data-rect="720,180,120,48">DataMate</button>?</span>' +
        '</div>',
      )
      .replace("Example workspace", "DataMate");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await expect(adapter.preflight(compiledWelcomeTheme())).resolves.toEqual({
      valid: true,
      welcomeSupported: true,
      requiredLayersResolved: true,
    });
    await adapter.apply(compiledWelcomeTheme());

    await expect(client.evaluate(`(() => ({
      welcome: document.querySelector('[data-open-chatgpt-skin="welcome"]')?.textContent ?? null,
      nativeVisibility: document.querySelector('.heading-xl')?.style.visibility ?? null,
    }))()`)).resolves.toEqual({
      welcome: "在「DataMate」中，你想一起打造什么呢？",
      nativeVisibility: "hidden",
    });
  });

  it("keeps the native heading when the project name is unavailable", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledWelcomeTheme());

    await expect(client.evaluate(`(() => ({
      welcome: document.querySelector('[data-open-chatgpt-skin="welcome"]'),
      nativeVisibility: document.querySelector('#native-hero h1')?.style.visibility ?? null,
    }))()`)).resolves.toEqual({
      welcome: null,
      nativeVisibility: "",
    });
  });

  it("renders one non-interactive exact layer after repeated reconciliation", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex", html, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledLayerTheme());
    mutationController.flush?.();
    mutationController.flush?.();
    await client.evaluate(`(() => {
      document.querySelector('#native-hero').dataset.rect = "410,120,760,180";
      window.dispatchEvent(new window.Event("resize"));
    })()`);

    await expect(client.evaluate(`(() => {
      const host = document.querySelector('[data-open-chatgpt-skin="composition-layer"]');
      const layer = host?.querySelector('[data-open-chatgpt-skin-layer-id="hero-signature"]');
      return {
        hosts: document.querySelectorAll('[data-open-chatgpt-skin="composition-layer"]').length,
        layers: document.querySelectorAll('[data-open-chatgpt-skin-layer-id]').length,
        owner: host?.dataset.openChatgptSkinOwner ?? null,
        hostPointerEvents: host?.style.pointerEvents ?? null,
        layerPointerEvents: layer?.style.pointerEvents ?? null,
        ariaHidden: layer?.getAttribute('aria-hidden') ?? null,
        tabIndex: layer?.tabIndex ?? null,
        width: layer?.style.width ?? null,
        transform: layer?.style.transform ?? null,
        hostLeft: host?.style.left ?? null,
        hostTop: host?.style.top ?? null,
      };
    })()`)).resolves.toEqual({
      hosts: 1,
      layers: 1,
      owner: "mountain-mist",
      hostPointerEvents: "none",
      layerPointerEvents: "none",
      ariaHidden: "true",
      tabIndex: -1,
      width: "22%",
      transform: "translate(0%, 0%) rotate(-3deg)",
      hostLeft: "410px",
      hostTop: "120px",
    });
  });

  it("verifies the managed welcome and required exact layers", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const adapter = new CurrentCodexAdapter(clientFor("https://chatgpt.com/codex", html));

    await adapter.apply(compiledLayerTheme());

    await expect(adapter.verify()).resolves.toMatchObject({
      valid: true,
      welcomeValid: true,
      requiredLayersResolved: true,
      managedLayerCount: 1,
    });
  });

  it("repairs managed welcome text drift before verification", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledWelcomeTheme());
    await client.evaluate(`document.querySelector(
      '[data-open-chatgpt-skin="welcome"] > div'
    ).textContent = "tampered"`);

    await expect(adapter.verify()).resolves.toMatchObject({
      valid: true,
      welcomeValid: true,
    });
    await expect(client.evaluate(
      'document.querySelector("[data-open-chatgpt-skin=welcome]")?.textContent',
    )).resolves.toBe("在「DataMate」中，你想一起打造什么呢？");
  });

  it("removes welcome and exact layers while restoring the native heading", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledLayerTheme());
    await adapter.remove();

    await expect(client.evaluate(`(() => ({
      managedContent: document.querySelectorAll(
        '[data-open-chatgpt-skin="welcome"], [data-open-chatgpt-skin="composition-layer"]'
      ).length,
      nativeVisibility: document.querySelector('#native-hero h1')?.style.visibility ?? null,
    }))()`)).resolves.toEqual({
      managedContent: 0,
      nativeVisibility: "",
    });
  });

  it("preflights a candidate without mutating the active theme", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());
    const before = await client.evaluate(`(() => ({
      managed: document.querySelectorAll('[data-open-chatgpt-skin]').length,
      owner: document.querySelector('[data-open-chatgpt-skin="theme"]')
        ?.dataset.openChatgptSkinOwner ?? null,
      nativeVisibility: document.querySelector('#native-hero h1')?.style.visibility ?? null,
    }))()`);

    await expect(adapter.preflight(compiledLayerTheme())).resolves.toEqual({
      valid: true,
      welcomeSupported: true,
      requiredLayersResolved: true,
    });
    await expect(client.evaluate(`(() => ({
      managed: document.querySelectorAll('[data-open-chatgpt-skin]').length,
      owner: document.querySelector('[data-open-chatgpt-skin="theme"]')
        ?.dataset.openChatgptSkinOwner ?? null,
      nativeVisibility: document.querySelector('#native-hero h1')?.style.visibility ?? null,
    }))()`)).resolves.toEqual(before);
  });

  it("reports an unsupported welcome when the active home heading is ambiguous", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace(
        '<h1 data-rect="500,180,560,48">What should we build?</h1>',
        '<h1 data-rect="500,180,560,48">What should we build?</h1>' +
          '<h2 data-rect="500,230,560,40">Another home heading</h2>',
      )
      .replace("Example workspace", "DataMate");
    const adapter = new CurrentCodexAdapter(clientFor("https://chatgpt.com/codex", html));

    await expect(adapter.preflight(compiledWelcomeTheme())).resolves.toEqual({
      valid: false,
      welcomeSupported: false,
      requiredLayersResolved: true,
    });
  });

  it("reports an unresolved required layer on an applicable missing surface", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace(/<section id="native-suggestions"[\s\S]*?<\/section>/, "")
      .replace("Example workspace", "DataMate");
    const adapter = new CurrentCodexAdapter(clientFor("https://chatgpt.com/codex", html));
    const theme = {
      ...compiledLayerTheme(),
      compositionLayers: [{
        ...compiledLayerTheme().compositionLayers[0],
        surface: "suggestions" as const,
      }],
    };

    await expect(adapter.preflight(theme)).resolves.toEqual({
      valid: false,
      welcomeSupported: true,
      requiredLayersResolved: false,
    });
  });

  it("rejects and cleans a candidate whose required layer cannot be verified", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace(/<section id="native-suggestions"[\s\S]*?<\/section>/, "")
      .replace("Example workspace", "DataMate");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);
    const theme = {
      ...compiledLayerTheme(),
      compositionLayers: [{
        ...compiledLayerTheme().compositionLayers[0],
        surface: "suggestions" as const,
      }],
    };

    await expect(adapter.apply(theme)).rejects.toMatchObject({
      code: "THEME_REQUIRED_LAYER_UNRESOLVED",
    });
    await expect(client.evaluate(
      'document.querySelectorAll("[data-open-chatgpt-skin]").length',
    )).resolves.toBe(0);
  });

  it("rejects and cleans a candidate when the active home welcome is ambiguous", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace(
        '<h1 data-rect="500,180,560,48">What should we build?</h1>',
        '<h1 data-rect="500,180,560,48">What should we build?</h1>' +
          '<h1 data-rect="500,230,560,40">Another home heading</h1>',
      )
      .replace("Example workspace", "DataMate");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await expect(adapter.apply(compiledWelcomeTheme())).rejects.toMatchObject({
      code: "THEME_HOME_WELCOME_UNSUPPORTED",
    });
    await expect(client.evaluate(
      'document.querySelectorAll("[data-open-chatgpt-skin]").length',
    )).resolves.toBe(0);
  });

  it("updates the managed welcome after a project switch without duplicating it", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex", html, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledWelcomeTheme());
    await client.evaluate(`(() => {
      document.querySelector('[aria-label="Switch project"]').textContent = "Atlas";
    })()`);
    mutationController.flush?.();

    await expect(client.evaluate(`(() => ({
      count: document.querySelectorAll('[data-open-chatgpt-skin="welcome"]').length,
      text: document.querySelector('[data-open-chatgpt-skin="welcome"]')?.textContent ?? null,
    }))()`)).resolves.toEqual({
      count: 1,
      text: "在「Atlas」中，你想一起打造什么呢？",
    });
  });

  it("keeps unchanged managed welcome nodes stable during reconciliation", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex", html, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledWelcomeTheme());
    await client.evaluate(`(() => {
      document.querySelector('[data-open-chatgpt-skin="welcome"] > div')
        .setAttribute('data-welcome-node-stable', 'true');
    })()`);
    mutationController.flush?.();

    await expect(client.evaluate(`(() => ({
      count: document.querySelectorAll('[data-open-chatgpt-skin="welcome"]').length,
      stable: document.querySelector(
        '[data-open-chatgpt-skin="welcome"] > div'
      )?.getAttribute('data-welcome-node-stable') ?? null,
    }))()`)).resolves.toEqual({ count: 1, stable: "true" });
  });

  it("removes home-only content on task navigation and restores it on return", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace("<html>", '<html lang="zh-CN">')
      .replace(
        '<section id="native-content" data-rect="360,80,840,620">',
        '<section id="native-content" data-rect="360,80,840,620">' +
          '<span data-testid="home-icon" data-rect="360,80,20,20"></span>',
      )
      .replace("Example workspace", "DataMate");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex", html, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledLayerTheme());
    await client.evaluate('window.location.href = "https://chatgpt.com/codex/tasks/123"');
    mutationController.flush?.();
    await expect(client.evaluate(`(() => ({
      welcome: document.querySelectorAll('[data-open-chatgpt-skin="welcome"]').length,
      layers: document.querySelectorAll('[data-open-chatgpt-skin="composition-layer"]').length,
      nativeVisibility: document.querySelector('#native-hero h1')?.style.visibility ?? null,
    }))()`)).resolves.toEqual({ welcome: 0, layers: 0, nativeVisibility: "" });

    await client.evaluate('window.location.href = "https://chatgpt.com/codex"');
    mutationController.flush?.();
    await expect(client.evaluate(`(() => ({
      welcome: document.querySelectorAll('[data-open-chatgpt-skin="welcome"]').length,
      layers: document.querySelectorAll('[data-open-chatgpt-skin="composition-layer"]').length,
      nativeVisibility: document.querySelector('#native-hero h1')?.style.visibility ?? null,
    }))()`)).resolves.toEqual({ welcome: 1, layers: 1, nativeVisibility: "hidden" });
  });

  it("applies unique non-interactive markers and removes only its own nodes", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);
    expect(await adapter.probe()).toMatchObject({ compatible: true });

    await adapter.apply(compiledTheme());

    expect(await adapter.verify()).toMatchObject({
      valid: true,
      backgroundReady: true,
      decorationPointerEvents: "none",
    });
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-composer")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("composer-input");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-composer-stack")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("composer");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-top-fade")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("top-fade");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-project-picker")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("project-picker");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-project-picker-stack")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("project-picker-stack");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#interactive-horizontal-scroll-fade")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBeNull();
    expect(await client.evaluate<number>(
      'document.querySelectorAll(\'[data-open-chatgpt-skin-surface="card"]\').length',
    )).toBe(4);
    expect(await client.evaluate<number>(
      'document.querySelectorAll("[data-open-chatgpt-skin-interface-image]").length',
    )).toBe(5);
    expect(await client.evaluate<number>(
      'document.querySelectorAll("[data-open-chatgpt-skin-native-icon]").length',
    )).toBe(5);
    expect(await client.evaluate<number>(
      'document.querySelectorAll(\'[data-open-chatgpt-skin-surface^="suggestion-icon-"]\').length',
    )).toBe(4);
    expect(await client.evaluate<string | null>(
      'document.querySelector(\'[data-open-chatgpt-skin-surface="profile-avatar"]\')?.style.pointerEvents ?? null',
    )).toBe("none");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-account-button")?.textContent ?? null',
    )).toContain("Demo user");
    await adapter.remove();
    expect(await client.evaluate<number>(
      `document.querySelectorAll(
        'style[data-open-chatgpt-skin="theme"],style[data-open-chatgpt-skin="fonts"],div[data-open-chatgpt-skin="decorations"]'
      ).length`,
    )).toBe(0);
    expect(await client.evaluate<boolean>(
      'Boolean(document.querySelector("#native-content"))',
    )).toBe(true);
    expect(await client.evaluate<boolean>(
      'Boolean(document.querySelector("#native-marker"))',
    )).toBe(true);
    expect(await client.evaluate<number>(
      'document.querySelectorAll("[data-open-chatgpt-skin-interface-image],[data-open-chatgpt-skin-native-icon],[data-open-chatgpt-skin-interface-host]").length',
    )).toBe(0);
  });

  it("themes the current quota banner without mistaking it for the project picker", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace(
        '<div id="native-project-picker-stack" class="z-0 relative -mb-2" data-rect="430,530,700,43">',
        '<aside id="current-quota-banner" class="bg-token-main-surface-primary" ' +
          'style="background-color: rgb(31, 31, 31)" data-rect="430,470,700,48">' +
          '<h3 data-rect="450,480,420,20">你已达到工作空间额度上限</h3>' +
          '<button data-rect="980,480,100,24">通知所有者</button>' +
        '</aside>' +
        '<div id="native-project-picker-stack" class="z-0 relative -mb-2" data-rect="430,530,700,43">',
      );
    const client = clientFor("app://-/index.html", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    await expect(client.evaluate(`(() => ({
      banner: document.querySelector('#current-quota-banner')
        ?.getAttribute('data-open-chatgpt-skin-surface') ?? null,
      picker: document.querySelector('#native-project-picker')
        ?.getAttribute('data-open-chatgpt-skin-surface') ?? null,
    }))()`)).resolves.toEqual({ banner: "status-banner", picker: "project-picker" });
  });

  it("uses the visible footer account avatar instead of an offscreen semantic match", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace(
        '<button id="native-account-button" aria-label="Account menu" data-rect="12,708,250,40">',
        '<button id="offscreen-account-button" aria-label="个人设置" data-rect="12,1600,250,40">' +
          '<svg data-rect="20,1608,24,24" aria-hidden="true"></svg>Hidden user' +
        '</button>' +
        '<button id="current-account-button" aria-label="打开个人资料菜单" data-rect="12,708,250,40">' +
          '<span id="current-account-avatar" class="rounded-full" data-rect="20,716,18,18">J</span>',
      )
      .replace(
        /<span id="native-account-avatar"[\s\S]*?<\/span>/,
        '<span data-rect="48,714,120,24">JYSoft</span>',
      );
    const client = clientFor("app://-/index.html", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledInterfaceTheme());

    await expect(client.evaluate(`(() => ({
      actualHost: document.querySelector('#current-account-button')
        ?.getAttribute('data-open-chatgpt-skin-interface-host') ?? null,
      offscreenHost: document.querySelector('#offscreen-account-button')
        ?.getAttribute('data-open-chatgpt-skin-interface-host') ?? null,
      nativeHidden: document.querySelector('#current-account-avatar')
        ?.getAttribute('data-open-chatgpt-skin-native-icon') ?? null,
      avatarSize: document.querySelector('[data-open-chatgpt-skin-surface="profile-avatar"]')
        ?.style.width ?? null,
    }))()`)).resolves.toEqual({
      actualHost: "profile-avatar",
      offscreenHost: null,
      nativeHidden: "profile-avatar",
      avatarSize: "24px",
    });
  });

  it("replaces visible project folder icons and enlarges suggestion imagery", async () => {
    const projectRows = ["OpenChatGPTSkin", "DataMate", "Demo Lab", "Theme Test"]
      .map((name, index) =>
        `<div class="sidebar-item folder-row" role="button" aria-label="${name}" ` +
          `data-rect="12,${100 + index * 36},250,30">` +
          `<span id="project-icon-host-${index + 1}" data-rect="16,${100 + index * 36},30,30">` +
            `<svg id="project-native-icon-${index + 1}" ` +
              `data-rect="23,${107 + index * 36},16,16"></svg>` +
          `</span><span data-rect="50,${104 + index * 36},160,22">${name}</span>` +
        `</div>`,
      ).join("");
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace(
        '<button id="native-account-button"',
        `${projectRows}<button id="native-account-button"`,
      );
    const client = clientFor("app://-/index.html", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledInterfaceTheme());

    await expect(client.evaluate(`(() => ({
      projectImages: document.querySelectorAll(
        '[data-open-chatgpt-skin-surface^="project-icon-"]'
      ).length,
      firstProjectNative: document.querySelector('#project-native-icon-1')
        ?.getAttribute('data-open-chatgpt-skin-native-icon') ?? null,
      firstProjectSize: document.querySelector('[data-open-chatgpt-skin-surface="project-icon-1"]')
        ?.style.width ?? null,
      suggestionSizes: Array.from(document.querySelectorAll(
        '[data-open-chatgpt-skin-surface^="suggestion-icon-"]'
      )).map((node) => node.style.width),
    }))()`)).resolves.toEqual({
      projectImages: 4,
      firstProjectNative: "project-icon-1",
      firstProjectSize: "20px",
      suggestionSizes: ["36px", "36px", "36px", "36px"],
    });
  });

  it("re-marks Codex surfaces after React replaces the rendered subtree", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex", html, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());
    await client.evaluate(`(() => {
      const oldMain = document.querySelector("main");
      const replacement = oldMain.cloneNode(true);
      for (const node of replacement.querySelectorAll("[data-open-chatgpt-skin-surface]")) {
        node.removeAttribute("data-open-chatgpt-skin-surface");
      }
      replacement.removeAttribute("data-open-chatgpt-skin-surface");
      oldMain.replaceWith(replacement);
      const oldNavigation = document.querySelector("nav");
      const replacementNavigation = oldNavigation.cloneNode(true);
      for (const node of replacementNavigation.querySelectorAll("[data-open-chatgpt-skin-surface]")) {
        node.removeAttribute("data-open-chatgpt-skin-surface");
      }
      for (const node of replacementNavigation.querySelectorAll("[data-open-chatgpt-skin-interface-image]")) {
        node.remove();
      }
      for (const node of replacementNavigation.querySelectorAll("[data-open-chatgpt-skin-native-icon]")) {
        node.removeAttribute("data-open-chatgpt-skin-native-icon");
      }
      for (const node of replacementNavigation.querySelectorAll("[data-open-chatgpt-skin-interface-host]")) {
        node.removeAttribute("data-open-chatgpt-skin-interface-host");
      }
      replacementNavigation.removeAttribute("data-open-chatgpt-skin-surface");
      oldNavigation.replaceWith(replacementNavigation);
      for (const node of document.querySelectorAll("[data-rect]")) {
        const [left, top, width, height] = node.dataset.rect.split(",").map(Number);
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            width,
            height,
            top,
            left,
            right: left + width,
            bottom: top + height
          })
        });
      }
    })()`);

    expect(await client.evaluate<number>(
      "document.querySelectorAll('[data-open-chatgpt-skin-surface]').length",
    )).toBe(0);
    mutationController.flush?.();

    expect(await adapter.verify()).toMatchObject({
      valid: true,
      mainSurfaceReady: true,
      sidebarSurfaceReady: true,
      composerSurfaceReady: true,
    });
    expect(await client.evaluate<number>(
      'document.querySelectorAll(\'[data-open-chatgpt-skin-surface="card"]\').length',
    )).toBe(4);
    expect(await client.evaluate<number>(
      'document.querySelectorAll("[data-open-chatgpt-skin-interface-image]").length',
    )).toBe(5);
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-composer")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("composer-input");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-top-fade")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("top-fade");

    await adapter.remove();
    expect(mutationController.disconnectCalls).toBe(1);
    expect(mutationController.flush).toBeDefined();
  });

  it("themes a right workspace opened dynamically from the home route", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("app://-/index.html", html, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());
    await client.evaluate(`(() => {
      const main = document.querySelector("main");
      main.insertAdjacentHTML("afterbegin", ` + "`" + `
        <span data-testid="home-icon" data-rect="300,20,20,20"></span>
        <aside id="native-right-workspace" class="relative ml-auto" data-rect="780,0,500,760">
          <div id="right-workspace-drawing-layer"
            class="absolute bg-token-main-surface-primary"
            style="background-color: rgb(24, 24, 24)"
            data-rect="780,0,500,760">
            <div id="right-workspace-content"
              class="bg-token-main-surface-primary"
              style="background-color: rgb(24, 24, 24)"
              data-rect="781,64,499,696">Browser Terminal</div>
          </div>
        </aside>
      ` + "`" + `);
      for (const node of document.querySelectorAll(
        '#native-right-workspace,[id^="right-workspace"],[data-testid="home-icon"]'
      )) {
        const [left, top, width, height] = node.dataset.rect.split(",").map(Number);
        Object.defineProperty(node, "getBoundingClientRect", {
          configurable: true,
          value: () => ({ width, height, top, left, right: left + width, bottom: top + height })
        });
      }
    })()`);
    mutationController.flush?.();

    await expect(client.evaluate<Record<string, string | null>>(`(() => ({
      workspace: document.querySelector("#native-right-workspace")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      drawingRoot: document.querySelector("#right-workspace-drawing-layer")
        ?.closest('[data-open-chatgpt-skin-surface="workbench"]')?.id ?? null,
      interactiveFade: document.querySelector("#interactive-horizontal-scroll-fade")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      projectDisabled: document.querySelector('[aria-label="Switch project"]')
        ?.matches(':disabled,[aria-disabled="true"]') ?? true,
    }))()`)).resolves.toEqual({
      workspace: "workbench",
      drawingRoot: "native-right-workspace",
      interactiveFade: null,
      projectDisabled: false,
    });
  });

  it("reserves room for wrapped suggestion cards above the composer", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-page.html", "utf8"))
      .replace('data-rect="280,0,1000,760"', 'data-rect="280,0,1000,824"')
      .replace('data-rect="360,80,840,620"', 'data-rect="360,80,840,744"')
      .replace('data-rect="380,100,800,180"', 'data-rect="380,100,800,370"')
      .replace('data-rect="380,300,800,150"', 'data-rect="380,500,800,224"')
      .replace('data-rect="430,470,700,230"', 'data-rect="430,613,700,183"')
      .replace('data-rect="430,470,700,48"', 'data-rect="430,625,700,61"')
      .replace('data-rect="430,530,700,150"', 'data-rect="430,698,700,98"')
      .replace('data-rect="458,550,644,44"', 'data-rect="458,712,644,44"');
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    expect(await client.evaluate<string>(
      'document.documentElement.style.getPropertyValue("--ocs-home-overlap-relief")',
    )).toBe("127px");
    expect(await client.evaluate<number>(`(() => {
      const style = document.documentElement.style;
      const setProperty = style.setProperty.bind(style);
      const removeProperty = style.removeProperty.bind(style);
      let writes = 0;
      style.setProperty = (name, value, priority) => {
        if (name === "--ocs-home-overlap-relief") writes += 1;
        setProperty(name, value, priority);
      };
      style.removeProperty = (name) => {
        if (name === "--ocs-home-overlap-relief") writes += 1;
        return removeProperty(name);
      };
      window.__openChatgptSkinMarkSurfaces();
      window.__openChatgptSkinMarkSurfaces();
      return writes;
    })()`)).toBe(0);
    await adapter.remove();
    expect(await client.evaluate<string>(
      'document.documentElement.style.getPropertyValue("--ocs-home-overlap-relief")',
    )).toBe("");
  });

  it("keeps ChatGPT landing, compact composer, mode switcher, and search shell in distinct surfaces", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-chatgpt-page.html", "utf8");
    const client = clientFor("app://-/index.html", html);
    const adapter = new CurrentCodexAdapter(client);

    const landingTheme = {
      ...compiledLayerTheme(),
      compositionLayers: [{
        ...compiledLayerTheme().compositionLayers[0],
        surface: "suggestions" as const,
      }],
    };
    await expect(adapter.preflight(landingTheme)).resolves.toMatchObject({
      valid: false,
      requiredLayersResolved: false,
    });

    await adapter.apply(compiledTheme());

    await expect(client.evaluate<Record<string, string | null | number>>(`(() => {
      const surface = (selector) => document.querySelector(selector)
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null;
      return {
        landing: surface("#chatgpt-landing"),
        composer: surface("#chatgpt-composer-width"),
        composerInput: surface("#chatgpt-composer-input"),
        composerChromeCount: document.querySelectorAll(
          '[data-open-chatgpt-skin-surface="composer-chrome"]'
        ).length,
        modeGroup: surface('[role="group"][aria-label="Composer mode"]'),
        modeTrack: surface("#mode-track"),
        modeSelection: surface("#mode-selection"),
        searchDialog: surface("#search-dialog"),
        searchShell: surface("#search-dialog-shell"),
      };
    })()`)).resolves.toEqual({
      landing: "home-route",
      composer: "composer",
      composerInput: "composer-input",
      composerChromeCount: 0,
      modeGroup: "mode-switcher",
      modeTrack: "mode-switcher-track",
      modeSelection: "mode-switcher-selection",
      searchDialog: "overlay",
      searchShell: "overlay",
    });
  });

  it("marks feature pages, search chrome, and native split drawing layers without disabling controls", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-feature-page.html", "utf8");
    const initialHtml = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("app://-/index.html", initialHtml, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());
    const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1];
    expect(body).toBeDefined();
    await client.evaluate(`(() => {
      document.body.innerHTML = ${JSON.stringify(body)};
      for (const node of document.querySelectorAll("[data-rect]")) {
        const [left, top, width, height] = (node.dataset.rect || "0,0,0,0")
          .split(",").map(Number);
        Object.defineProperty(node, "getBoundingClientRect", {
          value: () => ({ width, height, top, left, right: left + width, bottom: top + height }),
        });
      }
      return true;
    })()`);
    mutationController.flush?.();

    await expect(client.evaluate<Record<string, string | null>>(`(() => {
      const surface = (selector) => document.querySelector(selector)
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null;
      return {
        page: surface("#feature-page"),
        toolbar: surface("#feature-search-toolbar"),
        input: surface("#feature-search-input"),
        leftPanel: surface("#feature-left-panel"),
        detailSection: surface("#feature-detail-section"),
        detailDrawingLayer: surface("#feature-detail-drawing-layer"),
      };
    })()`)).resolves.toEqual({
      page: "feature-page",
      toolbar: "feature-toolbar",
      input: "feature-search",
      leftPanel: "workspace-panel",
      detailSection: "workspace-panel",
      detailDrawingLayer: "workspace-panel",
    });

    await client.evaluate(`document.querySelector("#plugins-page-search").id = "appgen-site-search"`);
    mutationController.flush?.();
    await expect(client.evaluate<Record<string, string | null>>(`(() => ({
      toolbar: document.querySelector("#feature-search-toolbar")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      input: document.querySelector("#feature-search-input")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
    }))()`)).resolves.toEqual({
      toolbar: "feature-toolbar",
      input: "feature-search",
    });
  });

  it("keeps task workbench panels and portal overlays inside the active skin", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-task-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex/tasks/example", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    await expect(client.evaluate<Record<string, string | null>>(`(() => {
      const surface = (selector) => document.querySelector(selector)
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null;
      return {
        task: surface("#native-task-route"),
        workbench: surface("#native-workbench"),
        review: surface("#native-review-pane"),
        terminalPane: surface("#native-terminal-pane"),
        terminal: surface("#native-terminal-console"),
        browser: surface("#native-browser-pane"),
        menu: surface("#native-menu"),
        dialog: surface("#native-dialog"),
      };
    })()`)).resolves.toEqual({
      task: "task",
      workbench: "workbench",
      review: "workspace-panel",
      terminalPane: "workspace-panel",
      terminal: "terminal",
      browser: "workspace-panel",
      menu: "overlay",
      dialog: "overlay",
    });
  });

  it("themes review shadow roots and removes their managed sheets", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-task-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex/tasks/example", html);
    const adapter = new CurrentCodexAdapter(client);

    await client.evaluate(`(() => {
      const review = document.querySelector("#native-review-pane");
      for (const tagName of ["diffs-container", "file-tree-container"]) {
        const host = document.createElement(tagName);
        host.setAttribute("data-rect", "760,140,220,120");
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = tagName === "diffs-container"
          ? "<pre data-diff><code>diff</code></pre>"
          : '<button data-type="item">file</button>';
        review.append(host);
      }
      return true;
    })()`);

    await adapter.apply(compiledTheme());

    await expect(client.evaluate<Record<string, unknown>>(`(() => {
      const records = window.__openChatgptSkinShadowSheets || [];
      const cssFor = (kind) => {
        const record = records.find((entry) => entry.kind === kind);
        if (!record) return "";
        if (record.sheet?.cssRules) {
          return Array.from(record.sheet.cssRules).map((rule) => rule.cssText).join("");
        }
        return record.node?.textContent || "";
      };
      return {
        recordCount: records.length,
        kinds: records.map((entry) => entry.kind).sort(),
        diffsCss: cssFor("diffs"),
        treeCss: cssFor("tree"),
      };
    })()`)).resolves.toMatchObject({
      recordCount: 2,
      kinds: ["diffs", "tree"],
      diffsCss: expect.stringContaining("[data-line-type=\"context\"]"),
      treeCss: expect.stringContaining("[data-file-tree-virtualized-list]"),
    });
    expect(await client.evaluate<string>(`(() => {
      const record = (window.__openChatgptSkinShadowSheets || [])
        .find((entry) => entry.kind === "diffs");
      if (record?.sheet?.cssRules) {
        return Array.from(record.sheet.cssRules).map((rule) => rule.cssText).join("");
      }
      return record?.node?.textContent || "";
    })()`)).toContain('[data-separator-content]');
    expect(await client.evaluate<string>(`(() => {
      const record = (window.__openChatgptSkinShadowSheets || [])
        .find((entry) => entry.kind === "diffs");
      if (record?.sheet?.cssRules) {
        return Array.from(record.sheet.cssRules).map((rule) => rule.cssText).join("");
      }
      return record?.node?.textContent || "";
    })()`)).toContain('[data-line-type="change-addition"]');
    await expect(adapter.verify()).resolves.toMatchObject({
      valid: true,
      reviewShadowReady: true,
    });

    await adapter.remove();
    expect(await client.evaluate<boolean>(
      "Boolean(window.__openChatgptSkinShadowSheets)",
    )).toBe(false);
    expect(await client.evaluate<number>(`(() => Array.from(document.querySelectorAll(
      "diffs-container,file-tree-container"
    )).reduce((count, host) => count + (
      host.shadowRoot?.querySelectorAll('style[data-open-chatgpt-skin-shadow]').length || 0
    ), 0))()`)).toBe(0);
  });

  it("keeps the real sidebar and task composer selected when quick chat is open", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-task-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex/tasks/example", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    await expect(client.evaluate<Record<string, string | null>>(`(() => {
      const surface = (selector) => document.querySelector(selector)
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null;
      return {
        sidebar: surface("#native-sidebar"),
        sidebarNavigation: surface("#native-sidebar-navigation"),
        quickBreadcrumb: surface("#quick-chat-breadcrumb"),
        composer: surface("#native-composer-stack"),
        composerInput: surface("#native-composer"),
        quickComposer: surface("#quick-chat-composer"),
        quickEditor: surface("#quick-chat-editor"),
      };
    })()`)).resolves.toEqual({
      sidebar: "sidebar",
      sidebarNavigation: null,
      quickBreadcrumb: null,
      composer: "composer",
      composerInput: "composer-input",
      quickComposer: null,
      quickEditor: null,
    });
  });

  it("keeps terminal inputs, composer chrome, and history scroll fades in their own surfaces", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-task-page.html", "utf8");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex/tasks/example", html, {
      mutationController,
    });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    await expect(client.evaluate<Record<string, string | null>>(`(() => {
      const surface = (selector) => document.querySelector(selector)
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null;
      return {
        composer: surface("#native-composer-stack"),
        composerChrome: surface("#native-composer-chrome"),
        composerInput: surface("#native-composer"),
        composerFade: surface("#native-composer-fade"),
        terminalPane: surface("#native-terminal-pane"),
        terminal: surface("#native-terminal-console"),
        terminalTextarea: surface("#native-terminal-helper-textarea"),
        scrollFade: surface("#native-history-scroll-fade"),
      };
    })()`)).resolves.toEqual({
      composer: "composer",
      composerChrome: "composer-chrome",
      composerInput: "composer-input",
      composerFade: "scroll-fade",
      terminalPane: "workspace-panel",
      terminal: "terminal",
      terminalTextarea: null,
      scrollFade: "scroll-fade",
    });
    expect(mutationController.observerOptions).toMatchObject({
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden"],
    });

    await client.evaluate(`(() => {
      const fade = document.querySelector("#native-history-scroll-fade");
      fade.removeAttribute("data-open-chatgpt-skin-surface");
      fade.className = "history-scroll-mask";
      return true;
    })()`);
    mutationController.flush?.();
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-history-scroll-fade")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("scroll-fade");
  });

  it("keeps historical conversation code blocks out of workspace detection", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-history-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex/tasks/history", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    await expect(client.evaluate<Record<string, string | null | number>>(`(() => ({
      task: document.querySelector("#history-task-route")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      thread: document.querySelector("#history-thread-content")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      processedSurface: document.querySelector("#history-processed")
        ?.closest("[data-open-chatgpt-skin-surface]")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      resourceCard: document.querySelector("#history-resource-card")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      workspacePanels: document.querySelectorAll(
        '[data-open-chatgpt-skin-surface="workspace-panel"]'
      ).length,
      workbenches: document.querySelectorAll(
        '[data-open-chatgpt-skin-surface="workbench"]'
      ).length,
    }))()`)).resolves.toEqual({
      task: "task",
      thread: null,
      processedSurface: "task",
      resourceCard: "resource-card",
      workspacePanels: 0,
      workbenches: 0,
    });
  });

  it("keeps task coverage when a Codex update removes the nested main role", async () => {
    const html = (await readFile("tests/fixtures/runtime/codex-task-page.html", "utf8"))
      .replace('id="native-task-route" role="main"', 'id="native-task-route"');
    const client = clientFor("https://chatgpt.com/codex/tasks/example", html);
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-task-route")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("task");
    expect(await client.evaluate<string | null>(
      'document.querySelector("#native-browser-pane")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("workspace-panel");
  });

  it("skins settings panels and menus opened after the initial route render", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-settings-page.html", "utf8");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex", html, {
      mutationController,
    });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());

    await expect(client.evaluate<Record<string, string | null>>(`(() => ({
      content: document.querySelector("#settings-content")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      appearance: document.querySelector("#appearance-settings")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
      account: document.querySelector("#account-settings")
        ?.getAttribute("data-open-chatgpt-skin-surface") ?? null,
    }))()`)).resolves.toEqual({
      content: "settings",
      appearance: "settings-panel",
      account: "settings-panel",
    });
    await expect(client.evaluate<Record<string, number>>(`(() => ({
      hero: document.querySelectorAll('[data-open-chatgpt-skin-surface="hero"]').length,
      suggestions: document.querySelectorAll('[data-open-chatgpt-skin-surface="suggestions"]').length,
      cards: document.querySelectorAll('[data-open-chatgpt-skin-surface="card"]').length,
      composer: document.querySelectorAll('[data-open-chatgpt-skin-surface="composer"]').length,
    }))()`)).resolves.toEqual({ hero: 0, suggestions: 0, cards: 0, composer: 0 });
    await client.evaluate(`(() => {
      const menu = document.createElement("div");
      menu.id = "late-settings-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("data-rect", "720,160,280,240");
      Object.defineProperty(menu, "getBoundingClientRect", {
        value: () => ({
          width: 280,
          height: 240,
          top: 160,
          left: 720,
          right: 1000,
          bottom: 400,
        }),
      });
      document.body.append(menu);
      return true;
    })()`);
    mutationController.flush?.();
    expect(await client.evaluate<string | null>(
      'document.querySelector("#late-settings-menu")?.getAttribute("data-open-chatgpt-skin-surface") ?? null',
    )).toBe("overlay");
  });

  it("keeps long settings lists fully inside the themed settings surface", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-settings-page.html", "utf8");
    const mutationController: NonNullable<ClientOptions["mutationController"]> = {};
    const client = clientFor("https://chatgpt.com/codex", html, { mutationController });
    const adapter = new CurrentCodexAdapter(client);

    await adapter.apply(compiledTheme());
    await client.evaluate(`(() => {
      const root = document.querySelector("#settings-page");
      for (let index = 0; index < 24; index += 1) {
        const panel = document.createElement("div");
        panel.id = "settings-row-" + index;
        panel.setAttribute("style", "background-color: rgb(32, 32, 32)");
        Object.defineProperty(panel, "getBoundingClientRect", {
          value: () => ({
            width: 820,
            height: 64,
            top: 190 + index * 72,
            left: 360,
            right: 1180,
            bottom: 254 + index * 72,
          }),
        });
        root.append(panel);
      }
      return true;
    })()`);
    mutationController.flush?.();

    expect(await client.evaluate<number>(
      "document.querySelectorAll('[id^=\"settings-row-\"][data-open-chatgpt-skin-surface=\"settings-panel\"]').length",
    )).toBe(24);
  });

  it("fails closed when the controlled background cannot preload", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex", html, {
      backgroundDecodeFails: true,
    });
    const adapter = new CurrentCodexAdapter(client);

    await expect(adapter.apply(compiledTheme()))
      .rejects.toMatchObject({ code: "THEME_APPLY_FAILED" });
    expect(await client.evaluate<number>(
      "document.querySelectorAll('[data-open-chatgpt-skin]').length",
    )).toBe(0);
  });

  it("rejects image values outside the validated data-URL subset before insertion", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);

    await expect(adapter.apply({
      ...compiledTheme(),
      backgroundDataUrl: "javascript:alert(1)",
    })).rejects.toMatchObject({ code: "THEME_APPLY_FAILED" });
    await expect(adapter.apply({
      ...compiledTheme(),
      assetDataUrls: ["javascript:alert(1)"],
    })).rejects.toMatchObject({ code: "THEME_APPLY_FAILED" });
    expect(await client.evaluate<number>(
      "document.querySelectorAll('[data-open-chatgpt-skin]').length",
    )).toBe(0);
  });

  it("verifies the official appearance only after every OpenChatGPTSkin marker is gone", async () => {
    const html = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
    const client = clientFor("https://chatgpt.com/codex", html);
    const adapter = new CurrentCodexAdapter(client);
    expect(await adapter.verifyOfficialAppearance()).toMatchObject({
      valid: true,
      managedMarkers: 0,
      mainVisible: true,
      navigationVisible: true,
      composerVisible: true,
    });
    await client.evaluate(`(() => {
      const node = document.createElement("div");
      node.dataset.openChatgptSkin = "unknown";
      document.body.append(node);
    })()`);
    expect(await adapter.verifyOfficialAppearance()).toMatchObject({
      valid: false,
      managedMarkers: 1,
    });
  });

  it("rejects auxiliary and structurally incomplete targets", async () => {
    const adapter = new CurrentCodexAdapter(clientFor(
      "https://example.com/",
      "<body><textarea></textarea></body>",
    ));
    expect(await adapter.probe()).toMatchObject({ compatible: false });
  });

  it("waits for trusted DOM capabilities to become ready", async () => {
    let capabilityReads = 0;
    const adapter = new CurrentCodexAdapter({
      evaluate: async <T>(expression: string): Promise<T> => {
        if (expression === "window.location.href") {
          return "https://chatgpt.com/codex" as T;
        }
        capabilityReads += 1;
        return {
          main: capabilityReads >= 3,
          navigation: true,
          composer: true,
        } as T;
      },
    });

    await expect(waitForCompatibleAdapter(adapter, {
      timeoutMs: 100,
      intervalMs: 1,
    })).resolves.toMatchObject({ compatible: true });
    expect(capabilityReads).toBe(3);
  });

  it("does not retry an unsupported URL", async () => {
    let probes = 0;
    const adapter = new CurrentCodexAdapter({
      evaluate: async <T>(expression: string): Promise<T> => {
        if (expression === "window.location.href") {
          probes += 1;
          return "https://example.com/" as T;
        }
        return { main: true, navigation: true, composer: true } as T;
      },
    });

    await expect(waitForCompatibleAdapter(adapter, {
      timeoutMs: 100,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "ADAPTER_INCOMPATIBLE" });
    expect(probes).toBe(1);
  });

  it("times out when trusted DOM capabilities never appear", async () => {
    const adapter = new CurrentCodexAdapter({
      evaluate: async <T>(expression: string): Promise<T> =>
        (expression === "window.location.href"
          ? "https://chatgpt.com/codex"
          : { main: false, navigation: true, composer: true }) as T,
    });

    await expect(waitForCompatibleAdapter(adapter, {
      timeoutMs: 5,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "ADAPTER_INCOMPATIBLE" });
  });

  it("propagates CDP evaluation failures without retrying", async () => {
    let calls = 0;
    const adapter = new CurrentCodexAdapter({
      evaluate: async <T>(): Promise<T> => {
        calls += 1;
        throw Object.assign(new Error("unsafe endpoint"), { code: "CDP_ENDPOINT_UNSAFE" });
      },
    });

    await expect(waitForCompatibleAdapter(adapter, {
      timeoutMs: 100,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "CDP_ENDPOINT_UNSAFE" });
    expect(calls).toBe(1);
  });
});
