import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { House, Moon, Sun } from "@phosphor-icons/react";
import {
  StudioError,
  type StudioBootstrap,
  type StudioBridge,
  type StudioDraft,
  type StudioThemeLibrary,
  type StudioThemeListItem,
  type StudioUploadAssetInput,
} from "@open-chatgpt-skin/theme-studio-core";
import type { ThemeDraftDocument } from "@open-chatgpt-skin/theme-schema";
import { Inspector } from "./editor/Inspector.js";
import { PreviewCanvas, type PreviewMode } from "./editor/PreviewCanvas.js";
import { ThemeLibrary, visibleThemeItems } from "./editor/ThemeLibrary.js";
import { STUDIO_TOOLS, type StudioTool } from "./editor/types.js";
import { localizedTheme, studioCopy } from "./studio/i18n.js";
import {
  readStudioPreferences,
  writeStudioPreferences,
  type StudioColorMode,
  type StudioLocale,
} from "./studio/preferences.js";
import { StudioHome } from "./studio/StudioHome.js";

type ThemeItem = StudioThemeListItem;
type StudioOperation = "general" | "history" | "save" | "delete" | "apply" | "restore";
type LeftPanel = "library" | "tools";

const EMPTY_LIBRARY: StudioThemeLibrary = { themes: [] };

function themeSelectionKey(theme: ThemeItem): string {
  return `${theme.source}:${theme.ref.id}@${theme.ref.version}`;
}

