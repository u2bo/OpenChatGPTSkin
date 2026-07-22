import type {
  StudioDraft,
  StudioThemeLibrary,
  StudioThemeRef,
  StudioUploadAssetInput,
} from "@open-chatgpt-skin/theme-studio-core";
import {
  createThemeVisualModel,
  NATIVE_GEOMETRY_MODULE_IDS,
  type SuggestionIconSlot,
  type ThemeDraftDocument,
  type ThemeInterfaceImageVisual,
} from "@open-chatgpt-skin/theme-schema";
import type { StudioTool } from "./types.js";
import type { StudioLocale } from "../studio/preferences.js";

type AssetSlot = StudioUploadAssetInput["slot"];
type InterfaceImageTarget = "profileAvatar" | SuggestionIconSlot;

const INTERFACE_IMAGE_FIELDS = [
  { target: "profileAvatar", slot: "profile-avatar", label: "用户头像", labelEn: "Profile avatar" },
  { target: "card1", slot: "suggestion-card1", label: "建议卡片 1", labelEn: "Suggestion card 1" },
  { target: "card2", slot: "suggestion-card2", label: "建议卡片 2", labelEn: "Suggestion card 2" },
  { target: "card3", slot: "suggestion-card3", label: "建议卡片 3", labelEn: "Suggestion card 3" },
  { target: "card4", slot: "suggestion-card4", label: "建议卡片 4", labelEn: "Suggestion card 4" },
] as const satisfies readonly {
  readonly target: InterfaceImageTarget;
  readonly slot: AssetSlot;
  readonly label: string;
  readonly labelEn: string;
}[];

const COLOR_FIELDS = [
  ["accent", "主色", "Accent"],
  ["secondary", "辅助色", "Secondary"],
  ["text", "主文字", "Primary text"],
  ["textSecondary", "次要文字", "Secondary text"],
  ["muted", "弱化文字", "Muted text"],
  ["link", "链接与强调", "Links and emphasis"],
  ["inputText", "输入文字", "Input text"],
  ["placeholder", "占位文字", "Placeholder"],
  ["codeText", "代码与终端文字", "Code and terminal text"],
  ["panel", "面板背景", "Panel background"],
  ["border", "边框", "Border"],
  ["success", "成功状态", "Success"],
  ["warning", "警告状态", "Warning"],
  ["danger", "错误状态", "Danger"],
  ["info", "信息状态", "Info"],
] as const;

const MODULE_LABELS = {
  sidebar: "侧边栏",
  topbar: "顶部栏",
  hero: "首页主视觉",
  suggestions: "建议卡片",
  "project-picker": "项目选择",
  composer: "输入框",
  "task-background": "任务背景",
  "content-layer": "内容层",
} as const;
const MODULE_LABELS_EN: Record<keyof typeof MODULE_LABELS, string> = {
  sidebar: "Sidebar",
  topbar: "Top bar",
  hero: "Home hero",
  suggestions: "Suggestion cards",
  "project-picker": "Project picker",
  composer: "Composer",
  "task-background": "Task background",
  "content-layer": "Content layer",
};

const DECORATION_LABELS = {
  particles: "粒子",
  ribbon: "丝带",
  butterflies: "蝴蝶",
  polaroid: "拍立得",
  badge: "徽章",
  sparkles: "闪光",
  image: "图片装饰",
} as const;
const DECORATION_LABELS_EN: Record<keyof typeof DECORATION_LABELS, string> = {
  particles: "Particles",
  ribbon: "Ribbon",
  butterflies: "Butterflies",
  polaroid: "Polaroid",
  badge: "Badge",
  sparkles: "Sparkles",
  image: "Image decoration",
};

