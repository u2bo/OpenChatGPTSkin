import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowUp } from "@phosphor-icons/react/ArrowUp";
import { ArrowsClockwise } from "@phosphor-icons/react/ArrowsClockwise";
import { Binoculars } from "@phosphor-icons/react/Binoculars";
import { Bug } from "@phosphor-icons/react/Bug";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { ClockCounterClockwise } from "@phosphor-icons/react/ClockCounterClockwise";
import { Columns } from "@phosphor-icons/react/Columns";
import { Folder } from "@phosphor-icons/react/Folder";
import { GitPullRequest } from "@phosphor-icons/react/GitPullRequest";
import { GridFour } from "@phosphor-icons/react/GridFour";
import { Hammer } from "@phosphor-icons/react/Hammer";
import { Layout } from "@phosphor-icons/react/Layout";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Microphone } from "@phosphor-icons/react/Microphone";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { PlugsConnected } from "@phosphor-icons/react/PlugsConnected";
import { Plus } from "@phosphor-icons/react/Plus";
import { Question } from "@phosphor-icons/react/Question";
import { Rows } from "@phosphor-icons/react/Rows";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { SidebarSimple } from "@phosphor-icons/react/SidebarSimple";
import { TerminalWindow } from "@phosphor-icons/react/TerminalWindow";
import { UserCircle } from "@phosphor-icons/react/UserCircle";
import type { StudioDraft } from "@open-chatgpt-skin/theme-studio-core";
import type { StudioLocale } from "../studio/preferences.js";
import {
  createSafeAreaOverlayCss,
  createTaskSurfaceBackgroundCss,
  createThemeVisualModel,
  DEFAULT_LAYOUT_MODULES,
  resolveHomeWelcome,
  type ResolvedCompositionLayer,
  type SuggestionIconSlot,
  type ThemeDraftDocument,
  type ThemeInterfaceImageVisual,
} from "@open-chatgpt-skin/theme-schema";

type PreviewStyle = CSSProperties & Record<`--preview-${string}`, string>;
export type PreviewMode = "home" | "task";
type LayoutModule = ThemeDraftDocument["layout"]["modules"][number];
type ModuleId = LayoutModule["id"];

interface MutableFontFaceSet extends FontFaceSet {
  add(font: FontFace): this;
  delete(font: FontFace): boolean;
}

interface PreviewInterfaceImage {
  readonly url: string;
  readonly objectPosition: string;
  readonly sizePx: number;
}

interface PreviewWelcomeLayout {
  readonly anchor: ResolvedCompositionLayer["anchor"];
  readonly positionXPercent: number;
  readonly positionYPercent: number;
  readonly widthPercent: number;
  readonly textAlign: "left" | "center" | "right";
  readonly hideNativeIcon: boolean;
}

const COMPOSITION_ANCHOR_TRANSFORMS: Readonly<Record<
  ResolvedCompositionLayer["anchor"],
  string
>> = {
  "top-left": "translate(0%, 0%)",
  "top-center": "translate(-50%, 0%)",
  "top-right": "translate(-100%, 0%)",
  "center-left": "translate(0%, -50%)",
  center: "translate(-50%, -50%)",
  "center-right": "translate(-100%, -50%)",
  "bottom-left": "translate(0%, -100%)",
  "bottom-center": "translate(-50%, -100%)",
  "bottom-right": "translate(-100%, -100%)",
};

const DEFAULT_MODULES = DEFAULT_LAYOUT_MODULES;
const SUGGESTION_SLOTS: readonly SuggestionIconSlot[] = [
  "card1",
  "card2",
  "card3",
  "card4",
];

const PROJECTS = [
  ["星图编辑器", "检查搜索与筛选逻辑"],
  ["知识库助手", "优化文档检索体验"],
  ["天气卡片", "修复移动端布局"],
  ["设计系统", "整理按钮状态规范"],
  ["自动化脚本", "添加发布前检查"],
  ["数据看板", "优化图表加载性能"],
] as const;
const PROJECTS_EN = [
  ["Star Map Editor", "Review search and filtering"],
  ["Knowledge Assistant", "Improve document retrieval"],
  ["Weather Cards", "Fix mobile layout"],
  ["Design System", "Document button states"],
  ["Automation Scripts", "Add release checks"],
  ["Data Dashboard", "Improve chart loading"],
] as const;

