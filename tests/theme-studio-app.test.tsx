// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StudioError,
  type StudioBridge,
  type StudioDraft,
} from "@open-chatgpt-skin/theme-studio-core";
import { parseThemeDocument } from "@open-chatgpt-skin/theme-schema";
import { ThemeStudioApp as ThemeStudioAppRoot } from "../apps/theme-studio/src/App.js";

function ThemeStudioApp(props: ComponentProps<typeof ThemeStudioAppRoot>) {
  return <ThemeStudioAppRoot {...props} initialView="editor" />;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.studioTheme;
});

const bootstrap = {
  protocolVersion: 2 as const,
  studioVersion: "0.2.0",
  repositoryUrl: null,
  capabilities: [
    "studio-shell",
    "theme-library",
    "draft-editing",
    "asset-upload",
    "version-save",
    "theme-import-export",
    "runtime-apply",
  ] as const,
  runtime: {
    status: "stopped" as const,
    controllerAvailable: false,
    selectedTheme: null,
    appliedTheme: null,
    skinApplied: false,
    packageVersion: null,
    operation: null,
    nextAction: "No managed session.",
  },
};

function bridge(): StudioBridge {
  return {
    bootstrap: vi.fn(async () => bootstrap),
    listThemes: vi.fn(async () => ({
      themes: [{
        ref: { id: "mountain-mist", version: "1.2.2" },
        name: "山岚云海",
        author: "OpenChatGPTSkin",
        homepage: null,
        source: "builtin",
        ready: true,
        localOnly: false,
        previewUrl: "/api/theme-preview?source=builtin&id=mountain-mist&version=1.2.2",
      }],
    })),
    createDraft: vi.fn(),
    openLatestDraft: vi.fn(async () => null),
    openDraft: vi.fn(),
    updateDraft: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    uploadAsset: vi.fn(),
    validateDraft: vi.fn(),
    saveVersion: vi.fn(),
    importTheme: vi.fn(),
    exportTheme: vi.fn(),
    deletePersonalTheme: vi.fn(),
    applySavedTheme: vi.fn(),
    applyTheme: vi.fn(),
    restoreRuntime: vi.fn(),
    getRuntimeStatus: vi.fn(async () => bootstrap.runtime),
    subscribeEvents: vi.fn(() => () => undefined),
  } as StudioBridge;
}

