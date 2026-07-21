import type {
  ThemeColors,
  ThemeDraftDocument,
  ThemeLayout,
  ThemeLayoutModule,
} from "./theme.js";

type ThemeVisualSource = Pick<
  ThemeDraftDocument,
  "appearance" | "colors" | "typography" | "background" | "surfaces" | "layout"
>;

type ResolvedAppearance = "light" | "dark";
type ResolvedSafeArea = "left" | "center" | "right" | "none";
type ResolvedTaskMode = "full" | "ambient" | "banner" | "off";

function colorChannels(value: string): readonly [number, number, number] {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ];
  }
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  return channels?.length === 3
    ? channels as unknown as readonly [number, number, number]
    : [255, 255, 255];
}

function perceivedLuminance(value: string): number {
  const [red, green, blue] = colorChannels(value);
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

function resolveAppearance(theme: ThemeVisualSource): ResolvedAppearance {
  if (theme.appearance !== "auto") return theme.appearance;
  return perceivedLuminance(theme.colors.text) >= 0.58 ? "dark" : "light";
}

function resolveSafeArea(theme: ThemeVisualSource): ResolvedSafeArea {
  if (theme.background.safeArea !== "auto") return theme.background.safeArea;
  if (theme.background.positionX >= 0.6) return "left";
  if (theme.background.positionX <= 0.4) return "right";
  return "center";
}

function resolveTaskMode(theme: ThemeVisualSource): ResolvedTaskMode {
  return theme.background.taskMode === "auto" ? "ambient" : theme.background.taskMode;
}

function toPercent(value: number): number {
  return Math.round(value * 10_000) / 100;
}

export function createSafeAreaOverlayCss(
  safeArea: ResolvedSafeArea,
  overlayColor: string,
  panelColor: string,
): string {
  if (safeArea === "none") return overlayColor;
  const direction = safeArea === "left"
    ? "90deg"
    : safeArea === "right"
      ? "270deg"
      : "circle at center";
  const gradient = safeArea === "center"
    ? `radial-gradient(${direction},color-mix(in srgb,${panelColor} 62%,transparent) 0 24%,transparent 72%)`
    : `linear-gradient(${direction},color-mix(in srgb,${panelColor} 68%,transparent) 0 28%,transparent 72%)`;
  return `${gradient},${overlayColor}`;
}

export function createTaskSurfaceBackgroundCss(
  taskMode: ResolvedTaskMode,
  panelColor: string,
  baseOpacityPercent: number,
  taskOpacityPercent: number,
): string {
  if (taskMode === "off") return panelColor;
  if (taskMode === "banner") {
    return `linear-gradient(to bottom,` +
      `color-mix(in srgb,${panelColor} ${taskOpacityPercent}%,transparent) 0 42%,` +
      `color-mix(in srgb,${panelColor} 96%,transparent) 72%)`;
  }
  const opacity = taskMode === "ambient" ? taskOpacityPercent : baseOpacityPercent;
  return `color-mix(in srgb,${panelColor} ${opacity}%,transparent)`;
}

export interface ThemeVisualModel {
  readonly appearance: {
    readonly mode: ThemeVisualSource["appearance"];
    readonly resolved: ResolvedAppearance;
  };
  readonly colors: ThemeColors;
  readonly typography: {
    readonly uiFamily: string;
    readonly codeFamily: string;
    readonly uiSize: number;
    readonly codeSize: number;
    readonly uiWeight: number;
    readonly codeWeight: number;
    readonly lineHeight: number;
  };
  readonly background: {
    readonly positionXPercent: number;
    readonly positionYPercent: number;
    readonly scale: number;
    readonly blurPx: number;
    readonly brightness: number;
    readonly overlayColor: string;
    readonly safeArea: ResolvedSafeArea;
    readonly taskModeMode: ThemeVisualSource["background"]["taskMode"];
    readonly taskMode: ResolvedTaskMode;
    readonly taskOpacityPercent: number;
  };
  readonly surfaces: {
    readonly baseOpacityPercent: number;
    readonly elevatedOpacityPercent: number;
    readonly terminalOpacityPercent: number;
    readonly blurPx: number;
  };
  readonly layout: ThemeLayout;
  readonly modules: Readonly<Record<ThemeLayoutModule["id"], ThemeLayoutModule>>;
}

export function createThemeVisualModel(theme: ThemeVisualSource): ThemeVisualModel {
  const modules = Object.fromEntries(
    theme.layout.modules.map((module) => [module.id, { ...module }]),
  ) as Record<ThemeLayoutModule["id"], ThemeLayoutModule>;
  return {
    appearance: {
      mode: theme.appearance,
      resolved: resolveAppearance(theme),
    },
    colors: { ...theme.colors },
    typography: {
      uiFamily: theme.typography.uiFamily,
      codeFamily: theme.typography.codeFamily,
      uiSize: theme.typography.uiSize * theme.typography.scale,
      codeSize: theme.typography.codeSize,
      uiWeight: theme.typography.uiWeight,
      codeWeight: theme.typography.codeWeight,
      lineHeight: theme.typography.lineHeight,
    },
    background: {
      positionXPercent: theme.background.positionX * 100,
      positionYPercent: theme.background.positionY * 100,
      scale: theme.background.scale,
      blurPx: theme.background.blur,
      brightness: theme.background.brightness,
      overlayColor: `rgba(0,0,0,${theme.background.overlay})`,
      safeArea: resolveSafeArea(theme),
      taskModeMode: theme.background.taskMode,
      taskMode: resolveTaskMode(theme),
      taskOpacityPercent: toPercent(theme.background.taskOpacity),
    },
    surfaces: {
      baseOpacityPercent: toPercent(theme.surfaces.baseOpacity),
      elevatedOpacityPercent: toPercent(theme.surfaces.elevatedOpacity),
      terminalOpacityPercent: toPercent(theme.surfaces.terminalOpacity),
      blurPx: theme.surfaces.blur,
    },
    layout: {
      ...theme.layout,
      modules: theme.layout.modules.map((module) => ({ ...module })),
    },
    modules,
  };
}