const INSPECTOR_EN: Record<string, string> = {
  "属性检查器": "Inspector",
  "先从左侧主题库创建草稿，所有编辑才会在本地安全保存。": "Create or open a draft from the theme library before editing.",
  "语义颜色": "Semantic colors",
  "文字颜色会实时计算对比度，低于 4.5:1 时不能保存版本。": "Text contrast is checked live. Versions below 4.5:1 cannot be saved.",
  "背景": "Background",
  "界面素材": "Interface imagery",
  "为首页建议卡片和账户区域设置图片。清除后恢复 ChatGPT 官方视觉。": "Set images for home suggestions and the account area. Clear a slot to restore the ChatGPT default.",
  "上传图片": "Upload image",
  "替换图片": "Replace image",
  "清除": "Clear",
  "使用主题背景": "Use theme background",
  "官方默认": "ChatGPT default",
  "复用主题背景": "Uses theme background",
  "独立图片": "Custom image",
  "更换自有 / 已授权背景图片": "Replace owned / licensed background",
  "上传自有 / 已授权背景图片（必需）": "Upload owned / licensed background (required)",
  "上传人物 / 前景图片": "Upload portrait / foreground",
  "移除人物 / 前景图片": "Remove portrait / foreground",
  "界面明暗": "Interface appearance",
  "自动（根据文字颜色）": "Auto (from text color)",
  "浅色界面": "Light interface",
  "深色界面": "Dark interface",
  "文字安全区": "Text safe area",
  "自动避开图片焦点": "Avoid image focus automatically",
  "左侧": "Left",
  "居中": "Center",
  "右侧": "Right",
  "不增加安全区": "No safe area",
  "任务页背景": "Task background",
  "自动（柔和氛围）": "Auto (ambient)",
  "完整延续皮肤": "Full theme",
  "柔和氛围": "Ambient",
  "顶部横幅": "Top banner",
  "隐藏背景图": "Hide background",
  "水平焦点": "Horizontal focus",
  "垂直焦点": "Vertical focus",
  "缩放": "Scale",
  "模糊": "Blur",
  "亮度": "Brightness",
  "遮罩": "Overlay",
  "遮罩强度越低，背景图片越清晰。": "Lower overlay values keep the background clearer.",
  "任务页遮罩强度": "Task overlay",
  "基础面板遮罩强度": "Base panel opacity",
  "菜单 / 弹层遮罩强度": "Menu / overlay opacity",
  "终端面板遮罩强度": "Terminal opacity",
  "面板毛玻璃": "Panel blur",
  "字体": "Typography",
  "界面字体": "UI font",
  "代码字体": "Code font",
  "上传界面字体（WOFF2）": "Upload UI font (WOFF2)",
  "上传代码字体（WOFF2）": "Upload code font (WOFF2)",
  "移除上传的界面字体": "Remove uploaded UI font",
  "移除上传的代码字体": "Remove uploaded code font",
  "整体缩放": "Overall scale",
  "界面字号": "UI size",
  "代码字号": "Code size",
  "界面字重": "UI weight",
  "代码字重": "Code weight",
  "行高": "Line height",
  "装饰元素": "Decorations",
  "上传图片装饰": "Upload image decoration",
  "删除": "Delete",
  "启用": "Enabled",
  "位置": "Placement",
  "全局背景": "Global background",
  "四角": "Corners",
  "主视觉区域": "Hero area",
  "卡片区域": "Card area",
  "强度": "Intensity",
  "透明度": "Opacity",
  "模块布局": "Module layout",
  "隔离预览与真实 ChatGPT 使用同一布局契约；项目选择保持 ChatGPT 官方大小与位置，仅适配主题配色，其余安全模块可调整主视觉、卡片、输入框宽度、密度、显示、尺寸、对齐和间距。": "The preview and ChatGPT share one layout contract. Project selection keeps the native geometry; other safe modules can adjust hero, cards, composer, density, visibility, sizing, alignment, and spacing.",
  "主视觉高度": "Hero height",
  "卡片列数": "Card columns",
  "输入框宽度": "Composer width",
  "模块间距": "Module gap",
  "侧栏密度": "Sidebar density",
  "紧凑": "Compact",
  "舒适": "Comfortable",
  "当前 ChatGPT 版本的模块顺序受保护": "Module order is protected for this ChatGPT version",
  "显示": "Visible",
  "（受保护）": " (protected)",
  "尺寸": "Size",
  "常规": "Regular",
  "展开": "Expanded",
  "对齐": "Alignment",
  "拉伸": "Stretch",
  "下方间距": "Bottom spacing",
  "主题信息": "Theme details",
  "名称": "Name",
  "主题标识": "Theme ID",
  "作者": "Author",
  "描述": "Description",
  "主题链接": "Theme link",
  "英文名称": "English name",
  "英文描述": "English description",
  "许可证": "License",
  "署名": "Attribution",
  "素材来源地址": "Asset source URL",
  "仅本机使用": "Local use only",
  "版本记录": "Version history",
  "当前草稿": "Current draft",
  "尚未保存版本": "No saved version",
  "有未提交修改": "Uncommitted changes",
  "与已保存版本一致": "Matches saved version",
  "导出当前版本": "Export current version",
  "删除版本": "Delete version",
};

function tr(locale: StudioLocale, text: string): string {
  return locale === "en" ? INSPECTOR_EN[text] ?? text : text;
}

const PROTECTED_MODULES = new Set([
  "sidebar",
  "topbar",
  "composer",
  "task-background",
  "content-layer",
]);
const FIXED_LAYOUT_MODULES = new Set([
  "sidebar",
  "topbar",
  "composer",
  "task-background",
  "content-layer",
]);
const NATIVE_GEOMETRY_MODULES = new Set<string>(NATIVE_GEOMETRY_MODULE_IDS);
const MODULE_ORDER = (Object.keys(MODULE_LABELS) as Array<keyof typeof MODULE_LABELS>)
  .filter((id) => !NATIVE_GEOMETRY_MODULES.has(id));