function draft(
  draftId: string,
  themeId: string,
  name: string,
  revision = 0,
): StudioDraft {
  const theme = parseThemeDocument(JSON.parse(readFileSync(
    resolve("themes/builtin/mountain-mist/theme.json"),
    "utf8",
  )));
  theme.id = themeId;
  theme.name = name;
  return {
    draftId,
    theme,
    revision,
    updatedAt: "2026-07-18T02:00:00.000Z",
    savedRef: null,
    dirty: true,
    undoAvailable: revision > 0,
    redoAvailable: false,
    issues: [],
    assetUrls: {},
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  return {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: (value) => resolvePromise(value),
  };
}

describe("Theme Studio home", () => {
  it("opens on the localized theme home with five built-in themes and metadata details", async () => {
    const studioBridge = bridge();
    const themes = [
      ["future-idol-cyan", "未来歌姬"],
      ["glacier-aurora", "冰川极光"],
      ["mountain-mist", "山岚云海"],
      ["rose-carpet-star", "玫瑰星光"],
      ["yua-mikami-starlight", "Yua Mikami Starlight"],
    ].map(([id, name]) => ({
      ref: { id: id!, version: "1.2.2" },
      name: name!,
      description: `${name}主题描述`,
      author: "OpenChatGPTSkin",
      homepage: null,
      source: "builtin" as const,
      ready: true,
      localOnly: false,
      previewUrl: `/api/theme-preview?source=builtin&id=${id}&version=1.2.2`,
    }));
    vi.mocked(studioBridge.listThemes).mockResolvedValueOnce({ themes });

    render(<ThemeStudioAppRoot bootstrap={bootstrap} bridge={studioBridge} />);

    expect(await screen.findByRole("heading", { name: "给工作台，换一种心情。" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "我的主题" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "更多主题" })).toBeVisible();
    expect(await screen.findAllByRole("button", { name: /主题描述/ })).toHaveLength(5);
    expect(screen.getAllByText("OpenChatGPTSkin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("v1.2.2").length).toBeGreaterThan(0);
    expect(document.querySelector(".home-product-logo")).toBeInTheDocument();
    expect(document.querySelector(".home-theme-art img")).not.toBeInTheDocument();
    expect(document.querySelector(".home-theme-image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出主题包" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出主题包" }))
      .toHaveAttribute("title", "只有已保存或已导入的个人主题可以导出。");

    fireEvent.click(screen.getByRole("button", { name: /冰川极光 冰川极光主题描述/ }));
    expect(screen.getByRole("heading", { name: "冰川极光" })).toBeVisible();
    expect(screen.getByText("冰川极光主题描述", { selector: ".home-description p" })).toBeVisible();
    expect((document.querySelector(".studio-home-shell") as HTMLElement).style
      .getPropertyValue("--home-sidebar-preview"))
      .toBe('url("/api/theme-preview?source=builtin&id=glacier-aurora&version=1.2.2")');
  });

  it("shows the selected personal theme with its real source badge", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.listThemes).mockResolvedValueOnce({
      themes: [
        {
          ref: { id: "mountain-mist", version: "1.2.2" },
          name: "山岚云海",
          author: "OpenChatGPTSkin",
          homepage: null,
          source: "builtin",
          ready: true,
          localOnly: false,
          previewUrl: "/api/theme-preview?source=builtin&id=mountain-mist&version=1.2.2",
        },
        {
          ref: { id: "my-mountain", version: "1.0.0" },
          name: "我的山岚",
          description: "个人主题描述",
          author: "示例作者",
          homepage: "https://github.com/example/my-mountain",
          source: "personal",
          ready: true,
          localOnly: false,
          previewUrl: null,
        },
      ],
    });

    render(<ThemeStudioAppRoot bootstrap={bootstrap} bridge={studioBridge} />);
    fireEvent.click(await screen.findByRole("button", { name: /我的山岚/ }));

    const details = screen.getByRole("complementary", { name: "主题描述" });
    expect(within(details).getByRole("heading", { name: "我的山岚" })).toBeVisible();
    expect(within(details).getAllByText("个人主题")).toHaveLength(2);
    expect(within(details).getByRole("button", { name: "导出主题包" })).toBeEnabled();
  });

  it("persists language and appearance preferences and enters the editor from the selected theme", async () => {
    const studioBridge = bridge();
    const openedDraft = draft("00000000-0000-4000-8000-000000000090", "mountain-mist-custom", "我的山岚");
    vi.mocked(studioBridge.createDraft).mockResolvedValueOnce(openedDraft);
    render(<ThemeStudioAppRoot bootstrap={bootstrap} bridge={studioBridge} />);

    await screen.findByRole("heading", { name: "给工作台，换一种心情。" });
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("heading", { name: "Give your workspace a new mood." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Dark/ }));
    expect(document.documentElement.dataset.studioTheme).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /Start creating/ }));

    await waitFor(() => expect(studioBridge.createDraft).toHaveBeenCalled());
    expect(await screen.findByRole("region", { name: "Themes and tools" })).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem("open-chatgpt-skin:studio-preferences:v1")!))
      .toEqual({ locale: "en", colorMode: "dark" });
  });

  it("applies the selected saved theme directly from home", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.applySavedTheme).mockResolvedValueOnce({
      ...bootstrap.runtime,
      status: "active",
      controllerAvailable: true,
      selectedTheme: { id: "mountain-mist", version: "1.2.2" },
      appliedTheme: { id: "mountain-mist", version: "1.2.2" },
      skinApplied: true,
    });
    render(<ThemeStudioAppRoot bootstrap={bootstrap} bridge={studioBridge} />);

    fireEvent.click(await screen.findByRole("button", { name: /应用并启动/ }));
    await waitFor(() => expect(studioBridge.applySavedTheme).toHaveBeenCalledWith({
      id: "mountain-mist",
      version: "1.2.2",
    }));
    expect(await screen.findByText("已应用 mountain-mist@1.2.2")).toBeVisible();
  });
});

