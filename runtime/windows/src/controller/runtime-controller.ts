import type { CdpEndpoint } from "@open-chatgpt-skin/cdp-adapter";
import type { RuntimeStatusView } from "../control/result.js";
import { RuntimeError, runtimeErrorCode, type RuntimeErrorCode } from "../errors.js";
import type { LaunchReceipt } from "../launcher/launcher.js";
import type { RuntimePaths } from "../paths.js";
import {
  type PendingOperation,
  type RuntimeThemeRef,
} from "../session/model.js";
import { transitionRuntimeState } from "../session/state-machine.js";
import type { RuntimeSessionState, RuntimeStateStore } from "../state.js";
import type { PortInspection, WindowsRuntimeProvider } from "../types.js";
import {
  hasManagedSessionExited,
  revalidateManagedSession,
} from "./managed-session.js";
import { ExitMonitor } from "./exit-monitor.js";
import type { RuntimePageSession } from "./page-session.js";
import { RendererLifecycleMonitor } from "./renderer-lifecycle.js";
import { ThemeEngine } from "./theme-engine.js";
import type { LoadedRuntimeTheme } from "../themes/runtime-theme-repository.js";

export interface RuntimeExitMonitor {
  start(session: RuntimeSessionState): void;
  stop(): void;
}

export interface RuntimeControllerDependencies {
  readonly paths: RuntimePaths;
  readonly provider: WindowsRuntimeProvider;
  readonly state: RuntimeStateStore;
  readonly themes: ThemeEngine;
  readonly launchManaged: () => Promise<LaunchReceipt>;
  readonly waitForPort: (receipt: LaunchReceipt) => Promise<PortInspection>;
  readonly activateWindow: (receipt: LaunchReceipt) => Promise<LaunchReceipt>;
  readonly connectPage: (endpoint: CdpEndpoint) => Promise<RuntimePageSession>;
  readonly secureRuntimeDirectories: () => Promise<void>;
  readonly now: () => string;
  readonly runtimeIdentity: { readonly pid: number; readonly startedAt: string };
  readonly newSessionId: () => string;
  readonly onStopped: () => Promise<void> | void;
  readonly createExitMonitor?: () => RuntimeExitMonitor;
}

function nextAction(state: RuntimeSessionState | null): string {
  if (!state) return "Launch one of the built-in themes.";

  switch (state.status) {
    case "launching":
      return "Theme launch is in progress.";
    case "active":
      return "Theme is active.";
    case "paused":
      return "Resume the selected built-in theme.";
    case "paused-incompatible":
      return "Choose a compatible built-in theme or restore Codex.";
    case "recovery-required":
      return "Restore Codex before changing themes.";
    case "restoring":
      return "Restore is in progress.";
    case "restored-awaiting-exit":
      return "Quit Codex normally to finish restoring.";
    case "restored-cleanup-required":
      return "Close the remaining local debug listener, then Quit Codex normally.";
  }
}

function statusView(state: RuntimeSessionState | null): RuntimeStatusView {
  if (!state) {
    return {
      status: "stopped",
      controllerAvailable: true,
      selectedTheme: null,
      appliedTheme: null,
      skinApplied: false,
      packageVersion: null,
      operation: null,
      nextAction: nextAction(null),
    };
  }

  return {
    status: state.status,
    controllerAvailable: true,
    selectedTheme: state.selectedTheme,
    appliedTheme: state.appliedTheme,
    skinApplied: state.skinApplied,
    packageVersion: state.codex?.packageVersion ?? null,
    operation: state.pendingOperation?.kind ?? null,
    nextAction: nextAction(state),
  };
}

function themeRef(themeId: string, version: string): RuntimeThemeRef {
  return { id: themeId, version };
}

function themeLookup(themeId: string, themeVersion?: string): {
  readonly id: string;
  readonly version?: string;
} {
  return themeVersion ? { id: themeId, version: themeVersion } : { id: themeId };
}

function isUnavailableThemeVersion(error: unknown): boolean {
  const code = runtimeErrorCode(error);
  return code === "THEME_NOT_FOUND" || code === "THEME_NOT_READY";
}