const SUGGESTIONS = [
  { label: "探索并理解代码", icon: Binoculars, color: "#1995ff" },
  { label: "构建新功能、应用或工具", icon: Hammer, color: "#a566ff" },
  { label: "审查代码并提出修改建议", icon: ArrowsClockwise, color: "#27c66f" },
  { label: "修复问题和失败", icon: Bug, color: "#ff6a16" },
] as const;
const SUGGESTION_LABELS_EN = [
  "Explore and understand code",
  "Build a feature, app, or tool",
  "Review code and suggest changes",
  "Fix a bug or failing test",
] as const;

function previewInterfaceImage(
  visual: ThemeInterfaceImageVisual | undefined,
  assetUrls: StudioDraft["assetUrls"] | undefined,
): PreviewInterfaceImage | undefined {
  if (!visual?.path) return undefined;
  const url = assetUrls?.[visual.path];
  if (!url) return undefined;
  return {
    url,
    objectPosition: `${visual.positionXPercent}% ${visual.positionYPercent}%`,
    sizePx: visual.sizePx,
  };
}

function CompositionSurface({
  surface,
  layers,
  theme,
  assetUrls,
}: {
  readonly surface: ResolvedCompositionLayer["surface"];
  readonly layers: readonly ResolvedCompositionLayer[];
  readonly theme: ThemeDraftDocument | undefined;
  readonly assetUrls: StudioDraft["assetUrls"] | undefined;
}) {
  const rendered = layers.flatMap((layer) => {
    if (layer.surface !== surface) return [];
    const path = layer.asset.kind === "portrait"
      ? theme?.assets.portrait
      : theme?.assets.decorations?.[layer.asset.assetKey];
    const url = path ? assetUrls?.[path] : undefined;
    if (!url) return [];
    return [(
      <img
        key={layer.id}
        data-testid={`composition-layer-${layer.id}`}
        src={url}
        alt=""
        aria-hidden="true"
        tabIndex={-1}
        style={{
          left: `${layer.positionXPercent}%`,
          top: `${layer.positionYPercent}%`,
          width: `${layer.widthPercent}%`,
          opacity: layer.opacity,
          transform: `${COMPOSITION_ANCHOR_TRANSFORMS[layer.anchor]} rotate(${layer.rotationDeg}deg)`,
          pointerEvents: "none",
          userSelect: "none",
        }}
      />
    )];
  });
  if (rendered.length === 0) return null;
  return (
    <div
      className="preview-composition-surface"
      data-composition-surface={surface}
      aria-hidden="true"
    >
      {rendered}
    </div>
  );
}

function moduleById(modules: readonly LayoutModule[], id: ModuleId): LayoutModule {
  return modules.find((module) => module.id === id) ?? DEFAULT_MODULES
    .find((module) => module.id === id)!;
}

function moduleStyle(module: LayoutModule): CSSProperties {
  return { "--module-spacing": `${module.spacing}px` } as CSSProperties;
}

function decorationPosition(
  placement: "background" | "corners" | "hero" | "cards",
  index: number,
  decorationIndex: number,
): Pick<CSSProperties, "left" | "top"> {
  if (placement === "corners") {
    const corners = [[4, 5], [94, 5], [4, 91], [94, 91]] as const;
    const corner = corners[index % corners.length]!;
    return { left: `${corner[0]}%`, top: `${corner[1]}%` };
  }
  if (placement === "hero") {
    return {
      left: `${18 + ((index * 19 + decorationIndex * 11) % 66)}%`,
      top: `${24 + ((index * 7 + decorationIndex * 5) % 22)}%`,
    };
  }
  if (placement === "cards") {
    return {
      left: `${24 + ((index * 29 + decorationIndex * 7) % 68)}%`,
      top: `${48 + ((index * 17 + decorationIndex * 5) % 22)}%`,
    };
  }
  return {
    left: `${(index * 37 + decorationIndex * 11) % 96}%`,
    top: `${(index * 61 + decorationIndex * 17) % 94}%`,
  };
}

function CodexNavItem({ icon, label }: { readonly icon: ReactNode; readonly label: string }) {
  return <span className="codex-nav-item">{icon}<b>{label}</b></span>;
}

