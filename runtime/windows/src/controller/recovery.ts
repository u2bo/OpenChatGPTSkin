import { discoverCodexInstall } from "../discovery/discover.js";
import type { TrustedInstallStore } from "../discovery/trusted-cache.js";
import { RuntimeError } from "../errors.js";
import {
  type RuntimeSessionState,
  type RuntimeStateStore,
} from "../state.js";
import type { RuntimeThemeRef } from "../session/model.js";
import { transitionRuntimeState } from "../session/state-machine.js";
import { windowsPathsEqual } from "../windows/powershell-provider.js";
import type { LoadedRuntimeTheme } from "../themes/runtime-theme-repository.js";
import {
  hasManagedSessionExited,
  revalidateManagedSession,
} from "./managed-session.js";
import type { RuntimePageSession } from "./page-session.js";
import {
  RuntimeController,
  type RuntimeControllerDependencies,
} from "./runtime-controller.js";

export interface RecoverRuntimeControllerDependencies extends RuntimeControllerDependencies {
  readonly cache: TrustedInstallStore;
  readonly discoverCodexInstall?: typeof discoverCodexInstall;
}

interface RecoveredAppearance {
  readonly state: RuntimeSessionState;
  readonly keepPage: boolean;
}

function stale(message: string): RuntimeError {
  return new RuntimeError("RUNTIME_SESSION_STALE", message);
}

function assertThemeVersion(
  theme: LoadedRuntimeTheme,
  expected: RuntimeThemeRef,
): void {
  if (theme.descriptor.id !== expected.id || theme.descriptor.version !== expected.version) {
    throw new RuntimeError("THEME_NOT_READY", "Runtime theme version changed");
  }
}

function withObservedAdapter(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  dependencies: RecoverRuntimeControllerDependencies,
): RuntimeSessionState {
  return {
    ...state,
    adapter: { id: page.adapterId, version: 1 },
    updatedAt: dependencies.now(),
  };
}

async function commit(
  current: RuntimeSessionState,
  next: RuntimeSessionState,
  state: RuntimeStateStore,
): Promise<RuntimeSessionState> {
  const validated = transitionRuntimeState(current, next);
  await state.write(validated);
  return validated;
}