describe("Theme Studio application shell", () => {
  it("renders the complete three-region editor without claiming an unopened draft", async () => {
    render(<ThemeStudioApp bootstrap={bootstrap} bridge={bridge()} />);

    expect(screen.getByRole("heading", { name: "Theme Studio" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Runtime 已停止");
    expect(screen.getByRole("region", { name: "主题与工具" })).toBeVisible();
    expect(screen.getByRole("region", { name: "隔离预览" })).toBeVisible();
    expect(screen.getByRole("region", { name: "属性检查器" })).toBeVisible();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "主题与工具" }))
      .getByText("山岚云海")).toBeVisible());
    expect(screen.getByRole("button", { name: "保存版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "应用到 ChatGPT" })).toBeDisabled();
    expect(screen.getByText("我们应该在示例工作区中做些什么？")).toBeVisible();
    expect(screen.getByText("默认 ChatGPT Desktop 预览 · 选择主题后开始同步调整"))
      .toBeVisible();
  });

  it("reopens the latest persisted draft on startup", async () => {
    const studioBridge = bridge();
    const latest = draft(
      "00000000-0000-4000-8000-000000000003",
      "recovered-theme",
      "恢复的草稿",
      4,
    );
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(latest);

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);

    expect(await screen.findByText("恢复的草稿")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    expect(screen.getByText("草稿 r4")).toBeVisible();
    expect(studioBridge.createDraft).not.toHaveBeenCalled();
  });

  it("switches between home and task previews and exposes adaptive skin controls", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(draft(
      "00000000-0000-4000-8000-000000000013",
      "adaptive-theme",
      "自适应主题",
    ));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("自适应主题");

    fireEvent.click(screen.getByRole("button", { name: "任务工作区" }));
    expect(screen.getByText("示例终端")).toBeVisible();
    expect(screen.queryByText("我们应该在示例工作区中做些什么？"))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /背景/ }));
    const inspector = screen.getByRole("region", { name: "属性检查器" });
    expect(within(inspector).getByLabelText("界面明暗")).toBeVisible();
    expect(within(inspector).getByLabelText("文字安全区")).toBeVisible();
    expect(within(inspector).getByLabelText("任务页背景")).toBeVisible();
    expect(within(inspector).getByText("遮罩强度越低，背景图片越清晰。")).toBeVisible();
    expect(within(inspector).getByLabelText(/基础面板遮罩强度/)).toBeVisible();
    expect(within(inspector).getByLabelText(/终端面板遮罩强度/)).toBeVisible();
  });

  it("edits localized welcome lines through the explicit save flow", async () => {
    const studioBridge = bridge();
    const current = draft(
      "00000000-0000-4000-8000-000000000019",
      "welcome-theme",
      "欢迎语主题",
    );
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(current);
    vi.mocked(studioBridge.updateDraft).mockImplementation(async (input) => ({
      ...current,
      theme: input.theme,
      revision: 1,
      undoAvailable: true,
    }));
    vi.mocked(studioBridge.saveVersion).mockImplementation(async () => ({
      draft: {
        ...current,
        revision: 2,
        savedRef: { id: current.theme.id, version: "1.0.0" },
        dirty: false,
      },
      ref: { id: current.theme.id, version: "1.0.0" },
    }));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("欢迎语主题");
    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /内容/ }));
    const welcome = within(screen.getByRole("region", { name: "属性检查器" }))
      .getByLabelText("中文欢迎语");
    fireEvent.change(welcome, {
      target: { value: "在「{projectName}」中，\n一起创造吧" },
    });
    fireEvent.blur(welcome);

    expect(screen.getByText("在「星崎皮肤实验室」中，")).toBeVisible();
    expect(screen.getByText("一起创造吧")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(studioBridge.updateDraft).toHaveBeenCalledOnce());
    expect(vi.mocked(studioBridge.updateDraft).mock.calls[0]?.[0].theme.home)
      .toEqual({
        welcome: {
          localized: {
            "zh-CN": { lines: ["在「{projectName}」中，", "一起创造吧"] },
          },
        },
      });
  });

  it("clears a display font without deleting a shared font asset", async () => {
    const studioBridge = bridge();
    const current = draft(
      "00000000-0000-4000-8000-000000000020",
      "display-font-theme",
      "展示字体主题",
    );
    current.theme.assets.fonts = { shared: "fonts/shared.woff2" };
    current.theme.typography.uiFontAssetKey = "shared";
    current.theme.typography.uiFamily = "ocs-shared";
    current.theme.typography.displayFontAssetKey = "shared";
    current.theme.typography.displayFamily = "ocs-shared";
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(current);
    vi.mocked(studioBridge.updateDraft).mockImplementation(async (input) => ({
      ...current,
      theme: input.theme,
      revision: 1,
      undoAvailable: true,
    }));
    vi.mocked(studioBridge.saveVersion).mockImplementation(async () => ({
      draft: { ...current, revision: 2, dirty: false },
      ref: { id: current.theme.id, version: "1.0.0" },
    }));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("展示字体主题");
    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /字体/ }));
    const inspector = screen.getByRole("region", { name: "属性检查器" });
    expect(within(inspector).getByLabelText("展示字体")).toHaveValue("ocs-shared");
    expect(within(inspector).getByText("上传展示字体（WOFF2）")).toBeVisible();
    fireEvent.click(within(inspector).getByRole("button", {
      name: "移除上传的展示字体",
    }));
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));

    await waitFor(() => expect(studioBridge.updateDraft).toHaveBeenCalledOnce());
    const saved = vi.mocked(studioBridge.updateDraft).mock.calls[0]![0].theme;
    expect(saved.typography.displayFontAssetKey).toBeUndefined();
    expect(saved.typography.displayFamily).toBe("ocs-shared");
    expect(saved.assets.fonts).toEqual({ shared: "fonts/shared.woff2" });
  });

  it("edits and previews exact composition layers without blocking controls", async () => {
    const studioBridge = bridge();
    const current = draft(
      "00000000-0000-4000-8000-000000000021",
      "composition-theme",
      "视觉图层主题",
    );
    current.theme.assets.decorations = {
      "hero-signature": "decorations/hero-signature.webp",
    };
    current.theme.composition.layers = [{
      id: "hero-signature",
      asset: { kind: "decoration", assetKey: "hero-signature" },
      surface: "home-hero",
      anchor: "top-left",
      positionX: 0.08,
      positionY: 0.04,
      width: 0.18,
      opacity: 1,
      rotation: 0,
      required: true,
    }];
    current.assetUrls["decorations/hero-signature.webp"] =
      "data:image/webp;base64,UklGRg==";
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(current);
    vi.mocked(studioBridge.updateDraft).mockImplementation(async (input) => ({
      ...current,
      theme: input.theme,
      revision: 1,
      undoAvailable: true,
    }));
    vi.mocked(studioBridge.saveVersion).mockImplementation(async () => ({
      draft: { ...current, revision: 2, dirty: false },
      ref: { id: current.theme.id, version: "1.0.0" },
    }));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("视觉图层主题");
    const layer = screen.getByTestId("composition-layer-hero-signature");
    expect(layer).toHaveStyle({
      left: "8%",
      top: "4%",
      width: "18%",
      pointerEvents: "none",
    });
    expect(layer).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /视觉图层/ }));
    const inspector = screen.getByRole("region", { name: "属性检查器" });
    expect(within(inspector).getByText("hero-signature", { selector: "strong" }))
      .toBeVisible();
    expect(within(inspector).getByLabelText("绑定区域")).toHaveValue("home-hero");
    expect(within(inspector).getByLabelText("锚点")).toHaveValue("top-left");
    expect(within(inspector).getByLabelText(/水平位置/)).toHaveValue("0.08");
    expect(within(inspector).getByLabelText(/旋转角度/)).toHaveValue("0");
    expect(within(inspector).getByLabelText("必需图层")).toBeChecked();

    fireEvent.change(within(inspector).getByLabelText("绑定区域"), {
      target: { value: "main" },
    });
    await waitFor(() => expect(screen.getByTestId("composition-layer-hero-signature")
      .closest('[data-composition-surface="main"]')).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));

    await waitFor(() => expect(studioBridge.updateDraft).toHaveBeenCalledOnce());
    expect(vi.mocked(studioBridge.updateDraft).mock.calls[0]![0]
      .theme.composition.layers[0]?.surface).toBe("main");
  });

  it("exposes localized avatar, suggestion, and project imagery resource cards", async () => {
    const studioBridge = bridge();
    const imageryDraft = draft(
      "00000000-0000-4000-8000-000000000018",
      "imagery-theme",
      "界面素材主题",
    );
    delete imageryDraft.theme.assets.profileAvatar;
    delete imageryDraft.theme.assets.suggestionIcons;
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(imageryDraft);

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("界面素材主题");
    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /界面素材/ }));

    const inspector = screen.getByRole("region", { name: "属性检查器" });
    expect(within(inspector).getByRole("heading", { name: "界面素材" })).toBeVisible();
    expect(within(inspector).getByText("用户头像", { selector: "strong" })).toBeVisible();
    expect(within(inspector).getByText("建议卡片 4", { selector: "strong" })).toBeVisible();
    expect(within(inspector).getByText("项目图标 4", { selector: "strong" })).toBeVisible();
    expect(within(inspector).getAllByText("官方默认")).toHaveLength(18);
    expect(within(inspector).getAllByText("使用主题背景")).toHaveLength(9);
    expect(within(inspector).getByLabelText("头像尺寸")).toHaveValue("24");
    expect(within(inspector).getByLabelText("建议卡片图标尺寸")).toHaveValue("20");
    expect(within(inspector).getByLabelText("项目图标尺寸")).toHaveValue("16");
  });

  it("does not expose geometry controls for the native project picker", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(draft(
      "00000000-0000-4000-8000-000000000017",
      "native-picker-theme",
      "原生项目条主题",
    ));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("原生项目条主题");
    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /模块布局/ }));

    const inspector = screen.getByRole("region", { name: "属性检查器" });
    expect(within(inspector).queryByText("项目选择", { selector: "strong" }))
      .not.toBeInTheDocument();
  });

  it("switches the left panel between the theme library and localized editing tools", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(draft(
      "00000000-0000-4000-8000-000000000014",
      "localized-theme",
      "中文配置主题",
    ));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("中文配置主题");

    const tabs = screen.getByRole("tablist", { name: "左侧面板" });
    expect(within(tabs).getByRole("tab", { name: "主题库" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(within(tabs).getByRole("tab", { name: "编辑工具" }));
    expect(screen.queryByRole("button", { name: /山岚云海/ })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /装饰/ }));
    const inspector = screen.getByRole("region", { name: "属性检查器" });
    expect(within(inspector).getByRole("button", { name: "＋ 粒子" })).toBeVisible();
    expect(within(inspector).getByRole("button", { name: "＋ 闪光" })).toBeVisible();
    expect(within(inspector).getByText("粒子", { selector: "strong" })).toBeVisible();
    expect(within(inspector).queryByText("sparkles")).not.toBeInTheDocument();
    expect(within(inspector).queryByText("ribbon")).not.toBeInTheDocument();
  });

  it("keeps property changes local until the user explicitly saves a version", async () => {
    const studioBridge = bridge();
    const current = draft(
      "00000000-0000-4000-8000-000000000015",
      "history-theme",
      "历史主题",
    );
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(current);
    vi.mocked(studioBridge.updateDraft).mockImplementation(async (input) => ({
      ...current,
      theme: input.theme,
      revision: current.revision + 1,
      undoAvailable: true,
    }));
    vi.mocked(studioBridge.saveVersion).mockImplementation(async (input) => ({
      draft: {
        ...current,
        revision: input.expectedRevision + 1,
        savedRef: { id: current.theme.id, version: "1.0.0" },
        dirty: false,
      },
      ref: { id: current.theme.id, version: "1.0.0" },
    }));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    await screen.findByText("历史主题");
    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    const accent = document.querySelector<HTMLInputElement>(
      '.color-field input[type="color"]',
    );
    expect(accent).not.toBeNull();

    fireEvent.change(accent!, { target: { value: "#112233" } });
    fireEvent.change(accent!, { target: { value: "#223344" } });
    fireEvent.change(accent!, { target: { value: "#334455" } });
    await act(async () => {
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 500));
    });
    expect(studioBridge.updateDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
    await waitFor(() => expect(studioBridge.updateDraft).toHaveBeenCalledOnce());
    expect(vi.mocked(studioBridge.updateDraft).mock.calls[0]?.[0].theme.colors.accent)
      .toBe("#334455");
    await waitFor(() => expect(studioBridge.saveVersion).toHaveBeenCalledOnce());
  });

  it("opens a selected theme and switches to editing immediately", async () => {
    const studioBridge = bridge();
    const selectedDraft = draft(
      "00000000-0000-4000-8000-000000000001",
      "mountain-mist-custom",
      "山岚云海自定义",
    );
    vi.mocked(studioBridge.createDraft).mockResolvedValueOnce(selectedDraft);

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    const themeCard = await screen.findByRole("button", { name: /山岚云海/ });
    fireEvent.click(themeCard);
    await waitFor(() => expect(studioBridge.createDraft).toHaveBeenCalledOnce());
    expect(screen.getByRole("tab", { name: "编辑工具" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("山岚云海自定义")).toBeVisible();
  });

  it("asks whether to load or overwrite the one existing draft for a theme", async () => {
    const studioBridge = bridge();
    const existing = draft(
      "00000000-0000-4000-8000-000000000002",
      "mountain-mist-custom",
      "已有山岚草稿",
    );
    vi.mocked(studioBridge.createDraft)
      .mockRejectedValueOnce(new StudioError(
        "STUDIO_DRAFT_CONFLICT",
        "该主题已有草稿",
      ))
      .mockResolvedValueOnce(existing);

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    fireEvent.click(await screen.findByRole("button", { name: /山岚云海/ }));

    const dialog = await screen.findByRole("dialog", { name: "已有主题草稿" });
    expect(studioBridge.createDraft).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "主题库" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dialog).getByText(/加载已有草稿或覆盖/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "加载已有草稿" }))
      .toHaveClass("primary-action");
    expect(within(dialog).getByRole("button", { name: "覆盖现有草稿" }))
      .toHaveClass("danger-action");
    expect(within(dialog).getByRole("button", { name: "取消" }))
      .toHaveClass("secondary-action");
    fireEvent.click(within(dialog).getByRole("button", { name: "加载已有草稿" }));

    await waitFor(() => expect(studioBridge.createDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ conflictResolution: "load-existing" }),
    ));
    expect(screen.getByRole("tab", { name: "编辑工具" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("已有山岚草稿")).toBeVisible();
  });

  it("keeps the theme library unchanged when an existing-draft prompt is cancelled", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.createDraft).mockRejectedValueOnce(new StudioError(
      "STUDIO_DRAFT_CONFLICT",
      "该主题已有草稿",
    ));

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    fireEvent.click(await screen.findByRole("button", { name: /山岚云海/ }));

    const dialog = await screen.findByRole("dialog", { name: "已有主题草稿" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog", { name: "已有主题草稿" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "主题库" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(studioBridge.createDraft).toHaveBeenCalledOnce();
  });

  it("shows immediate progress while applying a theme", async () => {
    const studioBridge = bridge();
    const current = {
      ...draft(
        "00000000-0000-4000-8000-000000000004",
        "responsive-theme",
        "即时反馈主题",
        2,
      ),
      savedRef: { id: "responsive-theme", version: "1.0.0" },
      dirty: false,
    } satisfies StudioDraft;
    const applied = deferred<Awaited<ReturnType<StudioBridge["applyTheme"]>>>();
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(current);
    vi.mocked(studioBridge.applyTheme).mockReturnValueOnce(applied.promise);

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    const applyButton = await screen.findByRole("button", { name: "应用到 ChatGPT" });
    fireEvent.click(applyButton);

    expect(await screen.findByRole("button", { name: "正在应用…" })).toBeDisabled();
    expect(screen.getByText("正在应用已保存的主题，ChatGPT 启动可能需要数秒…")).toBeVisible();

    const ref = { id: current.theme.id, version: "1.0.0" };
    await act(async () => {
      applied.resolve({
        draft: { ...current, revision: 3, savedRef: ref, dirty: false },
        ref,
        runtime: {
          status: "active",
          controllerAvailable: true,
          selectedTheme: ref,
          appliedTheme: ref,
          skinApplied: true,
          packageVersion: "26.715.2305.0",
          operation: null,
          nextAction: "Theme is active.",
        },
      });
      await applied.promise;
    });

    expect(await screen.findByText(`已应用 ${ref.id}@${ref.version}`)).toBeVisible();
  });

  it("restores the original ChatGPT appearance from the toolbar", async () => {
    const activeBootstrap = {
      ...bootstrap,
      runtime: {
        status: "active" as const,
        controllerAvailable: true,
        selectedTheme: { id: "future-idol-cyan", version: "1.0.0" },
        appliedTheme: { id: "future-idol-cyan", version: "1.0.0" },
        skinApplied: true,
        packageVersion: "26.715.2305.0",
        operation: null,
        nextAction: "Theme is active.",
      },
    };
    const studioBridge = bridge();
    const restored = {
      ...activeBootstrap.runtime,
      status: "restored-awaiting-exit" as const,
      appliedTheme: null,
      skinApplied: false,
      nextAction: "Quit Codex normally to finish restoring.",
    };
    vi.mocked(studioBridge.restoreRuntime).mockResolvedValueOnce(restored);

    render(<ThemeStudioApp bootstrap={activeBootstrap} bridge={studioBridge} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复原始皮肤" }));

    await waitFor(() => expect(studioBridge.restoreRuntime).toHaveBeenCalledOnce());
    expect(await screen.findByText("已恢复 ChatGPT 原始皮肤，请正常退出 ChatGPT 完成清理。"))
      .toBeVisible();
    expect(screen.getByText("等待 ChatGPT 正常退出")).toBeVisible();
  });

  it("shows only the latest card for each personal theme", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.listThemes).mockResolvedValueOnce({
      themes: [
        {
          ref: { id: "personal-mountain", version: "1.0.0" },
          name: "个人山岚",
          source: "personal",
          ready: true,
          localOnly: true,
          previewUrl: null,
        },
        {
          ref: { id: "personal-mountain", version: "1.0.1" },
          name: "个人山岚",
          source: "personal",
          ready: true,
          localOnly: true,
          previewUrl: null,
        },
      ],
    });

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);

    expect(await screen.findAllByRole("button", { name: /个人山岚/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /个人山岚/ })).toHaveTextContent("1.0.1");
  });

  it("deletes a personal theme from the library or one version from version history", async () => {
    const studioBridge = bridge();
    const current = {
      ...draft(
        "00000000-0000-4000-8000-000000000016",
        "personal-mountain",
        "个人山岚",
        3,
      ),
      savedRef: { id: "personal-mountain", version: "1.0.1" },
      dirty: false,
    } satisfies StudioDraft;
    const personalThemes = [
      {
        ref: { id: "personal-mountain", version: "1.0.0" },
        name: "个人山岚",
        source: "personal" as const,
        ready: true,
        localOnly: true,
        previewUrl: null,
      },
      {
        ref: { id: "personal-mountain", version: "1.0.1" },
        name: "个人山岚",
        source: "personal" as const,
        ready: true,
        localOnly: true,
        previewUrl: null,
      },
    ];
    vi.mocked(studioBridge.openLatestDraft).mockResolvedValueOnce(current);
    vi.mocked(studioBridge.listThemes).mockResolvedValueOnce({ themes: personalThemes });
    const deletion = deferred<Awaited<ReturnType<StudioBridge["deletePersonalTheme"]>>>();
    vi.mocked(studioBridge.deletePersonalTheme).mockReturnValueOnce(deletion.promise);
    vi.mocked(studioBridge.openDraft).mockResolvedValueOnce(current);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);
    expect(await screen.findByRole("button", {
      name: "删除个人主题 personal-mountain",
    })).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "编辑工具" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "主题编辑工具" }))
      .getByRole("button", { name: /版本记录/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除版本 1.0.0" }));

    await waitFor(() => expect(studioBridge.deletePersonalTheme).toHaveBeenCalledWith({
      id: "personal-mountain",
      version: "1.0.0",
    }));
    expect(screen.getByText("正在删除个人主题数据，请稍候…")).toBeVisible();
    await act(async () => {
      deletion.resolve({ themes: [personalThemes[1]!] });
      await deletion.promise;
    });
    expect(await screen.findByText("已删除 personal-mountain@1.0.0")).toBeVisible();
    confirm.mockRestore();
  });

  it("keeps operation notices out of the workbench grid flow", () => {
    const css = readFileSync(resolve("apps/theme-studio/src/styles.css"), "utf8");
    const shellRule = css.slice(
      css.indexOf(".studio-shell {"),
      css.indexOf("}", css.indexOf(".studio-shell {")) + 1,
    );
    const messagesRule = css.slice(
      css.indexOf(".studio-messages {"),
      css.indexOf("}", css.indexOf(".studio-messages {")) + 1,
    );
    expect(shellRule).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(messagesRule).toContain("position: fixed");
  });

  it("bridges both editor appearances to the product-home design tokens", () => {
    const css = readFileSync(resolve("apps/theme-studio/src/styles.css"), "utf8");
    expect(css).toContain("[data-studio-theme] {");
    expect(css).toContain("--studio-accent: var(--app-accent)");
    expect(css).toContain("[data-studio-theme] .studio-toolbar");
    expect(css).toContain("background: var(--app-panel-solid)");
    expect(css).toContain("flex: 0 0 38px");
  });

  it("collapses legacy random personal copies created from the same built-in theme", async () => {
    const studioBridge = bridge();
    vi.mocked(studioBridge.listThemes).mockResolvedValueOnce({
      themes: [
        {
          ref: { id: "future-idol-cyan", version: "1.0.0" },
          name: "未来歌姬",
          source: "builtin",
          ready: true,
          localOnly: false,
          previewUrl: null,
        },
        {
          ref: { id: "future-idol-cyan-custom-4cad8c", version: "1.0.0" },
          name: "未来歌姬 自定义",
          source: "personal",
          ready: true,
          localOnly: true,
          previewUrl: null,
        },
        {
          ref: { id: "future-idol-cyan-custom-d57eb4", version: "1.0.0" },
          name: "未来歌姬 自定义",
          source: "personal",
          ready: true,
          localOnly: true,
          previewUrl: null,
        },
        {
          ref: { id: "future-idol-cyan-custom", version: "1.0.0" },
          name: "未来歌姬 自定义",
          source: "personal",
          ready: true,
          localOnly: true,
          previewUrl: null,
        },
      ],
    });

    render(<ThemeStudioApp bootstrap={bootstrap} bridge={studioBridge} />);

    const personalCards = await screen.findAllByRole("button", { name: /未来歌姬 自定义/ });
    expect(personalCards).toHaveLength(1);
    expect(personalCards[0]).toHaveTextContent("future-idol-cyan-custom");
  });
});