function changedTheme(
  draft: StudioDraft,
  change: (theme: ThemeDraftDocument) => void,
): ThemeDraftDocument {
  const theme = structuredClone(draft.theme);
  change(theme);
  return theme;
}

function nextDecorationAssetKey(theme: ThemeDraftDocument): string {
  const used = new Set(Object.keys(theme.assets.decorations ?? {}));
  for (let index = 1; index <= 16; index += 1) {
    const key = `custom-${index}`;
    if (!used.has(key)) return key;
  }
  return "custom-16";
}

function removeDecoration(theme: ThemeDraftDocument, index: number): void {
  const [removed] = theme.decorations.splice(index, 1);
  if (!removed?.assetKey || theme.decorations.some((item) => item.assetKey === removed.assetKey)) {
    return;
  }
  if (theme.assets.decorations) {
    delete theme.assets.decorations[removed.assetKey];
    if (Object.keys(theme.assets.decorations).length === 0) {
      delete theme.assets.decorations;
    }
  }
}

function removeUploadedFont(theme: ThemeDraftDocument, kind: "ui" | "code"): void {
  const key = kind === "ui"
    ? theme.typography.uiFontAssetKey
    : theme.typography.codeFontAssetKey;
  if (key && theme.assets.fonts) {
    delete theme.assets.fonts[key];
    if (Object.keys(theme.assets.fonts).length === 0) delete theme.assets.fonts;
  }
  if (kind === "ui") {
    delete theme.typography.uiFontAssetKey;
    theme.typography.uiFamily = "Microsoft YaHei UI";
  } else {
    delete theme.typography.codeFontAssetKey;
    theme.typography.codeFamily = "Cascadia Code";
  }
}

function interfaceImagePath(
  theme: ThemeDraftDocument,
  target: InterfaceImageTarget,
): string | undefined {
  return target === "profileAvatar"
    ? theme.assets.profileAvatar
    : theme.assets.suggestionIcons?.[target];
}

function setInterfaceImagePath(
  theme: ThemeDraftDocument,
  target: InterfaceImageTarget,
  path: string | undefined,
): void {
  if (target === "profileAvatar") {
    if (path) theme.assets.profileAvatar = path;
    else delete theme.assets.profileAvatar;
    return;
  }

  if (path) {
    theme.assets.suggestionIcons = {
      ...theme.assets.suggestionIcons,
      [target]: path,
    };
    return;
  }

  if (!theme.assets.suggestionIcons) return;
  delete theme.assets.suggestionIcons[target];
  if (Object.keys(theme.assets.suggestionIcons).length === 0) {
    delete theme.assets.suggestionIcons;
  }
}

function updateEnglishMetadata(
  theme: ThemeDraftDocument,
  field: "name" | "description",
  value: string,
): void {
  const english = { ...(theme.metadata?.localized?.en ?? {}) };
  if (value) english[field] = value;
  else delete english[field];
  theme.metadata = {
    ...(theme.metadata ?? {}),
    localized: { ...(theme.metadata?.localized ?? {}), en: english },
  };
}

function updateThemeHomepage(theme: ThemeDraftDocument, value: string): void {
  const metadata = { ...(theme.metadata ?? {}) };
  if (value) metadata.homepage = value;
  else delete metadata.homepage;
  theme.metadata = metadata;
}

