export type StudioTool =
  | "colors"
  | "background"
  | "typography"
  | "decorations"
  | "layout"
  | "details"
  | "versions";

export const STUDIO_TOOLS: readonly {
  readonly id: StudioTool;
  readonly label: string;
  readonly labelEn: string;
}[] = [
  { id: "colors", label: "颜色", labelEn: "Colors" },
  { id: "background", label: "背景", labelEn: "Background" },
  { id: "typography", label: "字体", labelEn: "Typography" },
  { id: "decorations", label: "装饰", labelEn: "Decorations" },
  { id: "layout", label: "模块布局", labelEn: "Layout" },
  { id: "details", label: "主题信息", labelEn: "Theme details" },
  { id: "versions", label: "版本记录", labelEn: "Versions" },
];
