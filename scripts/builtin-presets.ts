export interface BuiltinPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly nameEn: string;
  readonly descriptionEn: string;
  readonly version: string;
  readonly generationPrompt: string;
  readonly appearance: "light" | "dark";
  readonly colors: Readonly<Record<
    | "accent"
    | "secondary"
    | "text"
    | "textSecondary"
    | "muted"
    | "link"
    | "inputText"
    | "placeholder"
    | "codeText"
    | "panel"
    | "border"
    | "success"
    | "warning"
    | "danger"
    | "info",
    string
  >>;
  readonly background: {
    readonly positionX: number;
    readonly positionY: number;
    readonly brightness: number;
    readonly overlay: number;
    readonly safeArea: "left" | "center" | "right" | "none";
    readonly taskMode: "full" | "ambient" | "banner" | "off";
    readonly taskOpacity: number;
  };
  readonly surfaces: {
    readonly baseOpacity: number;
    readonly elevatedOpacity: number;
    readonly terminalOpacity: number;
    readonly blur: number;
  };
  readonly decorations: readonly {
    readonly type:
      | "particles"
      | "ribbon"
      | "butterflies"
      | "polaroid"
      | "badge"
      | "sparkles"
      | "image";
    readonly enabled: boolean;
    readonly intensity: number;
  }[];
}

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  {
    id: "future-idol-cyan",
    name: "未来歌姬",
    description: "青蓝霓虹与未来舞台交织的清爽创作空间。",
    nameEn: "Future Idol",
    descriptionEn: "A luminous cyan creative space shaped by a futuristic stage.",
    version: "1.2.2",
    generationPrompt: "Original adult futuristic virtual vocalist on the right side of a luminous cyan, blue, and magenta sci-fi stage, silver-blue high ponytail, holographic ribbons and crystalline light, spacious low-detail pale-cyan interface-safe area on the left, no logos, no copyrighted character traits, no text, 16:9.",
    appearance: "light",
    colors: {
      accent: "#087f9c",
      secondary: "#c23d9a",
      text: "#102d42",
      textSecondary: "#365a70",
      muted: "#4f6878",
      link: "#006e91",
      inputText: "#102d42",
      placeholder: "#4f6878",
      codeText: "#143c58",
      panel: "#f2fbff",
      border: "rgba(24, 148, 186, 0.34)",
      success: "#147457",
      warning: "#8a5800",
      danger: "#b4235f",
      info: "#006eaa",
    },
    background: {
      positionX: 0.68,
      positionY: 0.48,
      brightness: 0.94,
      overlay: 0.04,
      safeArea: "left",
      taskMode: "full",
      taskOpacity: 0.52,
    },
    surfaces: {
      baseOpacity: 0.34,
      elevatedOpacity: 0.72,
      terminalOpacity: 0.82,
      blur: 0,
    },
    decorations: [
      { type: "sparkles", enabled: true, intensity: 0.58 },
      { type: "ribbon", enabled: true, intensity: 0.35 },
    ],
  },
  {
    id: "rose-carpet-star",
    name: "玫瑰星光",
    description: "玫瑰金、柔光与典雅氛围构成的温暖主题。",
    nameEn: "Rose Starlight",
    descriptionEn: "A warm, elegant theme with rose gold tones and soft light.",
    version: "1.2.2",
    generationPrompt: "Luxurious original rose-gold cinematic gala corridor with burgundy carpet, red and blush roses, mirrored gold columns, warm sparkling light, a small anonymous silhouette far in the right background, spacious low-detail champagne interface-safe area on the left, no celebrity likeness, no logos, no text, 16:9.",
    appearance: "light",
    colors: {
      accent: "#a92f4b",
      secondary: "#c77855",
      text: "#3b1b23",
      textSecondary: "#6e4650",
      muted: "#8c6971",
      link: "#982842",
      inputText: "#3b1b23",
      placeholder: "#76515a",
      codeText: "#572835",
      panel: "#fff6f2",
      border: "rgba(169, 47, 75, 0.3)",
      success: "#2d6f51",
      warning: "#8a570d",
      danger: "#bc2949",
      info: "#7b5877",
    },
    background: {
      positionX: 0.7,
      positionY: 0.5,
      brightness: 0.94,
      overlay: 0.05,
      safeArea: "left",
      taskMode: "full",
      taskOpacity: 0.58,
    },
    surfaces: {
      baseOpacity: 0.38,
      elevatedOpacity: 0.78,
      terminalOpacity: 0.84,
      blur: 0,
    },
    decorations: [
      { type: "polaroid", enabled: true, intensity: 0.55 },
      { type: "ribbon", enabled: true, intensity: 0.48 },
    ],
  },
  {
    id: "mountain-mist",
    name: "山岚云海",
    description: "山色、云海与晨光带来的沉静自然体验。",
    nameEn: "Mountain Mist",
    descriptionEn: "A calm natural theme of mountain ranges, cloud seas, and morning light.",
    version: "1.2.2",
    generationPrompt: "Photorealistic original eastern mountain ranges above a sea of clouds at sunrise, forest-green peaks, pale mist, warm golden light, dominant mountain on the right, spacious low-detail cloud and sky interface-safe area on the left, no buildings, no people, no logos, no text, 16:9.",
    appearance: "light",
    colors: {
      accent: "#3f7257",
      secondary: "#a77a32",
      text: "#17271f",
      textSecondary: "#465d51",
      muted: "#56675e",
      link: "#2d684c",
      inputText: "#17271f",
      placeholder: "#56675e",
      codeText: "#244034",
      panel: "#f7f8f0",
      border: "rgba(63, 114, 87, 0.3)",
      success: "#2d704b",
      warning: "#88600f",
      danger: "#b33c4e",
      info: "#3b7380",
    },
    background: {
      positionX: 0.68,
      positionY: 0.48,
      brightness: 0.91,
      overlay: 0.06,
      safeArea: "left",
      taskMode: "full",
      taskOpacity: 0.56,
    },
    surfaces: {
      baseOpacity: 0.36,
      elevatedOpacity: 0.76,
      terminalOpacity: 0.84,
      blur: 0,
    },
    decorations: [{ type: "particles", enabled: true, intensity: 0.22 }],
  },
  {
    id: "glacier-aurora",
    name: "冰川极光",
    description: "深蓝冰川与极光交汇的专注暗色主题。",
    nameEn: "Glacier Aurora",
    descriptionEn: "A focused dark theme where deep-blue glaciers meet the aurora.",
    version: "1.2.2",
    generationPrompt: "Photorealistic original blue glacier and dark arctic sea beneath sweeping cyan, green, and violet aurora, deep navy star field, monumental ice formation on the right, spacious low-detail night-sky interface-safe area on the left, no people, no logos, no text, 16:9.",
    appearance: "dark",
    colors: {
      accent: "#54dfd0",
      secondary: "#9f82ff",
      text: "#f0f9ff",
      textSecondary: "#c6d9eb",
      muted: "#8fa8c0",
      link: "#75e9df",
      inputText: "#f0f9ff",
      placeholder: "#91abc3",
      codeText: "#ddf8ff",
      panel: "#081a30",
      border: "rgba(84, 223, 208, 0.34)",
      success: "#5cdfa8",
      warning: "#f2c46d",
      danger: "#ff8da1",
      info: "#6fc8ff",
    },
    background: {
      positionX: 0.68,
      positionY: 0.5,
      brightness: 0.9,
      overlay: 0.08,
      safeArea: "left",
      taskMode: "full",
      taskOpacity: 0.58,
    },
    surfaces: {
      baseOpacity: 0.42,
      elevatedOpacity: 0.78,
      terminalOpacity: 0.84,
      blur: 0,
    },
    decorations: [{ type: "sparkles", enabled: true, intensity: 0.26 }],
  },
] as const;