function CodexSidebar({
  density,
  taskBackgroundVisible,
  contentLayerVisible,
  locale,
  profileImage,
  projectImages,
}: {
  readonly density: "compact" | "comfortable";
  readonly taskBackgroundVisible: boolean;
  readonly contentLayerVisible: boolean;
  readonly locale: StudioLocale;
  readonly profileImage: PreviewInterfaceImage | undefined;
  readonly projectImages: readonly PreviewInterfaceImage[];
}) {
  const projects = locale === "en" ? PROJECTS_EN : PROJECTS;
  return (
    <aside className="codex-sidebar" data-density={density}>
      <div className="codex-sidebar-header">
        <div className="codex-brand"><strong>ChatGPT</strong><CaretDown weight="bold" /></div>
        <MagnifyingGlass className="codex-search" weight="regular" />
      </div>
      <nav className="codex-primary-nav" aria-label={locale === "en" ? "ChatGPT preview navigation" : "ChatGPT 预览导航"}>
        <CodexNavItem icon={<PencilSimple weight="regular" />} label={locale === "en" ? "New task" : "新建任务"} />
        <CodexNavItem icon={<GitPullRequest weight="regular" />} label={locale === "en" ? "Pull requests" : "拉取请求"} />
        <CodexNavItem icon={<GridFour weight="regular" />} label={locale === "en" ? "Sites" : "站点"} />
        <CodexNavItem icon={<ClockCounterClockwise weight="regular" />} label={locale === "en" ? "Scheduled" : "已安排"} />
        <CodexNavItem icon={<PlugsConnected weight="regular" />} label={locale === "en" ? "Plugins" : "插件"} />
      </nav>
      <div className="codex-projects">
        <h3>{locale === "en" ? "Projects" : "项目"}</h3>
        {projects.map(([name, task], index) => (
          <section className="codex-project-group" key={name}>
            <div>
              {projectImages.length > 0 ? (
                <img
                  className="codex-project-image"
                  src={projectImages[index % projectImages.length]!.url}
                  alt=""
                  aria-hidden="true"
                  style={{
                    objectPosition: projectImages[index % projectImages.length]!.objectPosition,
                    width: projectImages[index % projectImages.length]!.sizePx,
                    height: projectImages[index % projectImages.length]!.sizePx,
                  }}
                />
              ) : <Folder weight="regular" />}
              <strong>{name}</strong>
            </div>
            {(index < 4 || (index === 4 && contentLayerVisible) ||
              (index === 5 && taskBackgroundVisible)) ? <p>{task}</p> : null}
          </section>
        ))}
      </div>
      <footer className="codex-profile">
        {profileImage ? (
          <img
            className="codex-profile-avatar"
            src={profileImage.url}
            alt={locale === "en" ? "Demo user avatar" : "示例用户头像"}
            style={{
              objectPosition: profileImage.objectPosition,
              width: profileImage.sizePx,
              height: profileImage.sizePx,
            }}
          />
        ) : <UserCircle weight="fill" />}
        <strong>{locale === "en" ? "Demo user" : "示例用户"}</strong>
        <Question weight="regular" />
      </footer>
    </aside>
  );
}

function WindowTitlebar({ locale }: { readonly locale: StudioLocale }) {
  return (
    <div className="codex-window-titlebar">
      <div className="codex-window-navigation">
        <SidebarSimple weight="regular" />
        <ArrowLeft weight="regular" />
        <ArrowRight weight="regular" />
        <span>{locale === "en" ? "File" : "文件"}</span><span>{locale === "en" ? "Edit" : "编辑"}</span><span>{locale === "en" ? "View" : "视图"}</span><span>{locale === "en" ? "Help" : "帮助"}</span>
      </div>
      <div className="codex-window-controls"><span>—</span><Rows /><span>×</span></div>
    </div>
  );
}

function MainTopbar() {
  return (
    <div className="codex-main-topbar preview-module" data-module="topbar">
      <span />
      <div><Layout weight="regular" /><Columns weight="regular" /></div>
    </div>
  );
}

