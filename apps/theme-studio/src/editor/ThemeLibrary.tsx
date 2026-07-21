import {
  derivedBuiltinThemeId,
  personalThemeGroupKey,
  type StudioThemeListItem,
} from "@open-chatgpt-skin/theme-studio-core";
import { localizedTheme } from "../studio/i18n.js";
import type { StudioLocale } from "../studio/preferences.js";

const SOURCE_LABELS = {
  builtin: "内置主题",
  personal: "个人主题",
  recipe: "本地配方",
} as const;
const SOURCE_LABELS_EN = {
  builtin: "Built-in themes",
  personal: "Personal themes",
  recipe: "Local recipes",
} as const;

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function shouldReplaceVisibleTheme(
  current: StudioThemeListItem,
  candidate: StudioThemeListItem,
  builtinId: string | null,
): boolean {
  const versionDifference = compareVersions(candidate.ref.version, current.ref.version);
  if (versionDifference !== 0) return versionDifference > 0;

  if (builtinId) {
    const stableId = `${builtinId}-custom`;
    if (candidate.ref.id === stableId && current.ref.id !== stableId) return true;
    if (current.ref.id === stableId && candidate.ref.id !== stableId) return false;
  }

  return candidate.ref.id.localeCompare(current.ref.id) > 0;
}

export function visibleThemeItems(
  themes: readonly StudioThemeListItem[],
): readonly StudioThemeListItem[] {
  const builtinIds = themes
    .filter((theme) => theme.source === "builtin")
    .map((theme) => theme.ref.id)
    .sort((left, right) => right.length - left.length);
  const latestPersonal = new Map<string, StudioThemeListItem>();
  const visible: StudioThemeListItem[] = [];
  for (const theme of themes) {
    if (theme.source !== "personal") {
      visible.push(theme);
      continue;
    }
    const builtinId = derivedBuiltinThemeId(theme.ref.id, builtinIds);
    const groupKey = personalThemeGroupKey(theme.ref.id, builtinIds);
    const current = latestPersonal.get(groupKey);
    if (!current || shouldReplaceVisibleTheme(current, theme, builtinId)) {
      latestPersonal.set(groupKey, theme);
    }
  }
  return [...visible, ...latestPersonal.values()];
}

export function ThemeLibrary({
  themes,
  selectedRef,
  busy,
  locale = "zh-CN",
  onSelect,
  onDelete,
}: {
  readonly themes: readonly StudioThemeListItem[];
  readonly selectedRef: { readonly id: string; readonly version: string } | null;
  readonly busy: boolean;
  readonly locale?: StudioLocale;
  readonly onSelect: (theme: StudioThemeListItem) => void;
  readonly onDelete: (theme: StudioThemeListItem) => void;
}) {
  const visibleThemes = visibleThemeItems(themes);
  return (
    <div className="theme-groups">
      {(Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map((source) => {
        const items = visibleThemes.filter((theme) => theme.source === source);
        if (items.length === 0) return null;
        return (
          <section className="theme-group" key={source}>
            <h3>{locale === "en" ? SOURCE_LABELS_EN[source] : SOURCE_LABELS[source]}</h3>
            <ul className="theme-list">
              {items.map((theme) => {
                const localized = localizedTheme(theme, locale);
                const selected = selectedRef?.id === theme.ref.id &&
                  selectedRef.version === theme.ref.version;
                return (
                  <li className="theme-card-row" key={`${source}-${theme.ref.id}-${theme.ref.version}`}>
                    <button
                      type="button"
                      className={selected ? "theme-card selected" : "theme-card"}
                      disabled={busy}
                      onClick={() => onSelect(theme)}
                    >
                      <span
                        className="theme-card-preview"
                        style={theme.previewUrl
                          ? { backgroundImage: `url(${theme.previewUrl})` }
                          : undefined}
                      />
                      <span className="theme-card-copy">
                        <strong>{localized.name}</strong>
                        <small>
                          {theme.source === "recipe"
                            ? locale === "en" ? "Upload authorized assets to create" : "上传自有素材后创建"
                            : `${theme.ref.id} · ${theme.ref.version}`}
                        </small>
                      </span>
                    </button>
                    {theme.source === "personal" ? (
                      <button
                        type="button"
                        className="theme-delete-action"
                        aria-label={`${locale === "en" ? "Delete personal theme" : "删除个人主题"} ${theme.ref.id}`}
                        disabled={busy}
                        onClick={() => onDelete(theme)}
                      >
                        {locale === "en" ? "Delete" : "删除"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