function runtimeLabel(
  status: StudioBootstrap["runtime"]["status"],
  locale: StudioLocale,
): string {
  if (locale === "en") {
    if (status === "stopped") return "Runtime stopped";
    if (status === "active") return "Theme active";
    if (status === "paused") return "Theme paused";
    if (status === "paused-incompatible") return "Theme paused (incompatible)";
    if (status === "recovery-required") return "Safe recovery required";
    if (status === "restored-awaiting-exit") return "Waiting for ChatGPT to exit";
    return `Runtime: ${status}`;
  }
  if (status === "stopped") return "Runtime 已停止";
  if (status === "active") return "主题运行中";
  if (status === "paused") return "主题已暂停";
  if (status === "paused-incompatible") return "主题已暂停（需兼容主题）";
  if (status === "recovery-required") return "需要安全恢复";
  if (status === "restored-awaiting-exit") return "等待 ChatGPT 正常退出";
  return `Runtime：${status}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof StudioError) {
    return error.nextAction ? `${error.message} ${error.nextAction}` : error.message;
  }
  return error instanceof Error ? error.message : "操作失败";
}

function downloadTheme(fileName: string, mimeType: string, bytes: Uint8Array): void {
  const blob = new Blob([Uint8Array.from(bytes).buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ThemeStudioApp({
  bootstrap,
  bridge,
  initialView = "home",
}: {
  readonly bootstrap: StudioBootstrap;
  readonly bridge: StudioBridge;
  readonly initialView?: "home" | "editor";
}) {
  const [view, setView] = useState<"home" | "editor">(initialView);
  const [preferences, setPreferences] = useState(readStudioPreferences);
  const [runtime, setRuntime] = useState(bootstrap.runtime);
  const [library, setLibrary] = useState<StudioThemeLibrary>(EMPTY_LIBRARY);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<ThemeItem | null>(null);
  const [draftConflict, setDraftConflict] = useState<ThemeItem | null>(null);
  const [tool, setTool] = useState<StudioTool>("colors");
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("library");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("home");
  const [operationCount, setOperationCount] = useState(0);
  const [activeOperation, setActiveOperation] = useState<StudioOperation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serverDraftRef = useRef<StudioDraft | null>(null);
  const visibleDraftRef = useRef<StudioDraft | null>(null);
  const openedSelectionRef = useRef<string | null>(null);

  const busy = operationCount > 0;
  const t = studioCopy(preferences.locale);

  useEffect(() => {
    document.documentElement.dataset.studioTheme = preferences.colorMode;
    document.documentElement.lang = preferences.locale;
    writeStudioPreferences(preferences);
  }, [preferences]);

  const setLocale = useCallback((locale: StudioLocale) => {
    setPreferences((current) => ({ ...current, locale }));
  }, []);

  const setColorMode = useCallback((colorMode: StudioColorMode) => {
    setPreferences((current) => ({ ...current, colorMode }));
  }, []);

  const loadLibrary = useCallback(async () => {
    const next = await bridge.listThemes();
    startTransition(() => {
      setLibrary(next);
      setSelectedTheme((current) => {
        const same = current && next.themes.find((theme) =>
          theme.source === current.source && theme.ref.id === current.ref.id &&
          theme.ref.version === current.ref.version
        );
        if (same) return same;
        const applied = bootstrap.runtime.appliedTheme;
        return (applied && next.themes.find((theme) =>
          theme.ref.id === applied.id && theme.ref.version === applied.version
        )) || next.themes.find((theme) => theme.source === "builtin") || next.themes[0] || null;
      });
    });
    return next;
  }, [bootstrap.runtime.appliedTheme, bridge]);

  useEffect(() => {
    void Promise.all([loadLibrary(), bridge.openLatestDraft()])
      .then(([, latestDraft]) => {
        if (!latestDraft || serverDraftRef.current) return;
        serverDraftRef.current = latestDraft;
        visibleDraftRef.current = latestDraft;
        setDraft(latestDraft);
      })
      .catch((loadError: unknown) => setError(errorMessage(loadError)));
    return bridge.subscribeEvents((event) => {
      if (event.kind === "runtime-status") setRuntime(event.runtime);
    });
  }, [bridge, loadLibrary]);

  const runOperation = useCallback(async (
    operation: () => Promise<void>,
    operationName: StudioOperation = "general",
  ): Promise<void> => {
    setOperationCount((count) => count + 1);
    setActiveOperation(operationName);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally {
      setOperationCount((count) => Math.max(0, count - 1));
      setActiveOperation(null);
    }
  }, []);

  const replaceDraft = useCallback((next: StudioDraft) => {
    serverDraftRef.current = next;
    visibleDraftRef.current = next;
    setDraft(next);
  }, []);

  const clearDraft = useCallback(() => {
    serverDraftRef.current = null;
    visibleDraftRef.current = null;
    openedSelectionRef.current = null;
    setDraft(null);
  }, []);

  const changeTheme = useCallback((theme: ThemeDraftDocument) => {
    setNotice(null);
    setDraft((visible) => {
      if (!visible) return visible;
      const next = {
        ...visible,
        theme,
        dirty: true,
        undoAvailable: true,
        redoAvailable: false,
      };
      visibleDraftRef.current = next;
      return next;
    });
  }, []);

  const persistVisibleDraft = useCallback(async (): Promise<StudioDraft | null> => {
    const base = serverDraftRef.current;
    const visible = visibleDraftRef.current;
    if (!base || !visible) return null;
    if (visible.theme === base.theme) return base;
    const next = await bridge.updateDraft({
      draftId: base.draftId,
      expectedRevision: base.revision,
      theme: visible.theme,
    });
    replaceDraft(next);
    return next;
  }, [bridge, replaceDraft]);

  const openSelectedTheme = useCallback((
    theme: ThemeItem,
    conflictResolution?: "load-existing" | "overwrite-existing",
  ) => {
    void runOperation(async () => {
      let next: StudioDraft;
      try {
        next = await bridge.createDraft({
          source: { source: theme.source, ref: theme.ref },
          ...(theme.source === "personal"
            ? { themeId: theme.ref.id, name: theme.name }
            : {}),
          ...(conflictResolution ? { conflictResolution } : {}),
        });
      } catch (openError) {
        if (openError instanceof StudioError &&
          openError.code === "STUDIO_DRAFT_CONFLICT" && !conflictResolution) {
          setDraftConflict(theme);
          return;
        }
        throw openError;
      }
      replaceDraft(next);
      openedSelectionRef.current = themeSelectionKey(theme);
      setSelectedTheme(theme);
      setDraftConflict(null);
      setLeftPanel("tools");
      setTool(theme.source === "recipe" ? "background" : "colors");
      setView("editor");
      setNotice(`已打开“${next.theme.name}”草稿`);
    });
  }, [bridge, replaceDraft, runOperation]);

  const selectTheme = useCallback((theme: ThemeItem) => {
    setSelectedTheme(theme);
    setError(null);
    if (openedSelectionRef.current === themeSelectionKey(theme)) {
      setLeftPanel("tools");
      return;
    }
    openSelectedTheme(theme);
  }, [openSelectedTheme]);

  const selectLeftPanel = useCallback((panel: LeftPanel) => {
    setLeftPanel(panel);
  }, []);

  const cancelDraftConflict = useCallback(() => {
    setDraftConflict(null);
  }, []);

  const draftCommand = useCallback(async (
    command: "undo" | "redo" | "save" | "apply",
  ) => {
    await runOperation(async () => {
      const current = command === "apply"
        ? visibleDraftRef.current
        : await persistVisibleDraft();
      if (!current) return;
      if (command === "apply" && (current.dirty || !current.savedRef)) {
        throw new StudioError(
          "STUDIO_APPLY_FAILED",
          "主题存在未保存修改",
          "请先点击“保存版本”，再应用到 ChatGPT。",
        );
      }
      const input = { draftId: current.draftId, expectedRevision: current.revision };
      if (command === "undo" || command === "redo") {
        replaceDraft(await bridge[command](input));
        return;
      }
      if (command === "save") {
        const result = await bridge.saveVersion(input);
        replaceDraft(result.draft);
        await loadLibrary();
        setNotice(`已保存 ${result.ref.id}@${result.ref.version}`);
        return;
      }
      const result = await bridge.applyTheme(input);
      replaceDraft(result.draft);
      setRuntime(result.runtime);
      setNotice(`已应用 ${result.ref.id}@${result.ref.version}`);
      void loadLibrary().catch((libraryError: unknown) => setError(errorMessage(libraryError)));
    }, command === "apply" ? "apply" : command === "save" ? "save" : "history");
  }, [bridge, loadLibrary, persistVisibleDraft, replaceDraft, runOperation]);

  const restoreOriginal = useCallback(() => {
    void runOperation(async () => {
      const restored = await bridge.restoreRuntime();
      setRuntime(restored);
      setNotice("已恢复 ChatGPT 原始皮肤，请正常退出 ChatGPT 完成清理。");
    }, "restore");
  }, [bridge, runOperation]);

  const uploadAsset = useCallback((
    slot: StudioUploadAssetInput["slot"],
    file: File,
    assetKey?: string,
  ) => {
    void runOperation(async () => {
      const current = await persistVisibleDraft();
      if (!current) return;
      const next = await bridge.uploadAsset({
        draftId: current.draftId,
        expectedRevision: current.revision,
        slot,
        ...(assetKey ? { assetKey } : {}),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      replaceDraft(next);
      setNotice(`已处理素材：${file.name}`);
    });
  }, [bridge, persistVisibleDraft, replaceDraft, runOperation]);

  const importTheme = useCallback((file: File) => {
    void runOperation(async () => {
      const next = await bridge.importTheme({
        fileName: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      replaceDraft(next);
      await loadLibrary();
      setView("editor");
      setNotice(`已导入 ${next.savedRef?.id}@${next.savedRef?.version}`);
    });
  }, [bridge, loadLibrary, replaceDraft, runOperation]);

  const exportTheme = useCallback(() => {
    void runOperation(async () => {
      const current = visibleDraftRef.current;
      if (!current?.savedRef || current.dirty) {
        throw new StudioError(
          "STUDIO_EXPORT_INVALID",
          "当前主题存在未保存修改",
          "请先保存版本，再导出主题。",
        );
      }
      const exported = await bridge.exportTheme(current.savedRef);
      downloadTheme(exported.fileName, exported.mimeType, exported.bytes);
      setNotice(`已导出 ${exported.fileName}`);
    });
  }, [bridge, runOperation]);

  const exportSelectedTheme = useCallback(() => {
    void runOperation(async () => {
      if (!selectedTheme?.ready || selectedTheme.source !== "personal") return;
      const exported = await bridge.exportTheme(selectedTheme.ref);
      downloadTheme(exported.fileName, exported.mimeType, exported.bytes);
      setNotice(`已导出 ${exported.fileName}`);
    });
  }, [bridge, runOperation, selectedTheme]);

  const applySelectedTheme = useCallback(() => {
    void runOperation(async () => {
      if (!selectedTheme?.ready) return;
      const nextRuntime = await bridge.applySavedTheme(selectedTheme.ref);
      setRuntime(nextRuntime);
      setNotice(`已应用 ${selectedTheme.ref.id}@${selectedTheme.ref.version}`);
    }, "apply");
  }, [bridge, runOperation, selectedTheme]);

  const openHomeSelection = useCallback(() => {
    if (selectedTheme) openSelectedTheme(selectedTheme);
  }, [openSelectedTheme, selectedTheme]);

  const deletePersonalTheme = useCallback((id: string, version?: string) => {
    const target = version ? `${id}@${version}` : id;
    if (!window.confirm(`确认删除个人主题${version ? "版本" : "及其全部版本"}“${target}”吗？`)) {
      return;
    }
    void runOperation(async () => {
      const nextLibrary = await bridge.deletePersonalTheme({ id, ...(version ? { version } : {}) });
      setLibrary(nextLibrary);
      setSelectedTheme((current) => current?.ref.id === id
        ? nextLibrary.themes.find((theme) => theme.source === "builtin") ?? nextLibrary.themes[0] ?? null
        : current);
      const current = serverDraftRef.current;
      if (current) {
        try {
          replaceDraft(await bridge.openDraft(current.draftId));
        } catch (openError) {
          if (!(openError instanceof StudioError) || openError.code !== "STUDIO_DRAFT_NOT_FOUND") {
            throw openError;
          }
          const latest = await bridge.openLatestDraft();
          if (latest) replaceDraft(latest);
          else clearDraft();
        }
      }
      setNotice(`已删除 ${target}`);
    }, "delete");
  }, [bridge, clearDraft, replaceDraft, runOperation]);

  const validationErrors = draft?.issues.filter((issue) => issue.severity === "error") ?? [];
  const selectedRef = selectedTheme?.ref ?? draft?.savedRef ?? null;
  const canRestore = ["active", "paused", "paused-incompatible", "recovery-required"]
    .includes(runtime.status);
  const visibleThemeCount = visibleThemeItems(library.themes).length;
  const homeThemes = visibleThemeItems(library.themes);

  if (view === "home") {
    return (
      <div className="studio-product-root">
        <StudioHome
          bootstrap={bootstrap}
          runtime={runtime}
          themes={homeThemes}
          selectedTheme={selectedTheme}
          locale={preferences.locale}
          colorMode={preferences.colorMode}
          busy={busy}
          activeOperation={activeOperation}
          onSelectTheme={(theme) => { setSelectedTheme(theme); setError(null); }}
          onLocaleChange={setLocale}
          onColorModeChange={setColorMode}
          onOpenEditor={openHomeSelection}
          onImport={importTheme}
          onApply={applySelectedTheme}
          onRestore={restoreOriginal}
          onExport={exportSelectedTheme}
          onDelete={() => { if (selectedTheme?.source === "personal") deletePersonalTheme(selectedTheme.ref.id); }}
        />
        <div className="home-toast-stack" aria-live="polite">
          {activeOperation ? <div className="home-toast progress"><i /><span>{activeOperation === "apply" ? t.applying : activeOperation === "restore" ? t.restoring : preferences.locale === "en" ? "Working…" : "正在处理…"}</span></div> : null}
          {error ? <div className="home-toast error" role="alert"><strong>{preferences.locale === "en" ? "Action failed" : "操作未完成"}</strong><span>{error}</span><button type="button" onClick={() => setError(null)}>{t.close}</button></div> : null}
          {notice ? <div className="home-toast success" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>{t.close}</button></div> : null}
        </div>
        {draftConflict ? (
          <div className="draft-conflict-backdrop">
            <section role="dialog" aria-modal="true" aria-label={preferences.locale === "en" ? "Existing theme draft" : "已有主题草稿"} className="draft-conflict-dialog">
              <h2>{preferences.locale === "en" ? "A draft already exists" : "已有主题草稿"}</h2>
              <p>{preferences.locale === "en"
                ? `“${localizedTheme(draftConflict, preferences.locale).name}” already has a draft. Load it or overwrite it to continue.`
                : `“${draftConflict.name}”已经有一个草稿。请选择加载已有草稿或覆盖现有草稿。`}</p>
              <div>
                <button type="button" className="primary-action" disabled={busy} onClick={() => openSelectedTheme(draftConflict, "load-existing")}>{preferences.locale === "en" ? "Load existing" : "加载已有草稿"}</button>
                <button type="button" className="danger-action" disabled={busy} onClick={() => openSelectedTheme(draftConflict, "overwrite-existing")}>{preferences.locale === "en" ? "Overwrite" : "覆盖现有草稿"}</button>
                <button type="button" className="secondary-action" disabled={busy} onClick={cancelDraftConflict}>{preferences.locale === "en" ? "Cancel" : "取消"}</button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="studio-shell">
      <header className="studio-toolbar">
        <div className="studio-title">
          <p>OPEN CHATGPT SKIN</p>
          <h1>Theme Studio</h1>
          <span>{draft ? draft.theme.name : t.editorSubtitle}</span>
        </div>
        <div className="studio-actions">
          <button type="button" className="editor-home-action" onClick={() => setView("home")}><House />{t.backHome}</button>
          <div role="status" className={`runtime-badge status-${runtime.status}`}>
            <i />{runtimeLabel(runtime.status, preferences.locale)}
          </div>
          <button type="button" className="editor-preference-action" aria-label={preferences.locale === "en" ? "Switch to Chinese" : "切换到英文"} onClick={() => setLocale(preferences.locale === "zh-CN" ? "en" : "zh-CN")}>{preferences.locale === "zh-CN" ? "EN" : "中"}</button>
          <button type="button" className="editor-preference-action" aria-label={preferences.colorMode === "light" ? t.dark : t.light} onClick={() => setColorMode(preferences.colorMode === "light" ? "dark" : "light")}>{preferences.colorMode === "light" ? <Moon /> : <Sun />}</button>
          <button type="button" className="restore-action" disabled={busy || !canRestore} onClick={restoreOriginal}>
            {activeOperation === "restore" ? t.restoring : t.restore}
          </button>
          <button type="button" disabled={busy || !draft?.undoAvailable} onClick={() => { void draftCommand("undo"); }}>{t.undo}</button>
          <button type="button" disabled={busy || !draft?.redoAvailable} onClick={() => { void draftCommand("redo"); }}>{t.redo}</button>
          <button type="button" disabled={busy || !draft?.dirty || validationErrors.length > 0} onClick={() => { void draftCommand("save"); }}>
            {activeOperation === "save" ? t.saving : t.saveVersion}
          </button>
          <button type="button" className="primary-action" aria-busy={activeOperation === "apply"} title={draft?.dirty ? "请先保存版本" : undefined} disabled={busy || !draft?.savedRef || draft.dirty || validationErrors.length > 0} onClick={() => { void draftCommand("apply"); }}>
            {activeOperation === "apply" ? t.applying : t.applyCodex}
          </button>
        </div>
      </header>

      <div className="studio-messages" aria-live="polite">
        {activeOperation === "save" ? <div className="message-bar progress" role="status"><i /><span>{t.workingSave}</span></div> : null}
        {activeOperation === "delete" ? <div className="message-bar progress" role="status"><i /><span>{t.workingDelete}</span></div> : null}
        {activeOperation === "apply" ? <div className="message-bar progress" role="status"><i /><span>{t.workingApply}</span></div> : null}
        {activeOperation === "restore" ? <div className="message-bar progress" role="status"><i /><span>{t.workingRestore}</span></div> : null}
        {error ? <div className="message-bar error" role="alert"><strong>{t.actionFailed}</strong><span>{error}</span><button type="button" onClick={() => setError(null)}>{t.close}</button></div> : null}
        {notice ? <div className="message-bar success" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>{t.close}</button></div> : null}
      </div>

      {draftConflict ? (
        <div className="draft-conflict-backdrop">
          <section role="dialog" aria-modal="true" aria-label="已有主题草稿" className="draft-conflict-dialog">
            <h2>已有主题草稿</h2>
            <p>“{draftConflict.name}”已经有一个草稿。请选择加载已有草稿或覆盖现有草稿。</p>
            <div>
              <button type="button" className="primary-action" disabled={busy} onClick={() => openSelectedTheme(draftConflict, "load-existing")}>加载已有草稿</button>
              <button type="button" className="danger-action" disabled={busy} onClick={() => openSelectedTheme(draftConflict, "overwrite-existing")}>覆盖现有草稿</button>
              <button type="button" className="secondary-action" disabled={busy} onClick={cancelDraftConflict}>取消</button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="studio-workbench">
        <aside role="region" aria-label={preferences.locale === "en" ? "Themes and tools" : "主题与工具"} className="studio-library">
          <div className="side-panel-tabs" role="tablist" aria-label={preferences.locale === "en" ? "Left panel" : "左侧面板"}>
            <button type="button" role="tab" aria-selected={leftPanel === "library"} className={leftPanel === "library" ? "active" : ""} onClick={() => selectLeftPanel("library")}>{t.themeLibrary}</button>
            <button type="button" role="tab" aria-selected={leftPanel === "tools"} className={leftPanel === "tools" ? "active" : ""} onClick={() => selectLeftPanel("tools")}>{t.editorTools}</button>
          </div>
          {leftPanel === "library" ? (
            <div role="tabpanel" aria-label={t.themeLibrary}>
              <div className="panel-heading">
                <div><h2>{t.themeLibrary}</h2><small>{preferences.locale === "en" ? `${visibleThemeCount} themes` : `${visibleThemeCount} 个主题`}</small></div>
                <label className="import-button">{t.importTheme}<input type="file" accept=".ocskin,application/vnd.open-chatgpt-skin+zip" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) importTheme(file); event.currentTarget.value = ""; }} /></label>
              </div>
              <ThemeLibrary themes={library.themes} selectedRef={selectedRef} busy={busy} locale={preferences.locale} onSelect={selectTheme} onDelete={(theme) => deletePersonalTheme(theme.ref.id)} />
            </div>
          ) : (
            <div role="tabpanel" aria-label={t.editorTools}>
              <div className="tool-heading"><h2>{t.editorTools}</h2>{draft ? <small>{preferences.locale === "en" ? "Draft" : "草稿"} r{draft.revision}</small> : null}</div>
              <nav aria-label={preferences.locale === "en" ? "Theme editing tools" : "主题编辑工具"} className="tool-list">
                {STUDIO_TOOLS.map((item) => (
                  <button type="button" className={tool === item.id ? "active" : ""} disabled={!draft} key={item.id} onClick={() => setTool(item.id)}><span>{preferences.locale === "en" ? item.labelEn : item.label}</span><b>›</b></button>
                ))}
              </nav>
            </div>
          )}
        </aside>

        <section aria-label={t.isolatedPreview} className="studio-preview">
          <div className="preview-toolbar">
            <div><strong>{t.isolatedPreview}</strong><span>ChatGPT Desktop · {preferences.locale === "en" ? "Desktop" : "桌面"}</span></div>
            <div className="preview-mode-switch" role="group" aria-label={preferences.locale === "en" ? "Preview page" : "预览页面"}>
              <button type="button" className={previewMode === "home" ? "active" : ""} onClick={() => setPreviewMode("home")}>{t.previewHome}</button>
              <button type="button" className={previewMode === "task" ? "active" : ""} onClick={() => setPreviewMode("task")}>{t.taskWorkspace}</button>
            </div>
            <div className="draft-state">
              <i className={draft?.dirty ? "dirty" : "saved"} />
              {draft?.dirty ? t.unsavedChanges : draft ? t.versionSaved : t.noDraft}
            </div>
          </div>
          <PreviewCanvas draft={draft} mode={previewMode} locale={preferences.locale} />
          <div className="preview-statusbar">
            <span>{draft ? `${draft.theme.id} · Schema v${draft.theme.schemaVersion}` : t.studioReady}</span>
            <span>{t.localAssets}</span>
          </div>
        </section>

        <aside role="region" aria-label={preferences.locale === "en" ? "Inspector" : "属性检查器"} className="studio-inspector">
          <Inspector tool={tool} draft={draft} library={library} busy={busy} locale={preferences.locale} onChange={changeTheme} onUpload={uploadAsset} onExport={exportTheme} onDeleteVersion={(ref) => deletePersonalTheme(ref.id, ref.version)} />
          {draft ? (
            <section className={validationErrors.length > 0 ? "validation-card invalid" : "validation-card valid"}>
              <header><strong>{validationErrors.length > 0 ? preferences.locale === "en" ? `${validationErrors.length} issues block saving` : `${validationErrors.length} 个问题阻止保存` : t.canSave}</strong><span>{draft.issues.length} {t.checks}</span></header>
              {draft.issues.length > 0 ? <ul>{draft.issues.slice(0, 8).map((issue, index) => <li key={`${issue.path}-${index}`}><b>{issue.path || "theme"}</b><span>{issue.message}</span></li>)}</ul> : <p>{t.validationPassed}</p>}
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
