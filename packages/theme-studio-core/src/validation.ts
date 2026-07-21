import {
  ThemeDocumentSchema,
  type ThemeDraftDocument,
} from "@open-chatgpt-skin/theme-schema";
import type { StudioValidationIssue } from "./contracts.js";

interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

const FUNCTION_COLOR = /^(?:rgb|rgba)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;

function parseColor(value: string): Rgb {
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return {
      red: Number.parseInt(value.slice(1, 3), 16),
      green: Number.parseInt(value.slice(3, 5), 16),
      blue: Number.parseInt(value.slice(5, 7), 16),
      alpha: 1,
    };
  }
  const match = FUNCTION_COLOR.exec(value);
  if (!match) throw new Error(`Unsupported color: ${value}`);
  return {
    red: Number(match[1]),
    green: Number(match[2]),
    blue: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function composite(foreground: Rgb, background: Rgb): Rgb {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red: (foreground.red * foreground.alpha + background.red * background.alpha *
      (1 - foreground.alpha)) / alpha,
    green: (foreground.green * foreground.alpha + background.green * background.alpha *
      (1 - foreground.alpha)) / alpha,
    blue: (foreground.blue * foreground.alpha + background.blue * background.alpha *
      (1 - foreground.alpha)) / alpha,
    alpha,
  };
}

function luminance(value: Rgb): number {
  const channel = (candidate: number) => {
    const normalized = candidate / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return channel(value.red) * 0.2126 + channel(value.green) * 0.7152 +
    channel(value.blue) * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const opaqueWhite = { red: 255, green: 255, blue: 255, alpha: 1 };
  const surface = composite(parseColor(background), opaqueWhite);
  const text = composite(parseColor(foreground), surface);
  const lighter = Math.max(luminance(text), luminance(surface));
  const darker = Math.min(luminance(text), luminance(surface));
  return (lighter + 0.05) / (darker + 0.05);
}

export function validateStudioDraft(
  theme: ThemeDraftDocument,
): readonly StudioValidationIssue[] {
  const issues: StudioValidationIssue[] = [];
  const schema = ThemeDocumentSchema.safeParse(theme);
  if (!schema.success) {
    for (const issue of schema.error.issues) {
      issues.push({
        code: "THEME_SCHEMA_INVALID",
        path: issue.path.join("."),
        message: issue.message,
        severity: "error",
      });
    }
  }

  if (!theme.rights.localOnly && !theme.rights.attribution) {
    issues.push({
      code: "RIGHTS_ATTRIBUTION_REQUIRED",
      path: "rights.attribution",
      message: "可分享主题必须填写署名信息。",
      severity: "error",
    });
  }

  const fields = [
    "text",
    "textSecondary",
    "muted",
    "link",
    "inputText",
    "placeholder",
    "codeText",
    "success",
    "warning",
    "danger",
    "info",
  ] as const;
  for (const field of fields) {
    const ratio = contrastRatio(theme.colors[field], theme.colors.panel);
    if (ratio < 4.5) {
      issues.push({
        code: "TEXT_CONTRAST_TOO_LOW",
        path: `colors.${field}`,
        message: `与面板背景的对比度为 ${ratio.toFixed(2)}:1，至少需要 4.5:1。`,
        severity: "error",
      });
    }
  }
  return issues;
}
