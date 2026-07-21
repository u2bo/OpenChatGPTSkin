export type StudioLocale = "zh-CN" | "en";
export type StudioColorMode = "light" | "dark";

const STORAGE_KEY = "open-chatgpt-skin:studio-preferences:v1";

export interface StudioPreferences {
  readonly locale: StudioLocale;
  readonly colorMode: StudioColorMode;
}

function systemColorMode(): StudioColorMode {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readStudioPreferences(): StudioPreferences {
  const fallback = { locale: "zh-CN", colorMode: systemColorMode() } as const;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<StudioPreferences>;
    return {
      locale: value.locale === "zh-CN" || value.locale === "en" ? value.locale : fallback.locale,
      colorMode: value.colorMode === "light" || value.colorMode === "dark"
        ? value.colorMode
        : fallback.colorMode,
    };
  } catch {
    // Preferences are optional; storage can be unavailable in hardened browser profiles.
    return fallback;
  }
}

export function writeStudioPreferences(preferences: StudioPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The in-memory preference still works for the current session.
  }
}