export class RuntimeController {
  private page: RuntimePageSession | null = null;
  private lifecycle: RendererLifecycleMonitor | null = null;
  private exitMonitor: RuntimeExitMonitor | null = null;
  private mutation: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: RuntimeControllerDependencies) {}

  async launch(
    themeId: string,
    requestId: string,
    themeVersion?: string,
  ): Promise<RuntimeStatusView> {
    return this.runMutation(() => this.launchInternal(themeId, requestId, themeVersion));
  }

  private async launchInternal(
    themeId: string,
    requestId: string,
    themeVersion?: string,
  ): Promise<RuntimeStatusView> {
    const existing = await this.dependencies.state.read();
    if (existing) {
      throw new RuntimeError(
        "RUNTIME_INVALID_STATE",
        "A Runtime session already exists",
      );
    }

    let launching: RuntimeSessionState | null = null;
    let receipt: LaunchReceipt | null = null;

    try {
      await this.dependencies.secureRuntimeDirectories();
      const theme = await this.dependencies.themes.load(themeLookup(themeId, themeVersion));
      const selectedTheme = themeRef(theme.descriptor.id, theme.descriptor.version);
      const startedAt = this.dependencies.now();
      const pendingOperation: PendingOperation = {
        kind: "launch",
        requestId,
        startedAt,
        previousStatus: null,
        previousSelectedTheme: null,
        previousAppliedTheme: null,
        candidateTheme: selectedTheme,
      };

      launching = {
        schemaVersion: 2,
        sessionId: this.dependencies.newSessionId(),
        status: "launching",
        runtime: this.dependencies.runtimeIdentity,
        codex: null,
        cdp: null,
        adapter: null,
        selectedTheme,
        appliedTheme: null,
        skinApplied: false,
        pendingOperation,
        recentRequests: [],
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      await this.dependencies.state.write(launching);

      receipt = await this.dependencies.launchManaged();
      launching = this.withLaunchIdentity(launching, receipt);
      await this.writeTransition(launching, launching);

      await this.dependencies.waitForPort(receipt);
      receipt = await this.dependencies.activateWindow(receipt);
      const initialLaunching = launching;
      launching = this.withLaunchIdentity(initialLaunching, receipt);
      await this.writeTransition(initialLaunching, launching);
      await this.dependencies.waitForPort(receipt);

      this.page = await this.dependencies.connectPage(receipt.cdp);
      launching = {
        ...launching,
        adapter: { id: this.page.adapterId, version: 1 },
        updatedAt: this.dependencies.now(),
      };
      await this.writeTransition(launching, launching);

      await this.dependencies.themes.apply(this.page, theme);
      const active: RuntimeSessionState = {
        ...launching,
        status: "active",
        appliedTheme: launching.selectedTheme,
        skinApplied: true,
        pendingOperation: null,
        updatedAt: this.dependencies.now(),
      };
      await this.writeTransition(launching, active);
      this.startLifecycle(this.requirePage());
      return statusView(active);
    } catch (error) {
      if (!receipt) {
        if (launching) await this.dependencies.state.clear();
        throw error;
      }
      return this.handleLaunchFailure(launching!, receipt, error);
    }
  }

  async status(): Promise<RuntimeStatusView> {
    return statusView(await this.dependencies.state.read());
  }

  async switchTheme(
    themeId: string,
    requestId: string,
    themeVersion?: string,
  ): Promise<RuntimeStatusView> {
    return this.runMutation(() => this.switchThemeInternal(themeId, requestId, themeVersion));
  }

  private async switchThemeInternal(
    themeId: string,
    requestId: string,
    themeVersion?: string,
  ): Promise<RuntimeStatusView> {
    let state = await this.themeCommandState();
    this.rejectRestoreTerminal(state);

    if (state.status === "paused" || state.status === "paused-incompatible") {
      const theme = await this.dependencies.themes.load(themeLookup(themeId, themeVersion));
      const paused: RuntimeSessionState = {
        ...state,
        status: "paused",
        selectedTheme: themeRef(theme.descriptor.id, theme.descriptor.version),
        appliedTheme: null,
        skinApplied: false,
        updatedAt: this.dependencies.now(),
      };
      await this.writeTransition(state, paused);
      return statusView(paused);
    }

    if (state.status !== "active") {
      throw new RuntimeError("RUNTIME_INVALID_STATE", "Theme switching requires an active session");
    }
    if (state.selectedTheme.id === themeId && state.appliedTheme?.id === themeId &&
      (themeVersion === undefined || state.selectedTheme.version === themeVersion)) {
      return statusView(state);
    }

    const candidate = await this.dependencies.themes.load(themeLookup(themeId, themeVersion));
    const candidateTheme = themeRef(candidate.descriptor.id, candidate.descriptor.version);
    await revalidateManagedSession(state, this.dependencies.provider);
    state = await this.ensurePage(state);

    const previousApplied = state.appliedTheme;
    if (!previousApplied) {
      throw new RuntimeError("RUNTIME_SESSION_STALE", "Active state is missing its applied theme");
    }
    let previousTheme: LoadedRuntimeTheme | null = null;
    try {
      previousTheme = await this.dependencies.themes.load(previousApplied);
      this.assertThemeVersion(previousTheme, previousApplied);
    } catch (error) {
      if (!isUnavailableThemeVersion(error)) throw error;
    }

    const pending = this.withPending(state, "switch", requestId, candidateTheme);
    await this.writeTransition(state, pending);

    let officialBeforeCandidate = false;
    try {
      await this.dependencies.themes.cleanup(this.requirePage());
      officialBeforeCandidate = true;
      await this.dependencies.themes.apply(this.requirePage(), candidate);
    } catch (candidateError) {
      return this.rollbackSwitch(
        pending,
        previousTheme,
        candidateError,
        officialBeforeCandidate,
      );
    }

    const active: RuntimeSessionState = {
      ...pending,
      status: "active",
      selectedTheme: candidateTheme,
      appliedTheme: candidateTheme,
      skinApplied: true,
      pendingOperation: null,
      updatedAt: this.dependencies.now(),
    };
    await this.writeTransition(pending, active);
    this.startLifecycle(this.requirePage());
    return statusView(active);
  }

  async pause(requestId: string): Promise<RuntimeStatusView> {
    return this.runMutation(() => this.pauseInternal(requestId));
  }

  private async pauseInternal(requestId: string): Promise<RuntimeStatusView> {
    let state = await this.themeCommandState();
    this.rejectRestoreTerminal(state);

    if (state.status === "paused" || state.status === "paused-incompatible") {
      return statusView(state);
    }
    if (state.status !== "active") {
      throw new RuntimeError("RUNTIME_INVALID_STATE", "Pausing requires an active session");
    }

    const pending = this.withPending(state, "pause", requestId, null);
    await this.writeTransition(state, pending);

    let observed = pending;
    try {
      await revalidateManagedSession(observed, this.dependencies.provider);
      observed = await this.ensurePage(observed);
      await this.dependencies.themes.cleanup(this.requirePage());
    } catch (error) {
      const recovery = this.recoveryRequired(observed);
      await this.writeTransition(observed, recovery);
      this.stopLifecycle();
      throw error;
    }

    const paused: RuntimeSessionState = {
      ...observed,
      status: "paused",
      appliedTheme: null,
      skinApplied: false,
      pendingOperation: null,
      updatedAt: this.dependencies.now(),
    };
    await this.writeTransition(observed, paused);
    this.startLifecycle(this.requirePage());
    return statusView(paused);
  }

  async resume(requestId: string): Promise<RuntimeStatusView> {
    return this.runMutation(() => this.resumeInternal(requestId));
  }

  private async resumeInternal(requestId: string): Promise<RuntimeStatusView> {
    let state = await this.themeCommandState();
    this.rejectRestoreTerminal(state);

    if (state.status === "active") return statusView(state);
    if (state.status !== "paused" && state.status !== "paused-incompatible") {
      throw new RuntimeError("RUNTIME_INVALID_STATE", "Resuming requires a paused session");
    }

    await revalidateManagedSession(state, this.dependencies.provider);
    state = await this.ensurePage(state);
    const theme = await this.dependencies.themes.load(state.selectedTheme);
    this.assertThemeVersion(theme, state.selectedTheme);
    const pending = this.withPending(state, "resume", requestId, state.selectedTheme);
    await this.writeTransition(state, pending);

    try {
      await this.dependencies.themes.apply(this.requirePage(), theme);
    } catch (error) {
      return this.degradeResume(pending, error);
    }

    const active: RuntimeSessionState = {
      ...pending,
      status: "active",
      appliedTheme: pending.selectedTheme,
      skinApplied: true,
      pendingOperation: null,
      updatedAt: this.dependencies.now(),
    };
    await this.writeTransition(pending, active);
    this.startLifecycle(this.requirePage());
    return statusView(active);
  }

  async restore(requestId: string): Promise<RuntimeStatusView> {
    return this.runMutation(() => this.restoreInternal(requestId));
  }

  private async restoreInternal(_requestId: string): Promise<RuntimeStatusView> {
    let state = await this.themeCommandState();
    if (state.status === "restored-awaiting-exit" ||
      state.status === "restored-cleanup-required") {
      return statusView(state);
    }
    if (![
      "active",
      "paused",
      "paused-incompatible",
      "recovery-required",
    ].includes(state.status)) {
      throw new RuntimeError("RUNTIME_INVALID_STATE", "Restore requires a managed Runtime session");
    }

    const previous = state;
    const pending = this.withPending(state, "restore", _requestId, null);
    state = {
      ...pending,
      status: "restoring",
      updatedAt: this.dependencies.now(),
    };
    await this.writeTransition(previous, state);
    this.stopLifecycle();

    if (previous.skinApplied !== false) {
      try {
        if (!await hasManagedSessionExited(state, this.dependencies.provider)) {
          await revalidateManagedSession(state, this.dependencies.provider);
          state = await this.ensurePage(state);
          await this.dependencies.themes.cleanup(this.requirePage());
        }
      } catch (error) {
        return this.restoreFailure(state, previous, error);
      }
    }

    const restored = this.restoredAwaitingExit(state);
    await this.writeTransition(state, restored);
    this.closePage();
    return statusView(restored);
  }

  async close(): Promise<void> {
    this.exitMonitor?.stop();
    this.exitMonitor = null;
    this.closePage();
  }

  attachRecoveredPage(page: RuntimePageSession): void {
    this.closePage();
    this.page = page;
    this.startLifecycle(page);
  }

  async startExitMonitoring(): Promise<void> {
    const session = await this.dependencies.state.read();
    if (!session || (session.status !== "restored-awaiting-exit" &&
      session.status !== "restored-cleanup-required")) {
      throw new RuntimeError(
        "RUNTIME_INVALID_STATE",
        "Exit monitoring requires a restored Runtime session",
      );
    }
    const monitor = this.exitMonitor ?? this.dependencies.createExitMonitor?.() ??
      new ExitMonitor({
        provider: this.dependencies.provider,
        state: this.dependencies.state,
        onStopped: this.dependencies.onStopped,
      });
    this.exitMonitor = monitor;
    monitor.start(session);
  }

  private withLaunchIdentity(
    state: RuntimeSessionState,
    receipt: LaunchReceipt,
  ): RuntimeSessionState {
    return {
      ...state,
      codex: {
        rootPid: receipt.root.pid,
        startedAt: receipt.root.startedAt,
        executablePath: receipt.root.executablePath,
        packageRoot: receipt.install.packageRoot,
        packageVersion: receipt.install.packageVersion,
      },
      cdp: receipt.cdp,
      updatedAt: this.dependencies.now(),
    };
  }

  private async handleLaunchFailure(
    launching: RuntimeSessionState,
    receipt: LaunchReceipt,
    originalError: unknown,
  ): Promise<never> {
    const identified = launching.codex && launching.cdp
      ? launching
      : this.withLaunchIdentity(launching, receipt);

    if (!this.page) {
      const restored = this.restoredAwaitingExit(identified);
      await this.writeTransition(identified, restored);
      throw originalError;
    }

    try {
      await this.dependencies.themes.cleanup(this.page);
    } catch (cleanupError) {
      const recovery = this.recoveryRequired(identified);
      await this.writeTransition(identified, recovery);
      this.closePage();
      throw this.cleanupFailure(cleanupError);
    }

    const restored = this.restoredAwaitingExit(identified);
    await this.writeTransition(identified, restored);
    this.closePage();
    throw originalError;
  }

  private restoredAwaitingExit(state: RuntimeSessionState): RuntimeSessionState {
    return {
      ...state,
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
      pendingOperation: null,
      updatedAt: this.dependencies.now(),
    };
  }

  private recoveryRequired(state: RuntimeSessionState): RuntimeSessionState {
    return {
      ...state,
      status: "recovery-required",
      appliedTheme: null,
      skinApplied: null,
      pendingOperation: null,
      updatedAt: this.dependencies.now(),
    };
  }

  private async writeTransition(
    current: RuntimeSessionState,
    next: RuntimeSessionState,
  ): Promise<void> {
    await this.dependencies.state.write(transitionRuntimeState(current, next));
  }

  private async restoreFailure(
    restoring: RuntimeSessionState,
    previous: RuntimeSessionState,
    cleanupError: unknown,
  ): Promise<never> {
    let previousAppearanceVerified = false;
    if (previous.status === "active" && previous.skinApplied === true && this.page) {
      try {
        previousAppearanceVerified = (await this.page.adapter.verify()).valid;
      } catch {
        // A failed probe cannot prove that the previous themed appearance survived.
        previousAppearanceVerified = false;
      }
    }

    if (previousAppearanceVerified) {
      const restored: RuntimeSessionState = {
        ...previous,
        pendingOperation: null,
        updatedAt: this.dependencies.now(),
      };
      await this.writeTransition(restoring, restored);
      this.startLifecycle(this.requirePage());
      throw cleanupError;
    }

    const recovery = this.recoveryRequired(restoring);
    await this.writeTransition(restoring, recovery);
    this.closePage();
    throw this.cleanupFailure(cleanupError);
  }

  private cleanupFailure(cause: unknown): RuntimeError {
    return this.operationFailure(
      "THEME_CLEANUP_FAILED",
      "Official Codex appearance could not be verified",
      cause,
    );
  }

  private async themeCommandState(): Promise<RuntimeSessionState> {
    const state = await this.dependencies.state.read();
    if (!state) {
      throw new RuntimeError("RUNTIME_INVALID_STATE", "No Runtime session exists");
    }
    return state;
  }

  private rejectRestoreTerminal(state: RuntimeSessionState): void {
    if (state.status === "restored-awaiting-exit" ||
      state.status === "restored-cleanup-required") {
      throw new RuntimeError(
        "RESTORE_AWAITING_EXIT",
        "Codex must exit normally before changing themes",
      );
    }
  }

  private withPending(
    state: RuntimeSessionState,
    kind: PendingOperation["kind"],
    requestId: string,
    candidateTheme: RuntimeThemeRef | null,
  ): RuntimeSessionState {
    return {
      ...state,
      pendingOperation: {
        kind,
        requestId,
        startedAt: this.dependencies.now(),
        previousStatus: state.status,
        previousSelectedTheme: state.selectedTheme,
        previousAppliedTheme: state.appliedTheme,
        candidateTheme,
      },
      updatedAt: this.dependencies.now(),
    };
  }

  private async ensurePage(state: RuntimeSessionState): Promise<RuntimeSessionState> {
    if (this.page) return state;
    if (!state.cdp) {
      throw new RuntimeError("RUNTIME_SESSION_STALE", "Managed CDP identity is incomplete");
    }

    this.page = await this.dependencies.connectPage(state.cdp);
    const connected: RuntimeSessionState = {
      ...state,
      adapter: { id: this.page.adapterId, version: 1 },
      updatedAt: this.dependencies.now(),
    };
    await this.writeTransition(state, connected);
    return connected;
  }

  private requirePage(): RuntimePageSession {
    if (!this.page) {
      throw new RuntimeError("RUNTIME_SESSION_STALE", "Managed page is unavailable");
    }
    return this.page;
  }

  private assertThemeVersion(
    theme: LoadedRuntimeTheme,
    expected: RuntimeThemeRef,
  ): void {
    if (theme.descriptor.id !== expected.id || theme.descriptor.version !== expected.version) {
      throw new RuntimeError("THEME_NOT_READY", "Runtime theme version changed");
    }
  }

  private async rollbackSwitch(
    pending: RuntimeSessionState,
    previousTheme: LoadedRuntimeTheme | null,
    candidateError: unknown,
    officialBeforeCandidate: boolean,
  ): Promise<never> {
    const page = this.requirePage();
    const operation = pending.pendingOperation;
    if (!operation?.previousSelectedTheme || !operation.previousAppliedTheme) {
      throw new RuntimeError("RUNTIME_SESSION_STALE", "Switch rollback is missing its prior theme");
    }
    let rollbackError: unknown | null = null;
    if (officialBeforeCandidate && previousTheme) {
      try {
        await this.dependencies.themes.cleanup(page);
        await this.dependencies.themes.apply(page, previousTheme);
      } catch (error) {
        rollbackError = error;
      }
    } else {
      rollbackError = candidateError;
    }

    if (!rollbackError) {
      const restored: RuntimeSessionState = {
        ...pending,
        status: "active",
        selectedTheme: operation.previousSelectedTheme,
        appliedTheme: operation.previousAppliedTheme,
        skinApplied: true,
        pendingOperation: null,
        updatedAt: this.dependencies.now(),
      };
      await this.writeTransition(pending, restored);
      this.startLifecycle(page);
      throw this.operationFailure(
        "THEME_SWITCH_FAILED",
        "The requested theme could not be applied",
        candidateError,
      );
    }

    const verificationError = await this.cleanupToOfficial(page);
    if (!verificationError) {
      const paused: RuntimeSessionState = {
        ...pending,
        status: "paused-incompatible",
        selectedTheme: operation.previousSelectedTheme,
        appliedTheme: null,
        skinApplied: false,
        pendingOperation: null,
        updatedAt: this.dependencies.now(),
      };
      await this.writeTransition(pending, paused);
      this.stopLifecycle();
    } else {
      const recovery = this.recoveryRequired(pending);
      await this.writeTransition(pending, recovery);
      this.stopLifecycle();
    }
    throw this.operationFailure(
      "THEME_ROLLBACK_FAILED",
      "The previous Runtime theme could not be restored",
      rollbackError,
    );
  }

  private async degradeResume(
    pending: RuntimeSessionState,
    originalError: unknown,
  ): Promise<never> {
    const verificationError = runtimeErrorCode(originalError) === "THEME_CLEANUP_FAILED"
      ? originalError
      : await this.cleanupToOfficial(this.requirePage());
    if (verificationError) {
      const recovery = this.recoveryRequired(pending);
      await this.writeTransition(pending, recovery);
      this.stopLifecycle();
      if (verificationError === originalError) throw originalError;
      throw this.cleanupFailure(verificationError);
    }

    const paused: RuntimeSessionState = {
      ...pending,
      status: "paused-incompatible",
      appliedTheme: null,
      skinApplied: false,
      pendingOperation: null,
      updatedAt: this.dependencies.now(),
    };
    await this.writeTransition(pending, paused);
    this.stopLifecycle();
    throw originalError;
  }

  private async cleanupToOfficial(page: RuntimePageSession): Promise<unknown | null> {
    try {
      await this.dependencies.themes.cleanup(page);
      return null;
    } catch (error) {
      // Cleanup failure is deliberately retained for state classification, not ignored.
      return error;
    }
  }

  private operationFailure(
    code: RuntimeErrorCode,
    message: string,
    cause: unknown,
  ): RuntimeError {
    const error = new RuntimeError(code, message, "Restore Codex before changing themes.");
    Object.defineProperty(error, "cause", {
      configurable: false,
      enumerable: false,
      value: cause,
    });
    return error;
  }

  private startLifecycle(page: RuntimePageSession): void {
    if (this.lifecycle) {
      this.lifecycle.replace(page.connection);
      return;
    }
    this.lifecycle = new RendererLifecycleMonitor({
      reconcile: () => this.reconcileRenderer(),
      reconnect: () => this.reconnectRenderer(),
    });
    this.lifecycle.start(page.connection);
  }

  private stopLifecycle(): void {
    this.lifecycle?.stop();
    this.lifecycle = null;
  }

  private async reconcileRenderer(): Promise<void> {
    await this.runMutation(async () => {
      const state = await this.dependencies.state.read();
      if (!state || this.shouldStopLifecycle(state)) {
        this.stopLifecycle();
        return;
      }
      if (state.pendingOperation || state.status === "paused" ||
        state.status === "paused-incompatible") {
        return;
      }
      if (state.status !== "active") {
        this.stopLifecycle();
        return;
      }

      let officialAppearance = false;
      try {
        await revalidateManagedSession(state, this.dependencies.provider);
        const observed = await this.ensurePage(state);
        const theme = await this.dependencies.themes.load(observed.selectedTheme);
        this.assertThemeVersion(theme, observed.selectedTheme);
        await this.dependencies.themes.cleanup(this.requirePage());
        officialAppearance = true;
        await this.dependencies.themes.apply(this.requirePage(), theme);
        const active: RuntimeSessionState = {
          ...observed,
          status: "active",
          appliedTheme: observed.selectedTheme,
          skinApplied: true,
          pendingOperation: null,
          updatedAt: this.dependencies.now(),
        };
        await this.writeTransition(observed, active);
      } catch (error) {
        await this.recordRendererFailure(error, officialAppearance);
      }
    });
  }

  private reconnectRenderer(): Promise<RuntimePageSession> {
    return this.runMutation(async () => {
      let state: RuntimeSessionState | null = null;
      let previousPage: RuntimePageSession | null = null;
      try {
        state = await this.dependencies.state.read();
        if (!state || this.shouldStopLifecycle(state) || state.pendingOperation) {
          this.stopLifecycle();
          throw new RuntimeError("RUNTIME_INVALID_STATE", "Renderer reconnect is not permitted");
        }
        if (!state.cdp) {
          throw new RuntimeError("RUNTIME_SESSION_STALE", "Managed CDP identity is incomplete");
        }

        await revalidateManagedSession(state, this.dependencies.provider);
        previousPage = this.page;
        this.page = null;
        const page = await this.dependencies.connectPage(state.cdp);
        this.page = page;
        const observed: RuntimeSessionState = {
          ...state,
          adapter: { id: page.adapterId, version: 1 },
          updatedAt: this.dependencies.now(),
        };
        await this.writeTransition(state, observed);
        return page;
      } catch (error) {
        let wasOfficial = state?.status === "paused" ||
          state?.status === "paused-incompatible";
        if (!wasOfficial && runtimeErrorCode(error) === "ADAPTER_INCOMPATIBLE" &&
          previousPage) {
          wasOfficial = (await this.cleanupToOfficial(previousPage)) === null;
        }
        await this.recordRendererFailure(error, wasOfficial);
        previousPage?.close();
        throw error;
      }
    });
  }

  private async recordRendererFailure(
    error: unknown,
    officialAppearance = false,
  ): Promise<void> {
    const state = await this.dependencies.state.read();
    if (!state || this.shouldStopLifecycle(state)) {
      this.stopLifecycle();
      return;
    }

    if (runtimeErrorCode(error) === "ADAPTER_INCOMPATIBLE" && officialAppearance) {
      const paused: RuntimeSessionState = {
        ...state,
        status: "paused-incompatible",
        appliedTheme: null,
        skinApplied: false,
        pendingOperation: null,
        updatedAt: this.dependencies.now(),
      };
      await this.writeTransition(state, paused);
    } else {
      const recovery = this.recoveryRequired(state);
      await this.writeTransition(state, recovery);
    }
    this.closePage();
  }

  private shouldStopLifecycle(state: RuntimeSessionState): boolean {
    return state.status === "restoring" || state.status === "recovery-required" ||
      state.status === "restored-awaiting-exit" ||
      state.status === "restored-cleanup-required";
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutation;
    let release!: () => void;
    this.mutation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private closePage(): void {
    this.stopLifecycle();
    const page = this.page;
    this.page = null;
    page?.close();
  }

}