function FilePicker({
  label,
  accept,
  disabled,
  onPick,
}: {
  readonly label: string;
  readonly accept: string;
  readonly disabled: boolean;
  readonly onPick: (file: File) => void;
}) {
  return (
    <label className="file-picker">
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onPick(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function InterfaceImageCard({
  title,
  slot,
  value,
  visual,
  url,
  backgroundPath,
  busy,
  locale,
  onUpload,
  onClear,
  onUseBackground,
}: {
  readonly title: string;
  readonly slot: AssetSlot;
  readonly value: string | undefined;
  readonly visual: ThemeInterfaceImageVisual;
  readonly url: string | undefined;
  readonly backgroundPath: string | undefined;
  readonly busy: boolean;
  readonly locale: StudioLocale;
  readonly onUpload: (slot: AssetSlot, file: File) => void;
  readonly onClear: () => void;
  readonly onUseBackground: () => void;
}) {
  const status = visual.source === "background"
    ? tr(locale, "复用主题背景")
    : visual.source === "custom"
      ? tr(locale, "独立图片")
      : tr(locale, "官方默认");
  return (
    <article className="interface-image-card">
      <header><strong>{title}</strong><span>{status}</span></header>
      <div className="interface-image-thumbnail" data-avatar={slot === "profile-avatar"}>
        {url ? (
          <img
            src={url}
            alt={title}
            style={{ objectPosition: `${visual.positionXPercent}% ${visual.positionYPercent}%` }}
          />
        ) : <span>{tr(locale, "官方默认")}</span>}
      </div>
      <div className="interface-image-actions">
        <FilePicker
          label={tr(locale, value ? "替换图片" : "上传图片")}
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onPick={(file) => onUpload(slot, file)}
        />
        <button type="button" disabled={busy || !value} onClick={onClear}>{tr(locale, "清除")}</button>
        <button
          type="button"
          disabled={busy || !backgroundPath || value === backgroundPath}
          onClick={onUseBackground}
        >
          {tr(locale, "使用主题背景")}
        </button>
      </div>
    </article>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>{label}<output>{value}</output></span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function Inspector({
  tool,
  draft,
  library,
  busy,
  locale = "zh-CN",
  onChange,
  onUpload,
  onExport,
  onDeleteVersion,
}: {
  readonly tool: StudioTool;
  readonly draft: StudioDraft | null;
  readonly library: StudioThemeLibrary;
  readonly busy: boolean;
  readonly locale?: StudioLocale;
  readonly onChange: (theme: ThemeDraftDocument) => void;
  readonly onUpload: (slot: AssetSlot, file: File, assetKey?: string) => void;
  readonly onExport: () => void;
  readonly onDeleteVersion: (ref: StudioThemeRef) => void;
}) {
  if (!draft) {
    return (
      <div className="inspector-empty">
        <h2>{tr(locale, "属性检查器")}</h2>
        <p>{tr(locale, "先从左侧主题库创建草稿，所有编辑才会在本地安全保存。")}</p>
      </div>
    );
  }

  const theme = draft.theme;
  const commit = (change: (candidate: ThemeDraftDocument) => void) => {
    onChange(changedTheme(draft, change));
  };

  if (tool === "colors") {
    return (
      <>
        <h2>{tr(locale, "语义颜色")}</h2>
        <p className="inspector-lead">{tr(locale, "文字颜色会实时计算对比度，低于 4.5:1 时不能保存版本。")}</p>
        <div className="color-fields">
          {COLOR_FIELDS.map(([field, label, labelEn]) => {
            const value = theme.colors[field];
            return (
              <label className="color-field" key={field}>
                <span>{locale === "en" ? labelEn : label}</span>
                <span className="color-control">
                  {/^#[0-9a-f]{6}$/i.test(value) ? (
                    <input
                      type="color"
                      value={value}
                      disabled={busy}
                      onChange={(event) => commit((candidate) => {
                        candidate.colors[field] = event.currentTarget.value;
                      })}
                    />
                  ) : <i style={{ background: value }} />}
                  <input
                    key={`${field}-${value}`}
                    defaultValue={value}
                    disabled={busy}
                    onBlur={(event) => commit((candidate) => {
                      candidate.colors[field] = event.currentTarget.value;
                    })}
                  />
                </span>
              </label>
            );
          })}
        </div>
      </>
    );
  }

  if (tool === "background") {
    return (
      <>
        <h2>{tr(locale, "背景")}</h2>
        <FilePicker
          label={theme.assets.background
            ? tr(locale, "更换自有 / 已授权背景图片")
            : tr(locale, "上传自有 / 已授权背景图片（必需）")}
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onPick={(file) => onUpload("background", file)}
        />
        <FilePicker
          label={tr(locale, "上传人物 / 前景图片")}
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onPick={(file) => onUpload("portrait", file)}
        />
        {theme.assets.portrait ? <button type="button" className="wide-button" disabled={busy} onClick={() => commit((candidate) => { delete candidate.assets.portrait; })}>{tr(locale, "移除人物 / 前景图片")}</button> : null}
        <div className="inspector-fields">
          <label>{tr(locale, "界面明暗")}<select value={theme.appearance} disabled={busy} onChange={(event) => commit((candidate) => { candidate.appearance = event.currentTarget.value as typeof candidate.appearance; })}><option value="auto">{tr(locale, "自动（根据文字颜色）")}</option><option value="light">{tr(locale, "浅色界面")}</option><option value="dark">{tr(locale, "深色界面")}</option></select></label>
          <label>{tr(locale, "文字安全区")}<select value={theme.background.safeArea} disabled={busy} onChange={(event) => commit((candidate) => { candidate.background.safeArea = event.currentTarget.value as typeof candidate.background.safeArea; })}><option value="auto">{tr(locale, "自动避开图片焦点")}</option><option value="left">{tr(locale, "左侧")}</option><option value="center">{tr(locale, "居中")}</option><option value="right">{tr(locale, "右侧")}</option><option value="none">{tr(locale, "不增加安全区")}</option></select></label>
          <label>{tr(locale, "任务页背景")}<select value={theme.background.taskMode} disabled={busy} onChange={(event) => commit((candidate) => { candidate.background.taskMode = event.currentTarget.value as typeof candidate.background.taskMode; })}><option value="auto">{tr(locale, "自动（柔和氛围）")}</option><option value="full">{tr(locale, "完整延续皮肤")}</option><option value="ambient">{tr(locale, "柔和氛围")}</option><option value="banner">{tr(locale, "顶部横幅")}</option><option value="off">{tr(locale, "隐藏背景图")}</option></select></label>
          <RangeField label={tr(locale, "水平焦点")} value={theme.background.positionX} min={0} max={1} step={0.01} disabled={busy} onChange={(value) => commit((candidate) => { candidate.background.positionX = value; })} />
          <RangeField label={tr(locale, "垂直焦点")} value={theme.background.positionY} min={0} max={1} step={0.01} disabled={busy} onChange={(value) => commit((candidate) => { candidate.background.positionY = value; })} />
          <RangeField label={tr(locale, "缩放")} value={theme.background.scale} min={0.5} max={3} step={0.05} disabled={busy} onChange={(value) => commit((candidate) => { candidate.background.scale = value; })} />
          <RangeField label={tr(locale, "模糊")} value={theme.background.blur} min={0} max={30} step={1} disabled={busy} onChange={(value) => commit((candidate) => { candidate.background.blur = value; })} />
          <RangeField label={tr(locale, "亮度")} value={theme.background.brightness} min={0.3} max={1.5} step={0.05} disabled={busy} onChange={(value) => commit((candidate) => { candidate.background.brightness = value; })} />
          <RangeField label={tr(locale, "遮罩")} value={theme.background.overlay} min={0} max={0.9} step={0.02} disabled={busy} onChange={(value) => commit((candidate) => { candidate.background.overlay = value; })} />
          <p className="inspector-hint">{tr(locale, "遮罩强度越低，背景图片越清晰。")}</p>
          <RangeField label={tr(locale, "任务页遮罩强度")} value={theme.background.taskOpacity} min={0} max={1} step={0.02} disabled={busy} onChange={(value) => commit((candidate) => { candidate.background.taskOpacity = value; })} />
          <RangeField label={tr(locale, "基础面板遮罩强度")} value={theme.surfaces.baseOpacity} min={0} max={1} step={0.02} disabled={busy} onChange={(value) => commit((candidate) => { candidate.surfaces.baseOpacity = value; })} />
          <RangeField label={tr(locale, "菜单 / 弹层遮罩强度")} value={theme.surfaces.elevatedOpacity} min={0} max={1} step={0.02} disabled={busy} onChange={(value) => commit((candidate) => { candidate.surfaces.elevatedOpacity = value; })} />
          <RangeField label={tr(locale, "终端面板遮罩强度")} value={theme.surfaces.terminalOpacity} min={0} max={1} step={0.02} disabled={busy} onChange={(value) => commit((candidate) => { candidate.surfaces.terminalOpacity = value; })} />
          <RangeField label={tr(locale, "面板毛玻璃")} value={theme.surfaces.blur} min={0} max={30} step={1} disabled={busy} onChange={(value) => commit((candidate) => { candidate.surfaces.blur = value; })} />
        </div>
      </>
    );
  }

  if (tool === "imagery") {
    const visual = createThemeVisualModel(theme).interfaceImagery;
    return (
      <>
        <h2>{tr(locale, "界面素材")}</h2>
        <p className="inspector-lead">{tr(locale, "为首页建议卡片和账户区域设置图片。清除后恢复 ChatGPT 官方视觉。")}</p>
        <div className="interface-image-list">
          {INTERFACE_IMAGE_FIELDS.map((field) => {
            const value = interfaceImagePath(theme, field.target);
            const imageVisual = field.target === "profileAvatar"
              ? visual.profileAvatar
              : visual.suggestionIcons[field.target];
            const url = value ? draft.assetUrls[value] : undefined;
            return (
              <InterfaceImageCard
                key={field.target}
                title={locale === "en" ? field.labelEn : field.label}
                slot={field.slot}
                value={value}
                visual={imageVisual}
                url={url}
                backgroundPath={theme.assets.background}
                busy={busy}
                locale={locale}
                onUpload={onUpload}
                onClear={() => commit((candidate) => {
                  setInterfaceImagePath(candidate, field.target, undefined);
                })}
                onUseBackground={() => commit((candidate) => {
                  setInterfaceImagePath(candidate, field.target, candidate.assets.background);
                })}
              />
            );
          })}
        </div>
      </>
    );
  }

  if (tool === "typography") {
    return (
      <>
        <h2>{tr(locale, "字体")}</h2>
        <div className="inspector-fields">
          <label>{tr(locale, "界面字体")}<input key={theme.typography.uiFamily} defaultValue={theme.typography.uiFamily} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.typography.uiFamily = event.currentTarget.value; })} /></label>
          <label>{tr(locale, "代码字体")}<input key={theme.typography.codeFamily} defaultValue={theme.typography.codeFamily} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.typography.codeFamily = event.currentTarget.value; })} /></label>
          <FilePicker label={tr(locale, "上传界面字体（WOFF2）")} accept=".woff2,font/woff2" disabled={busy} onPick={(file) => onUpload("ui-font", file, "ui-font")} />
          <FilePicker label={tr(locale, "上传代码字体（WOFF2）")} accept=".woff2,font/woff2" disabled={busy} onPick={(file) => onUpload("code-font", file, "code-font")} />
          {theme.typography.uiFontAssetKey ? <button type="button" className="wide-button" disabled={busy} onClick={() => commit((candidate) => removeUploadedFont(candidate, "ui"))}>{tr(locale, "移除上传的界面字体")}</button> : null}
          {theme.typography.codeFontAssetKey ? <button type="button" className="wide-button" disabled={busy} onClick={() => commit((candidate) => removeUploadedFont(candidate, "code"))}>{tr(locale, "移除上传的代码字体")}</button> : null}
          <RangeField label={tr(locale, "整体缩放")} value={theme.typography.scale} min={0.85} max={1.3} step={0.01} disabled={busy} onChange={(value) => commit((candidate) => { candidate.typography.scale = value; })} />
          <RangeField label={tr(locale, "界面字号")} value={theme.typography.uiSize} min={12} max={22} step={1} disabled={busy} onChange={(value) => commit((candidate) => { candidate.typography.uiSize = value; })} />
          <RangeField label={tr(locale, "代码字号")} value={theme.typography.codeSize} min={11} max={22} step={1} disabled={busy} onChange={(value) => commit((candidate) => { candidate.typography.codeSize = value; })} />
          <label>{tr(locale, "界面字重")}<select value={theme.typography.uiWeight} disabled={busy} onChange={(event) => commit((candidate) => { candidate.typography.uiWeight = Number(event.currentTarget.value) as typeof candidate.typography.uiWeight; })}><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option></select></label>
          <label>{tr(locale, "代码字重")}<select value={theme.typography.codeWeight} disabled={busy} onChange={(event) => commit((candidate) => { candidate.typography.codeWeight = Number(event.currentTarget.value) as typeof candidate.typography.codeWeight; })}><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option></select></label>
          <RangeField label={tr(locale, "行高")} value={theme.typography.lineHeight} min={1.2} max={1.8} step={0.05} disabled={busy} onChange={(value) => commit((candidate) => { candidate.typography.lineHeight = value; })} />
        </div>
      </>
    );
  }

  if (tool === "decorations") {
    const addDecoration = (type: "particles" | "sparkles" | "ribbon" | "butterflies" | "polaroid" | "badge") => {
      commit((candidate) => {
        if (candidate.decorations.length >= 16) return;
        candidate.decorations.push({ type, enabled: true, intensity: 0.5 });
      });
    };
    return (
      <>
        <h2>{tr(locale, "装饰元素")}</h2>
        <div className="decoration-actions">
          {(["particles", "sparkles", "ribbon", "butterflies", "polaroid", "badge"] as const)
            .map((type) => <button type="button" disabled={busy || theme.decorations.length >= 16} onClick={() => addDecoration(type)} key={type}>＋ {locale === "en" ? DECORATION_LABELS_EN[type] : DECORATION_LABELS[type]}</button>)}
        </div>
        <FilePicker label={tr(locale, "上传图片装饰")} accept="image/png,image/jpeg,image/webp" disabled={busy} onPick={(file) => onUpload("decoration", file, nextDecorationAssetKey(theme))} />
        <div className="decoration-list">
          {theme.decorations.map((decoration, index) => (
            <article key={`${decoration.type}-${index}`}>
              <header><strong>{locale === "en" ? DECORATION_LABELS_EN[decoration.type] : DECORATION_LABELS[decoration.type]}</strong><button type="button" disabled={busy} onClick={() => commit((candidate) => removeDecoration(candidate, index))}>{tr(locale, "删除")}</button></header>
              <label className="checkbox-field"><input type="checkbox" checked={decoration.enabled} disabled={busy} onChange={(event) => commit((candidate) => { candidate.decorations[index]!.enabled = event.currentTarget.checked; })} />{tr(locale, "启用")}</label>
              <label>{tr(locale, "位置")}<select value={decoration.placement ?? "background"} disabled={busy} onChange={(event) => commit((candidate) => { candidate.decorations[index]!.placement = event.currentTarget.value as NonNullable<typeof decoration.placement>; })}><option value="background">{tr(locale, "全局背景")}</option><option value="corners">{tr(locale, "四角")}</option><option value="hero">{tr(locale, "主视觉区域")}</option><option value="cards">{tr(locale, "卡片区域")}</option></select></label>
              <RangeField label={tr(locale, "强度")} value={decoration.intensity} min={0} max={1} step={0.05} disabled={busy} onChange={(value) => commit((candidate) => { candidate.decorations[index]!.intensity = value; })} />
              <RangeField label={tr(locale, "透明度")} value={decoration.opacity ?? 0.5} min={0} max={1} step={0.05} disabled={busy} onChange={(value) => commit((candidate) => { candidate.decorations[index]!.opacity = value; })} />
              <RangeField label={tr(locale, "缩放")} value={decoration.scale ?? 1} min={0.25} max={3} step={0.05} disabled={busy} onChange={(value) => commit((candidate) => { candidate.decorations[index]!.scale = value; })} />
            </article>
          ))}
        </div>
      </>
    );
  }

  if (tool === "layout") {
    const modules = MODULE_ORDER.map((id) =>
      theme.layout.modules.find((module) => module.id === id),
    ).filter((module): module is NonNullable<typeof module> => Boolean(module));
    return (
      <>
        <h2>{tr(locale, "模块布局")}</h2>
        <p className="inspector-lead">{tr(locale, "隔离预览与真实 ChatGPT 使用同一布局契约；项目选择保持 ChatGPT 官方大小与位置，仅适配主题配色，其余安全模块可调整主视觉、卡片、输入框宽度、密度、显示、尺寸、对齐和间距。")}</p>
        <div className="inspector-fields">
          <RangeField label={tr(locale, "主视觉高度")} value={theme.layout.heroHeight} min={180} max={560} step={10} disabled={busy} onChange={(value) => commit((candidate) => { candidate.layout.heroHeight = value; })} />
          <RangeField label={tr(locale, "卡片列数")} value={theme.layout.cardColumns} min={2} max={4} step={1} disabled={busy} onChange={(value) => commit((candidate) => { candidate.layout.cardColumns = value; })} />
          <RangeField label={tr(locale, "输入框宽度")} value={theme.layout.composerWidth} min={0.5} max={1} step={0.05} disabled={busy} onChange={(value) => commit((candidate) => { candidate.layout.composerWidth = value; })} />
          <RangeField label={tr(locale, "模块间距")} value={theme.layout.moduleGap} min={0} max={48} step={2} disabled={busy} onChange={(value) => commit((candidate) => { candidate.layout.moduleGap = value; })} />
          <label>{tr(locale, "侧栏密度")}<select value={theme.layout.sidebarDensity} disabled={busy} onChange={(event) => commit((candidate) => { candidate.layout.sidebarDensity = event.currentTarget.value as "compact" | "comfortable"; })}><option value="compact">{tr(locale, "紧凑")}</option><option value="comfortable">{tr(locale, "舒适")}</option></select></label>
        </div>
        <div className="module-list">
          {modules.map((module) => {
            const fixedLayout = FIXED_LAYOUT_MODULES.has(module.id);
            return (
            <article key={module.id}>
              <header><strong>{locale === "en" ? MODULE_LABELS_EN[module.id] : MODULE_LABELS[module.id]}</strong><span title={tr(locale, "当前 ChatGPT 版本的模块顺序受保护")}><button type="button" disabled>↑</button><button type="button" disabled>↓</button></span></header>
              <label className="checkbox-field"><input type="checkbox" checked={module.visible} disabled={busy || PROTECTED_MODULES.has(module.id)} onChange={(event) => commit((candidate) => { candidate.layout.modules.find((item) => item.id === module.id)!.visible = event.currentTarget.checked; })} />{tr(locale, "显示")}{PROTECTED_MODULES.has(module.id) ? tr(locale, "（受保护）") : ""}</label>
              <label>{tr(locale, "尺寸")}<select value={module.size} disabled={busy || fixedLayout} onChange={(event) => commit((candidate) => { candidate.layout.modules.find((item) => item.id === module.id)!.size = event.currentTarget.value as typeof module.size; })}><option value="compact">{tr(locale, "紧凑")}</option><option value="regular">{tr(locale, "常规")}</option><option value="expanded">{tr(locale, "展开")}</option></select></label>
              <label>{tr(locale, "对齐")}<select value={module.align} disabled={busy || fixedLayout} onChange={(event) => commit((candidate) => { candidate.layout.modules.find((item) => item.id === module.id)!.align = event.currentTarget.value as typeof module.align; })}><option value="start">{tr(locale, "左侧")}</option><option value="center">{tr(locale, "居中")}</option><option value="end">{tr(locale, "右侧")}</option><option value="stretch">{tr(locale, "拉伸")}</option></select></label>
              <RangeField label={tr(locale, "下方间距")} value={module.spacing} min={0} max={48} step={2} disabled={busy || fixedLayout} onChange={(value) => commit((candidate) => { candidate.layout.modules.find((item) => item.id === module.id)!.spacing = value; })} />
            </article>
            );
          })}
        </div>
      </>
    );
  }

  if (tool === "details") {
    return (
      <>
        <h2>{tr(locale, "主题信息")}</h2>
        <div className="inspector-fields">
          <label>{tr(locale, "名称")}<input key={theme.name} defaultValue={theme.name} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.name = event.currentTarget.value; })} /></label>
          <label>{tr(locale, "主题标识")}<input key={theme.id} defaultValue={theme.id} disabled={busy || draft.savedRef !== null} onBlur={(event) => commit((candidate) => { candidate.id = event.currentTarget.value; })} /></label>
          <label>{tr(locale, "作者")}<input key={theme.author} defaultValue={theme.author} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.author = event.currentTarget.value; })} /></label>
          <label>{tr(locale, "描述")}<textarea key={theme.description ?? ""} defaultValue={theme.description ?? ""} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.description = event.currentTarget.value || undefined; })} /></label>
          <label>{tr(locale, "主题链接")}<input type="url" key={theme.metadata?.homepage ?? ""} defaultValue={theme.metadata?.homepage ?? ""} placeholder="https://" disabled={busy} onBlur={(event) => commit((candidate) => updateThemeHomepage(candidate, event.currentTarget.value.trim()))} /></label>
          <label>{tr(locale, "英文名称")}<input key={theme.metadata?.localized?.en?.name ?? ""} defaultValue={theme.metadata?.localized?.en?.name ?? ""} disabled={busy} onBlur={(event) => commit((candidate) => updateEnglishMetadata(candidate, "name", event.currentTarget.value.trim()))} /></label>
          <label>{tr(locale, "英文描述")}<textarea key={theme.metadata?.localized?.en?.description ?? ""} defaultValue={theme.metadata?.localized?.en?.description ?? ""} disabled={busy} onBlur={(event) => commit((candidate) => updateEnglishMetadata(candidate, "description", event.currentTarget.value.trim()))} /></label>
          <label>{tr(locale, "许可证")}<input key={theme.rights.licenseId} defaultValue={theme.rights.licenseId} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.rights.licenseId = event.currentTarget.value; })} /></label>
          <label>{tr(locale, "署名")}<input key={theme.rights.attribution ?? ""} defaultValue={theme.rights.attribution ?? ""} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.rights.attribution = event.currentTarget.value || undefined; })} /></label>
          <label>{tr(locale, "素材来源地址")}<input key={theme.rights.source ?? ""} defaultValue={theme.rights.source ?? ""} disabled={busy} onBlur={(event) => commit((candidate) => { candidate.rights.source = event.currentTarget.value || undefined; })} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={theme.rights.localOnly} disabled={busy} onChange={(event) => commit((candidate) => { candidate.rights.localOnly = event.currentTarget.checked; })} />{tr(locale, "仅本机使用")}</label>
        </div>
      </>
    );
  }

  const versions = library.themes.filter((item) =>
    item.source === "personal" && item.ref.id === theme.id
  ).slice().sort((left, right) => right.ref.version.localeCompare(
    left.ref.version,
    undefined,
    { numeric: true },
  ));
  return (
    <>
      <h2>{tr(locale, "版本记录")}</h2>
      <div className="version-current">
        <span>{tr(locale, "当前草稿")}</span>
        <strong>{draft.savedRef ? `${draft.savedRef.id}@${draft.savedRef.version}` : tr(locale, "尚未保存版本")}</strong>
        <small>{draft.dirty ? tr(locale, "有未提交修改") : tr(locale, "与已保存版本一致")}</small>
      </div>
      <button type="button" className="wide-button" disabled={busy || !draft.savedRef} onClick={onExport}>{tr(locale, "导出当前版本")}</button>
      <ol className="version-list">
        {versions.map((version) => (
          <li key={version.ref.version}>
            <span><strong>{version.ref.version}</strong><small>{version.name}</small></span>
            <button type="button" disabled={busy} aria-label={`${tr(locale, "删除版本")} ${version.ref.version}`} onClick={() => onDeleteVersion(version.ref)}>{tr(locale, "删除")}</button>
          </li>
        ))}
      </ol>
    </>
  );
}
