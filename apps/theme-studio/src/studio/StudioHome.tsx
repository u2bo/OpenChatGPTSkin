import {
  ArrowSquareOut,
  Check,
  DownloadSimple,
  GithubLogo,
  Moon,
  PaintBrushBroad,
  PlayCircle,
  Plus,
  Sparkle,
  StarFour,
  Sun,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type {
  StudioBootstrap,
  StudioRuntimeStatus,
  StudioThemeListItem,
} from "@open-chatgpt-skin/theme-studio-core";
import { localizedTheme, studioCopy } from "./i18n.js";
import type { StudioColorMode, StudioLocale } from "./preferences.js";

interface StudioHomeProps {
  readonly bootstrap: StudioBootstrap;
  readonly runtime: StudioRuntimeStatus;
  readonly themes: readonly StudioThemeListItem[];
  readonly selectedTheme: StudioThemeListItem | null;
  readonly locale: StudioLocale;
  readonly colorMode: StudioColorMode;
  readonly busy: boolean;
  readonly activeOperation: string | null;
  readonly onSelectTheme: (theme: StudioThemeListItem) => void;
  readonly onLocaleChange: (locale: StudioLocale) => void;
  readonly onColorModeChange: (mode: StudioColorMode) => void;
  readonly onOpenEditor: () => void;
  readonly onImport: (file: File) => void;
  readonly onApply: () => void;
  readonly onRestore: () => void;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}

function runtimeHomeLabel(
  runtime: StudioRuntimeStatus,
  locale: StudioLocale,
): string {
  const t = studioCopy(locale);
  if (runtime.status === "active") return t.runtimeActive;
  if (runtime.status === "paused" || runtime.status === "paused-incompatible") {
    return t.runtimePaused;
  }
  if (runtime.status === "stopped" || runtime.status === "restored-awaiting-exit") {
    return t.runtimeStopped;
  }
  return t.runtimeAttention;
}

function ThemeCard({
  theme,
  selected,
  active,
  locale,
  onSelect,
}: {
  readonly theme: StudioThemeListItem;
  readonly selected: boolean;
  readonly active: boolean;
  readonly locale: StudioLocale;
  readonly onSelect: () => void;
}) {
  const t = studioCopy(locale);
  const localized = localizedTheme(theme, locale);
  return (
    <button
      type="button"
      className={`home-theme-card${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="home-theme-art">
        {theme.previewUrl
          ? <span
              className="home-theme-image"
              aria-hidden="true"
              style={{ backgroundImage: `url("${theme.previewUrl}")` }}
            />
          : <span className="home-theme-fallback"><PaintBrushBroad weight="duotone" /></span>}
        {active ? <small className="home-card-badge active"><Check weight="bold" />{t.current}</small>
          : theme.source === "personal" ? <small className="home-card-badge">{t.imported}</small> : null}
      </span>
      <span className="home-theme-copy">
        <strong>{localized.name}</strong>
        <small>{localized.description ?? t.noDescription}</small>
        <span>v{theme.ref.version}<i>{t.use}</i></span>
      </span>
    </button>
  );
}

export function StudioHome(props: StudioHomeProps) {
  const {
    bootstrap,
    runtime,
    themes,
    selectedTheme,
    locale,
    colorMode,
    busy,
    activeOperation,
  } = props;
  const t = studioCopy(locale);
  const builtinThemes = themes.filter((theme) => theme.source === "builtin");
  const personalThemes = themes.filter((theme) => theme.source === "personal");
  const selectedCopy = selectedTheme ? localizedTheme(selectedTheme, locale) : null;
  const canRestore = ["active", "paused", "paused-incompatible", "recovery-required"]
    .includes(runtime.status);
  const isApplied = (theme: StudioThemeListItem) => runtime.appliedTheme?.id === theme.ref.id &&
    runtime.appliedTheme.version === theme.ref.version;
  const homeStyle = {
    "--home-sidebar-preview": selectedTheme?.previewUrl
      ? `url(${JSON.stringify(selectedTheme.previewUrl)})`
      : "none",
  } as CSSProperties;

  return (
    <main className="studio-home-shell" style={homeStyle}>
      <header className="home-topbar">
        <div className="home-brand-heading">
          <span><StarFour weight="fill" />OPEN CHATGPT SKIN</span>
          <div><h1>Theme Studio</h1><p>{t.brandTagline}</p></div>
        </div>
        <div className="home-top-actions">
          <div role="status" className={`home-runtime status-${runtime.status}`}>
            <i />{runtimeHomeLabel(runtime, locale)}
          </div>
          <button type="button" disabled={busy || !canRestore} onClick={props.onRestore}>
            {activeOperation === "restore" ? t.restoring : t.restore}
          </button>
          <button type="button" className="home-apply-top" disabled={busy || !selectedTheme?.ready} onClick={props.onApply}>
            <Sparkle weight="fill" />{activeOperation === "apply" ? t.applying : t.applyCodex}
          </button>
        </div>
      </header>

      <div className="home-frame">
        <aside className="home-sidebar">
          <div className="home-product"><StarFour className="home-product-logo" weight="duotone" /><strong>OpenChatGPTSkin</strong></div>
          <nav aria-label={t.themeLibrary}>
            <button type="button" className="active"><StarFour />{t.themeLibrary}</button>
            <label><UploadSimple />{t.importTheme}<input type="file" accept=".ocskin,application/vnd.open-chatgpt-skin+zip" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) props.onImport(file); event.currentTarget.value = ""; }} /></label>
          </nav>
          <button type="button" className="home-create-cta" disabled={busy || !selectedTheme} onClick={props.onOpenEditor}>
            <Sparkle weight="fill" />{t.sparkCreativity}
          </button>
          <div className="home-sidebar-spacer" />
          <div className="home-segmented" aria-label="Language">
            <button type="button" className={locale === "zh-CN" ? "active" : ""} onClick={() => props.onLocaleChange("zh-CN")}>{t.chinese}</button>
            <button type="button" className={locale === "en" ? "active" : ""} onClick={() => props.onLocaleChange("en")}>{t.english}</button>
          </div>
          <div className="home-segmented" aria-label="Color mode">
            <button type="button" className={colorMode === "light" ? "active" : ""} onClick={() => props.onColorModeChange("light")}><Sun />{t.light}</button>
            <button type="button" className={colorMode === "dark" ? "active" : ""} onClick={() => props.onColorModeChange("dark")}><Moon />{t.dark}</button>
          </div>
          <a className={`home-version-link${bootstrap.repositoryUrl ? "" : " disabled"}`} href={bootstrap.repositoryUrl ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!bootstrap.repositoryUrl} title={bootstrap.repositoryUrl ? undefined : t.repositoryPending}>
            <span>v{bootstrap.studioVersion}</span><span><GithubLogo />GitHub{bootstrap.repositoryUrl ? <ArrowSquareOut /> : null}</span>
          </a>
        </aside>

        <section className="home-gallery">
          <div className="home-hero-copy"><h2>{t.homeTitle}<Sparkle weight="fill" /></h2><p>{t.homeSubtitle}</p></div>
          <div className="home-section-heading"><h3>{t.myThemes}<Sparkle weight="fill" /></h3><span>{builtinThemes.length}</span></div>
          <div className="home-theme-grid">
            {builtinThemes.map((theme) => (
              <ThemeCard
                key={`${theme.source}:${theme.ref.id}@${theme.ref.version}`}
                theme={theme}
                selected={selectedTheme?.source === theme.source && selectedTheme.ref.id === theme.ref.id && selectedTheme.ref.version === theme.ref.version}
                active={isApplied(theme)}
                locale={locale}
                onSelect={() => props.onSelectTheme(theme)}
              />
            ))}
            <label className="home-action-card"><Plus /><strong>{t.importTheme}</strong><small>{t.importHint}</small><input type="file" accept=".ocskin,application/vnd.open-chatgpt-skin+zip" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) props.onImport(file); event.currentTarget.value = ""; }} /></label>
            <button type="button" className="home-action-card" disabled={busy || !selectedTheme} onClick={props.onOpenEditor}><StarFour weight="duotone" /><strong>{t.createTheme}</strong><small>{t.createHint}</small></button>
          </div>
          {personalThemes.length > 0 ? (
            <>
              <div className="home-section-heading personal"><h3>{t.personal}</h3><span>{personalThemes.length}</span></div>
              <div className="home-theme-grid personal">
                {personalThemes.map((theme) => (
                  <ThemeCard
                    key={`${theme.source}:${theme.ref.id}@${theme.ref.version}`}
                    theme={theme}
                    selected={selectedTheme?.source === theme.source && selectedTheme.ref.id === theme.ref.id && selectedTheme.ref.version === theme.ref.version}
                    active={isApplied(theme)}
                    locale={locale}
                    onSelect={() => props.onSelectTheme(theme)}
                  />
                ))}
              </div>
            </>
          ) : null}
          <div className="home-section-heading more"><h3>{t.moreThemes}</h3></div>
          <article className="home-community-card">
            <div><StarFour weight="duotone" /></div>
            <span><strong>{t.communityTitle}</strong><p>{t.communityDescription}</p></span>
            {bootstrap.repositoryUrl
              ? <a href={bootstrap.repositoryUrl} target="_blank" rel="noreferrer"><GithubLogo />{t.openGithub}<ArrowSquareOut /></a>
              : <button type="button" disabled title={t.repositoryPending}><GithubLogo />{t.repositoryPending}</button>}
          </article>
        </section>

        <aside className="home-details" aria-label={t.description}>
          {selectedTheme && selectedCopy ? (
            <>
              <div className="home-detail-title"><span><h2>{selectedCopy.name}</h2><small>{isApplied(selectedTheme) ? t.current : t[selectedTheme.source]}</small></span></div>
              <div className="home-detail-preview">{selectedTheme.previewUrl
                ? <span
                    className="home-detail-image"
                    aria-hidden="true"
                    style={{ backgroundImage: `url("${selectedTheme.previewUrl}")` }}
                  />
                : <PaintBrushBroad weight="duotone" />}</div>
              <dl>
                <div><dt>{t.version}</dt><dd>v{selectedTheme.ref.version}</dd></div>
                <div><dt>{t.author}</dt><dd>{selectedTheme.author}</dd></div>
                <div><dt>{t.source}</dt><dd>{t[selectedTheme.source]}</dd></div>
                <div><dt>{t.themeLink}</dt><dd>{selectedTheme.homepage ? <a href={selectedTheme.homepage} target="_blank" rel="noreferrer">{selectedTheme.homepage}<ArrowSquareOut /></a> : t.noLink}</dd></div>
              </dl>
              <section className="home-description"><h3>{t.description}</h3><p>{selectedCopy.description ?? t.noDescription}</p></section>
              <button type="button" className="home-detail-apply" disabled={busy || !selectedTheme.ready} onClick={props.onApply}><PlayCircle weight="fill" />{activeOperation === "apply" ? t.applying : t.applyAndLaunch}</button>
              <div className="home-detail-secondary">
                <button
                  type="button"
                  disabled={busy || !selectedTheme.ready || selectedTheme.source !== "personal"}
                  title={selectedTheme.source === "personal" ? undefined : t.exportPersonalOnly}
                  onClick={props.onExport}
                ><DownloadSimple />{t.exportTheme}</button>
                <button type="button" className="danger" disabled={busy || selectedTheme.source !== "personal"} onClick={props.onDelete}><Trash />{t.deleteTheme}</button>
              </div>
            </>
          ) : <div className="home-empty-detail"><PaintBrushBroad weight="duotone" /><p>{t.homeSubtitle}</p></div>}
        </aside>
      </div>
    </main>
  );
}