async function markRecoveryRequired(
  state: RuntimeSessionState,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RuntimeSessionState> {
  return commit(state, {
    ...state,
    status: "recovery-required",
    appliedTheme: null,
    skinApplied: null,
    pendingOperation: null,
    updatedAt: dependencies.now(),
  }, dependencies.state);
}

async function markPausedIncompatible(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  selectedTheme: RuntimeThemeRef,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RuntimeSessionState> {
  const observed = withObservedAdapter(state, page, dependencies);
  return commit(state, {
    ...observed,
    status: "paused-incompatible",
    selectedTheme,
    appliedTheme: null,
    skinApplied: false,
    pendingOperation: null,
    updatedAt: dependencies.now(),
  }, dependencies.state);
}

async function markPaused(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  selectedTheme: RuntimeThemeRef,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RuntimeSessionState> {
  const observed = withObservedAdapter(state, page, dependencies);
  return commit(state, {
    ...observed,
    status: "paused",
    selectedTheme,
    appliedTheme: null,
    skinApplied: false,
    pendingOperation: null,
    updatedAt: dependencies.now(),
  }, dependencies.state);
}

async function markActive(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  selectedTheme: RuntimeThemeRef,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RuntimeSessionState> {
  const observed = withObservedAdapter(state, page, dependencies);
  return commit(state, {
    ...observed,
    status: "active",
    selectedTheme,
    appliedTheme: selectedTheme,
    skinApplied: true,
    pendingOperation: null,
    updatedAt: dependencies.now(),
  }, dependencies.state);
}

async function markRestoredAwaitingExit(
  state: RuntimeSessionState,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RuntimeSessionState> {
  return commit(state, {
    ...state,
    status: "restored-awaiting-exit",
    appliedTheme: null,
    skinApplied: false,
    pendingOperation: null,
    updatedAt: dependencies.now(),
  }, dependencies.state);
}

async function cleanupToOfficial(
  page: RuntimePageSession,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<boolean> {
  try {
    await dependencies.themes.cleanup(page);
    return true;
  } catch {
    return false;
  }
}

async function reapplyVerifiedTheme(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  selectedTheme: RuntimeThemeRef,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RecoveredAppearance> {
  let theme: LoadedRuntimeTheme;
  try {
    theme = await dependencies.themes.load(selectedTheme);
    assertThemeVersion(theme, selectedTheme);
    await dependencies.themes.apply(page, theme);
  } catch {
    if (await cleanupToOfficial(page, dependencies)) {
      return {
        state: await markPausedIncompatible(state, page, selectedTheme, dependencies),
        keepPage: true,
      };
    }
    return {
      state: await markRecoveryRequired(state, dependencies),
      keepPage: false,
    };
  }

  return {
    state: await markActive(state, page, selectedTheme, dependencies),
    keepPage: true,
  };
}

async function recoverStableAppearance(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RecoveredAppearance> {
  if (!await cleanupToOfficial(page, dependencies)) {
    return {
      state: await markRecoveryRequired(state, dependencies),
      keepPage: false,
    };
  }

  if (state.status === "active") {
    return reapplyVerifiedTheme(state, page, state.selectedTheme, dependencies);
  }

  if (state.status === "paused") {
    return {
      state: await markPaused(state, page, state.selectedTheme, dependencies),
      keepPage: true,
    };
  }

  if (state.status === "paused-incompatible") {
    return {
      state: await markPausedIncompatible(state, page, state.selectedTheme, dependencies),
      keepPage: true,
    };
  }

  if (state.status === "launching") {
    return {
      state: await markRestoredAwaitingExit(state, dependencies),
      keepPage: false,
    };
  }

  return {
    state: await markRecoveryRequired(state, dependencies),
    keepPage: false,
  };
}

async function recoverInterruptedThemeOperation(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RecoveredAppearance> {
  const operation = state.pendingOperation;
  if (!operation || !await cleanupToOfficial(page, dependencies)) {
    return {
      state: await markRecoveryRequired(state, dependencies),
      keepPage: false,
    };
  }

  if (operation.previousStatus === "active" && operation.previousSelectedTheme &&
    operation.previousAppliedTheme) {
    if (operation.previousSelectedTheme.id !== operation.previousAppliedTheme.id ||
      operation.previousSelectedTheme.version !== operation.previousAppliedTheme.version) {
      return {
        state: await markPausedIncompatible(
          state,
          page,
          operation.previousSelectedTheme,
          dependencies,
        ),
        keepPage: true,
      };
    }
    return reapplyVerifiedTheme(
      state,
      page,
      operation.previousSelectedTheme,
      dependencies,
    );
  }

  if (operation.previousStatus === "paused") {
    return {
      state: await markPaused(
        state,
        page,
        operation.previousSelectedTheme ?? state.selectedTheme,
        dependencies,
      ),
      keepPage: true,
    };
  }

  if (operation.previousStatus === "paused-incompatible") {
    return {
      state: await markPausedIncompatible(
        state,
        page,
        operation.previousSelectedTheme ?? state.selectedTheme,
        dependencies,
      ),
      keepPage: true,
    };
  }

  return {
    state: await markPausedIncompatible(state, page, state.selectedTheme, dependencies),
    keepPage: true,
  };
}

async function recoverInterruptedRestore(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RecoveredAppearance> {
  if (!await cleanupToOfficial(page, dependencies)) {
    return {
      state: await markRecoveryRequired(state, dependencies),
      keepPage: false,
    };
  }
  return {
    state: await markRestoredAwaitingExit(state, dependencies),
    keepPage: false,
  };
}

async function recoverInterruptedLaunch(
  state: RuntimeSessionState,
  page: RuntimePageSession,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RecoveredAppearance> {
  if (!await cleanupToOfficial(page, dependencies)) {
    return {
      state: await markRecoveryRequired(state, dependencies),
      keepPage: false,
    };
  }
  return {
    state: await markRestoredAwaitingExit(state, dependencies),
    keepPage: false,
  };
}

async function verifyRecordedIdentity(
  state: RuntimeSessionState,
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<void> {
  if (!state.codex || !state.cdp) throw stale("Managed identity is incomplete");

  const discover = dependencies.discoverCodexInstall ?? discoverCodexInstall;
  const discovered = await discover(dependencies.provider, dependencies.cache);
  const root = discovered.runningRoot;
  if (!root || root.pid !== state.codex.rootPid || root.startedAt !== state.codex.startedAt ||
    !windowsPathsEqual(root.executablePath, state.codex.executablePath)) {
    throw stale("Managed Codex root changed");
  }
  if (!windowsPathsEqual(discovered.install.entryPath, state.codex.executablePath) ||
    !windowsPathsEqual(discovered.install.packageRoot, state.codex.packageRoot) ||
    discovered.install.packageVersion !== state.codex.packageVersion) {
    throw stale("Managed Codex installation changed");
  }

  await revalidateManagedSession(state, dependencies.provider);
}

export async function recoverRuntimeController(
  dependencies: RecoverRuntimeControllerDependencies,
): Promise<RuntimeController> {
  const state = await dependencies.state.read();
  if (!state) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "No Runtime session is available to recover");
  }

  const controller = new RuntimeController(dependencies);
  try {
    await verifyRecordedIdentity(state, dependencies);
  } catch (error) {
    if (state.status === "recovery-required" && !state.pendingOperation &&
      await hasManagedSessionExited(state, dependencies.provider)) {
      return controller;
    }
    throw error;
  }

  if (state.status === "restored-awaiting-exit" ||
    state.status === "restored-cleanup-required") {
    await controller.startExitMonitoring();
    return controller;
  }

  if (state.status === "recovery-required" && !state.pendingOperation) {
    return controller;
  }

  let page: RuntimePageSession | null = null;
  let recovered: RecoveredAppearance;
  try {
    page = await dependencies.connectPage(state.cdp!);
    recovered = state.pendingOperation?.kind === "launch"
      ? await recoverInterruptedLaunch(state, page, dependencies)
      : state.pendingOperation?.kind === "restore"
        ? await recoverInterruptedRestore(state, page, dependencies)
        : state.pendingOperation
          ? await recoverInterruptedThemeOperation(state, page, dependencies)
          : await recoverStableAppearance(state, page, dependencies);
  } catch {
    // A page/adapter failure leaves visual state unverified, so classify it explicitly.
    page?.close();
    await markRecoveryRequired(state, dependencies);
    return controller;
  }

  if (recovered.keepPage) {
    controller.attachRecoveredPage(page);
    return controller;
  }

  page.close();
  if (recovered.state.status === "restored-awaiting-exit") {
    await controller.startExitMonitoring();
  }
  return controller;
}