function Hero({
  module,
  lines,
  composition,
  layout,
}: {
  readonly module: LayoutModule;
  readonly lines: readonly string[];
  readonly composition: ReactNode;
  readonly layout: PreviewWelcomeLayout | undefined;
}) {
  const headingStyle: CSSProperties | undefined = layout ? {
    position: "absolute",
    left: `${layout.positionXPercent}%`,
    top: `${layout.positionYPercent}%`,
    width: `${layout.widthPercent}%`,
    maxWidth: "none",
    transform: COMPOSITION_ANCHOR_TRANSFORMS[layout.anchor],
    textAlign: layout.textAlign,
  } : undefined;
  return (
    <section
      className="codex-hero preview-module"
      data-module="hero"
      data-size={module.size}
      data-align={module.align}
      data-custom-welcome-layout={Boolean(layout)}
    >
      {composition}
      {!layout?.hideNativeIcon ? <TerminalWindow weight="duotone" /> : null}
      <h2 style={headingStyle}>{lines.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</h2>
    </section>
  );
}

function Suggestions({
  module,
  columns,
  locale,
  images,
  composition,
}: {
  readonly module: LayoutModule;
  readonly columns: number;
  readonly locale: StudioLocale;
  readonly images: Readonly<Record<SuggestionIconSlot, PreviewInterfaceImage | undefined>>;
  readonly composition: ReactNode;
}) {
  return (
    <section
      className="codex-suggestions preview-module"
      data-module="suggestions"
      data-size={module.size}
      data-align={module.align}
      style={{ "--suggestion-columns": String(columns) } as CSSProperties}
    >
      {composition}
      {SUGGESTIONS.map(({ label, icon: Icon, color }, index) => {
        const image = images[SUGGESTION_SLOTS[index]!];
        return (
          <button type="button" tabIndex={-1} key={label}>
            {image ? (
              <img
                className="codex-suggestion-image"
                src={image.url}
                alt={locale === "en"
                  ? `Suggestion card ${index + 1} image`
                  : `建议卡片 ${index + 1} 图片`}
                style={{
                  objectPosition: image.objectPosition,
                  width: image.sizePx,
                  height: image.sizePx,
                }}
              />
            ) : <Icon weight="regular" style={{ color }} />}
            <strong>{locale === "en" ? SUGGESTION_LABELS_EN[index] : label}</strong>
          </button>
        );
      })}
    </section>
  );
}

function ProjectPicker({ locale }: { readonly locale: StudioLocale }) {
  return (
    <div className="codex-project-picker preview-module" data-module="project-picker">
      <Folder weight="regular" /><strong>{locale === "en" ? "Sample workspace" : "示例工作区"}</strong>
    </div>
  );
}

function Composer({ module, locale }: { readonly module: LayoutModule; readonly locale: StudioLocale }) {
  return (
    <div className="codex-composer preview-module" data-module="composer" data-size={module.size} data-align={module.align}>
      <div className="codex-composer-input">{locale === "en" ? "Ask anything" : "随心输入"}</div>
      <div className="codex-composer-actions">
        <div><Plus weight="regular" /><ShieldCheck weight="regular" /><span>{locale === "en" ? "Approve for me" : "替我审批"}</span></div>
        <div><span>{locale === "en" ? "GPT 5.6 Sol Extra high" : "GPT 5.6 Sol 极高"}</span><CaretDown weight="bold" /><Microphone /><button type="button" tabIndex={-1}><ArrowUp weight="bold" /></button></div>
      </div>
    </div>
  );
}

function TaskWorkspace({ composer, locale }: { readonly composer: LayoutModule; readonly locale: StudioLocale }) {
  return (
    <div className="codex-task-content">
      <section className="codex-thread-pane">
        <header><div><Folder weight="regular" /><strong>{locale === "en" ? "Star Map Editor" : "星图编辑器"}</strong></div><span>main</span></header>
        <div className="codex-thread-messages">
          <article><small>{locale === "en" ? "You" : "你"}</small><p>{locale === "en" ? "Review the search and filtering module and fix the failing test." : "请检查搜索和筛选模块，并修复测试失败。"}</p></article>
          <article><small>ChatGPT</small><p>{locale === "en" ? "I’ll inspect the related code, then run the focused test." : "我会先阅读相关代码，再运行目标测试确认问题。"}</p></article>
        </div>
        <div className="codex-task-composer"><Composer module={composer} locale={locale} /></div>
      </section>
      <section className="codex-workbench">
        <nav aria-label={locale === "en" ? "Task tool preview" : "任务工具预览"}>
          <button type="button" tabIndex={-1}><ShieldCheck />{locale === "en" ? "Review" : "审阅"}</button>
          <button type="button" tabIndex={-1}><TerminalWindow />{locale === "en" ? "Terminal" : "终端"}</button>
          <button type="button" tabIndex={-1}><GridFour />{locale === "en" ? "Browser" : "浏览器"}</button>
          <button type="button" tabIndex={-1}><Folder />{locale === "en" ? "Files" : "文件"}</button>
        </nav>
        <section className="codex-review-panel">
          <header><strong>{locale === "en" ? "Review" : "审阅"}</strong><span>{locale === "en" ? "2 files changed" : "2 个文件已更改"}</span></header>
          <div><b>PreviewCanvas.tsx</b><span>+42 −8</span></div>
          <div><b>styles.css</b><span>+61 −14</span></div>
        </section>
        <section className="codex-terminal-panel">
          <header><TerminalWindow /><strong>{locale === "en" ? "Sample terminal" : "示例终端"}</strong></header>
          <pre>{locale === "en" ? <>PS D:\sample&gt; npm test{`\n`}PASS  theme coverage{`\n`}PS D:\sample&gt;</> : <>PS D:\示例工作区&gt; npm test{`\n`}PASS  主题覆盖测试{`\n`}PS D:\示例工作区&gt;</>}</pre>
        </section>
      </section>
    </div>
  );
}

export function PreviewCanvas({
  draft,
  mode = "home",
  locale = "zh-CN",
}: {
  readonly draft: StudioDraft | null;
  readonly mode?: PreviewMode;
  readonly locale?: StudioLocale;
}) {
  const theme = draft?.theme;
  const visual = useMemo(() => theme ? createThemeVisualModel(theme) : null, [theme]);
  const uiFontKey = theme?.typography.uiFontAssetKey;
  const codeFontKey = theme?.typography.codeFontAssetKey;
  const displayFontKey = theme?.typography.displayFontAssetKey;
  const uiFontPath = uiFontKey ? theme?.assets.fonts?.[uiFontKey] : undefined;
  const codeFontPath = codeFontKey ? theme?.assets.fonts?.[codeFontKey] : undefined;
  const uiFontUrl = uiFontPath ? draft?.assetUrls[uiFontPath] : undefined;
  const codeFontUrl = codeFontPath ? draft?.assetUrls[codeFontPath] : undefined;
  const displayFontPath = displayFontKey ? theme?.assets.fonts?.[displayFontKey] : undefined;
  const displayFontUrl = displayFontPath ? draft?.assetUrls[displayFontPath] : undefined;
  const [fontError, setFontError] = useState<string | null>(null);

  useEffect(() => {
    setFontError(null);
    if (typeof FontFace === "undefined" || !document.fonts) return;
    const fontSet = document.fonts as MutableFontFaceSet;
    const candidates = [
      uiFontKey && uiFontUrl ? { family: `ocs-${uiFontKey}`, url: uiFontUrl } : null,
      codeFontKey && codeFontUrl ? { family: `ocs-${codeFontKey}`, url: codeFontUrl } : null,
      displayFontKey && displayFontUrl
        ? { family: `ocs-${displayFontKey}`, url: displayFontUrl }
        : null,
    ].filter((value): value is { readonly family: string; readonly url: string } => value !== null);
    const definitions = Array.from(new Map(candidates.map((definition) => [
      `${definition.family}\u0000${definition.url}`,
      definition,
    ])).values());
    if (definitions.length === 0) return;

    let cancelled = false;
    const loadedFaces: FontFace[] = [];
    void Promise.all(definitions.map(async ({ family, url }) => {
      const face = new FontFace(family, `url(${JSON.stringify(url)})`);
      await face.load();
      if (!cancelled) {
        fontSet.add(face);
        loadedFaces.push(face);
      }
    })).catch(() => {
      if (!cancelled) setFontError(locale === "en" ? "The uploaded font could not be loaded. Choose a valid WOFF2 file." : "上传字体无法在预览中加载，请更换有效的 WOFF2 文件。");
    });

    return () => {
      cancelled = true;
      for (const face of loadedFaces) fontSet.delete(face);
    };
  }, [codeFontKey, codeFontUrl, displayFontKey, displayFontUrl, locale, uiFontKey, uiFontUrl]);

  const backgroundUrl = theme?.assets.background
    ? draft?.assetUrls[theme.assets.background]
    : undefined;
  const portraitUrl = theme?.assets.portrait
    ? draft?.assetUrls[theme.assets.portrait]
    : undefined;
  const profileImage = previewInterfaceImage(
    visual?.interfaceImagery.profileAvatar,
    draft?.assetUrls,
  );
  const suggestionImages: Readonly<Record<SuggestionIconSlot, PreviewInterfaceImage | undefined>> = {
    card1: previewInterfaceImage(visual?.interfaceImagery.suggestionIcons.card1, draft?.assetUrls),
    card2: previewInterfaceImage(visual?.interfaceImagery.suggestionIcons.card2, draft?.assetUrls),
    card3: previewInterfaceImage(visual?.interfaceImagery.suggestionIcons.card3, draft?.assetUrls),
    card4: previewInterfaceImage(visual?.interfaceImagery.suggestionIcons.card4, draft?.assetUrls),
  };
  const projectImages = (visual?.interfaceImagery.projectIcons ?? []).flatMap((image) => {
    const resolved = previewInterfaceImage(image, draft?.assetUrls);
    return resolved ? [resolved] : [];
  });
  const style: PreviewStyle = {
    "--preview-accent": visual?.colors.accent ?? "#9b9b9b",
    "--preview-secondary": visual?.colors.secondary ?? "#707070",
    "--preview-text": visual?.colors.text ?? "#f3f3f3",
    "--preview-text-secondary": visual?.colors.textSecondary ?? "#c8c8c8",
    "--preview-muted": visual?.colors.muted ?? "#8e8e8e",
    "--preview-link": visual?.colors.link ?? "#bdbdbd",
    "--preview-input-text": visual?.colors.inputText ?? "#f3f3f3",
    "--preview-placeholder": visual?.colors.placeholder ?? "#777777",
    "--preview-code-text": visual?.colors.codeText ?? "#f3f3f3",
    "--preview-panel": visual?.colors.panel ?? "rgba(24, 24, 24, 0.96)",
    "--preview-border": visual?.colors.border ?? "rgba(255, 255, 255, 0.13)",
    "--preview-gap": `${visual?.layout.moduleGap ?? 16}px`,
    "--preview-composer-width": `${(visual?.layout.composerWidth ?? 0.74) * 100}%`,
    "--preview-card-columns": String(visual?.layout.cardColumns ?? 4),
    "--preview-ui-size": `${visual?.typography.uiSize ?? 14}px`,
    "--preview-code-size": `${visual?.typography.codeSize ?? 13}px`,
    "--preview-ui-weight": String(visual?.typography.uiWeight ?? 500),
    "--preview-code-weight": String(visual?.typography.codeWeight ?? 400),
    "--preview-line-height": String(visual?.typography.lineHeight ?? 1.5),
    "--preview-ui-family": visual?.typography.uiFamily ?? "Microsoft YaHei UI",
    "--preview-code-family": visual?.typography.codeFamily ?? "Cascadia Code",
    "--preview-display-family": visual?.displayTypography.family ?? "Microsoft YaHei UI",
    "--preview-display-size": `${visual?.displayTypography.size ?? 31}px`,
    "--preview-display-weight": String(visual?.displayTypography.weight ?? 400),
    "--preview-display-line-height": String(visual?.displayTypography.lineHeight ?? 1.15),
    "--preview-display-letter-spacing": `${visual?.displayTypography.letterSpacingEm ?? -0.045}em`,
    "--preview-hero-height": `${visual?.layout.heroHeight ?? 380}px`,
    "--preview-background-x": `${visual?.background.positionXPercent ?? 50}%`,
    "--preview-background-y": `${visual?.background.positionYPercent ?? 50}%`,
    "--preview-background-scale": String(visual?.background.scale ?? 1),
    "--preview-background-blur": `${visual?.background.blurPx ?? 0}px`,
    "--preview-brightness": String(visual?.background.brightness ?? 1),
    "--preview-surface-panel-mix": `${visual?.surfaces.baseOpacityPercent ?? 68}%`,
    "--preview-elevated-panel-mix": `${visual?.surfaces.elevatedOpacityPercent ?? 92}%`,
    "--preview-terminal-panel-mix": `${visual?.surfaces.terminalOpacityPercent ?? 82}%`,
    "--preview-surface-blur": `${visual?.surfaces.blurPx ?? 0}px`,
    "--preview-task-background": visual
      ? createTaskSurfaceBackgroundCss(
        visual.background.taskMode,
        "var(--preview-panel)",
        visual.surfaces.baseOpacityPercent,
        visual.background.taskOpacityPercent,
      )
      : "color-mix(in srgb,var(--preview-panel) 68%,transparent)",
  };
  const modules = theme?.layout.modules ?? DEFAULT_MODULES;
  const sidebar = moduleById(modules, "sidebar");
  const topbar = moduleById(modules, "topbar");
  const hero = moduleById(modules, "hero");
  const suggestions = moduleById(modules, "suggestions");
  const composer = moduleById(modules, "composer");
  const taskBackground = moduleById(modules, "task-background");
  const contentLayer = moduleById(modules, "content-layer");
  const resolvedWelcome = resolveHomeWelcome(visual?.welcome?.localized, {
    locale,
    projectName: locale === "en" ? "Sample workspace" : "星崎皮肤实验室",
  });
  const welcomeLines = resolvedWelcome.kind === "custom"
    ? resolvedWelcome.lines
    : [locale === "en"
      ? "What should we do in the sample workspace?"
      : "我们应该在示例工作区中做些什么？"];
  const compositionSurface = (surface: ResolvedCompositionLayer["surface"]) => (
    <CompositionSurface
      surface={surface}
      layers={visual?.composition.layers ?? []}
      theme={theme}
      assetUrls={draft?.assetUrls}
    />
  );

  return (
    <div className="codex-preview-frame">
      {!draft ? <div className="preview-default-hint">{locale === "en" ? "Default ChatGPT Desktop preview · select a theme to begin" : "默认 ChatGPT Desktop 预览 · 选择主题后开始同步调整"}</div> : null}
      <div className="codex-preview" style={style}>
        {backgroundUrl ? (
          <img className="preview-background" src={backgroundUrl} alt={locale === "en" ? "Theme background" : "主题背景"} />
        ) : null}
        <div className="preview-overlay" style={{
          background: visual
            ? createSafeAreaOverlayCss(
              visual.background.safeArea,
              visual.background.overlayColor,
              "var(--preview-panel)",
            )
            : "transparent",
        }} />
        {compositionSurface("viewport")}
        <div className="preview-decorations" aria-hidden="true">
          {(theme?.decorations ?? []).filter((item) => item.enabled).flatMap((item, decorationIndex) => {
            const count = Math.round(item.intensity * 10);
            const imagePath = item.assetKey
              ? theme?.assets.decorations?.[item.assetKey]
              : undefined;
            const imageUrl = imagePath ? draft?.assetUrls[imagePath] : undefined;
            return Array.from({ length: count }, (_, index) => (
              <i
                key={`${decorationIndex}-${index}`}
                data-kind={item.type}
                style={{
                  ...decorationPosition(item.placement ?? "background", index, decorationIndex),
                  opacity: item.opacity ?? Math.min(0.65, item.intensity + 0.15),
                  transform: `scale(${item.scale ?? 1})`,
                  ...(imageUrl ? { backgroundImage: `url(${imageUrl})` } : {}),
                }}
              />
            ));
          })}
        </div>
        {fontError ? <div className="preview-font-warning" role="status">{fontError}</div> : null}
        {portraitUrl ? <img className="preview-portrait" src={portraitUrl} alt="" /> : null}
        <WindowTitlebar locale={locale} />
        <div className="codex-app-body" data-sidebar-visible={sidebar.visible}>
          {sidebar.visible ? (
            <CodexSidebar
              density={theme?.layout.sidebarDensity ?? "comfortable"}
              taskBackgroundVisible={taskBackground.visible}
              contentLayerVisible={contentLayer.visible}
              locale={locale}
              profileImage={profileImage}
              projectImages={projectImages}
            />
          ) : null}
          <main className="codex-main-surface" data-preview-mode={mode}>
            {compositionSurface("main")}
            {topbar.visible ? <MainTopbar /> : null}
            {mode === "task" ? <TaskWorkspace composer={composer} locale={locale} /> : (
              <div className="codex-home-content">
                {hero.visible ? <div className="codex-module-slot" style={moduleStyle(hero)}><Hero module={hero} lines={welcomeLines} composition={compositionSurface("home-hero")} layout={visual?.welcome?.layout} /></div> : null}
                {suggestions.visible ? (
                  <div className="codex-module-slot" style={moduleStyle(suggestions)}>
                    <Suggestions
                      module={suggestions}
                      columns={theme?.layout.cardColumns ?? 4}
                      locale={locale}
                      images={suggestionImages}
                      composition={compositionSurface("suggestions")}
                    />
                  </div>
                ) : null}
                <div className="codex-bottom-stack">
                  <div className="codex-module-slot codex-native-project-picker-slot"><ProjectPicker locale={locale} /></div>
                  {composer.visible ? <div className="codex-module-slot" style={moduleStyle(composer)}><Composer module={composer} locale={locale} /></div> : null}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
