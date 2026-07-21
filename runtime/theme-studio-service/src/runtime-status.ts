import {
  StudioError,
  StudioRuntimeStatusSchema,
  type StudioRuntimeStatus,
  type StudioThemeRef,
} from "@open-chatgpt-skin/theme-studio-core";
import {
  createProductionRuntimeCliDependencies,
  executeRuntimeControlCommand,
  RuntimeError,
  type ControlResponse,
  type RuntimeControlCliCommand,
  type RuntimeStatusView,
} from "@open-chatgpt-skin/windows-runtime";

type RuntimeControlResult = Awaited<ReturnType<typeof executeRuntimeControlCommand>>;

export interface ProductionRuntimeThemeDependencies {
  readonly readStatus: () => Promise<StudioRuntimeStatus>;
  readonly execute: (command: RuntimeControlCliCommand) => Promise<RuntimeControlResult>;
}

async function executeRuntimeCommand(
  execute: ProductionRuntimeThemeDependencies["execute"],
  command: RuntimeControlCliCommand,
): Promise<StudioRuntimeStatus> {
  const result = await execute(command);
  if ("protocolVersion" in result && !result.ok) {
    throw new StudioError(
      "STUDIO_APPLY_FAILED",
      result.error.message,
      result.error.nextAction,
    );
  }
  return mapRuntimeControlResult(result);
}

export function mapRuntimeStatus(
  status: RuntimeStatusView,
): StudioRuntimeStatus {
  return StudioRuntimeStatusSchema.parse({
    status: status.status,
    controllerAvailable: status.controllerAvailable,
    selectedTheme: status.selectedTheme,
    appliedTheme: status.appliedTheme,
    skinApplied: status.skinApplied,
    packageVersion: status.packageVersion,
    operation: status.operation,
    nextAction: status.nextAction,
  });
}

export function mapRuntimeControlResult(
  result: ControlResponse | RuntimeStatusView,
): StudioRuntimeStatus {
  if (!("protocolVersion" in result)) return mapRuntimeStatus(result);
  if (!result.ok) {
    throw new StudioError(
      "RUNTIME_STATUS_UNAVAILABLE",
      "Runtime status could not be read",
      result.error.nextAction,
    );
  }
  return mapRuntimeStatus(result.result);
}

export async function readProductionRuntimeStatus(): Promise<StudioRuntimeStatus> {
  try {
    return mapRuntimeControlResult(await executeRuntimeControlCommand(
      { kind: "status" },
      createProductionRuntimeCliDependencies(),
    ));
  } catch (error) {
    const nextAction = error instanceof StudioError
      ? error.nextAction ?? error.message
      : error instanceof RuntimeError
        ? error.nextAction ?? error.message
        : "Build or start the Runtime before applying a theme.";
    return StudioRuntimeStatusSchema.parse({
      status: "stopped",
      controllerAvailable: false,
      selectedTheme: null,
      appliedTheme: null,
      skinApplied: false,
      packageVersion: null,
      operation: null,
      nextAction,
    });
  }
}

export async function applyProductionRuntimeTheme(
  ref: StudioThemeRef,
  dependencies: ProductionRuntimeThemeDependencies = {
    readStatus: readProductionRuntimeStatus,
    execute: (command) => executeRuntimeControlCommand(
      command,
      createProductionRuntimeCliDependencies(),
    ),
  },
): Promise<StudioRuntimeStatus> {
  const current = await dependencies.readStatus();
  if (!current.controllerAvailable && current.status !== "stopped") {
    throw new StudioError(
      "STUDIO_APPLY_FAILED",
      "Runtime controller is unavailable",
      current.nextAction,
    );
  }
  if (current.status !== "stopped" && current.status !== "active" &&
    current.status !== "paused" && current.status !== "paused-incompatible") {
    throw new StudioError(
      "STUDIO_APPLY_FAILED",
      "Runtime is not ready to apply a theme",
      current.nextAction,
    );
  }

  try {
    let applied: StudioRuntimeStatus;
    if (current.status === "stopped") {
      applied = await executeRuntimeCommand(dependencies.execute, {
        kind: "launch",
        themeId: ref.id,
        themeVersion: ref.version,
      });
    } else {
      const switched = await executeRuntimeCommand(dependencies.execute, {
        kind: "switch",
        themeId: ref.id,
        themeVersion: ref.version,
      });
      applied = switched.status === "active"
        ? switched
        : await executeRuntimeCommand(dependencies.execute, { kind: "resume" });
    }
    if (applied.status !== "active" || applied.skinApplied !== true ||
      applied.appliedTheme?.id !== ref.id || applied.appliedTheme.version !== ref.version) {
      throw new StudioError(
        "STUDIO_APPLY_FAILED",
        "Runtime did not confirm the exact theme as active",
        applied.nextAction,
      );
    }
    return applied;
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw new StudioError(
      "STUDIO_APPLY_FAILED",
      "Runtime theme application failed",
      error instanceof RuntimeError ? error.nextAction : undefined,
    );
  }
}

export async function restoreProductionRuntimeTheme(
  dependencies: ProductionRuntimeThemeDependencies = {
    readStatus: readProductionRuntimeStatus,
    execute: (command) => executeRuntimeControlCommand(
      command,
      createProductionRuntimeCliDependencies(),
    ),
  },
): Promise<StudioRuntimeStatus> {
  const current = await dependencies.readStatus();
  if (current.status === "stopped" || current.status === "restored-awaiting-exit" ||
    current.status === "restored-cleanup-required") {
    return current;
  }
  if (!current.controllerAvailable || current.status === "launching" ||
    current.status === "restoring") {
    throw new StudioError(
      "STUDIO_APPLY_FAILED",
      "Runtime is not ready to restore the official appearance",
      current.nextAction,
    );
  }

  try {
    const restored = await executeRuntimeCommand(dependencies.execute, { kind: "restore" });
    if (restored.status !== "restored-awaiting-exit" &&
      restored.status !== "restored-cleanup-required") {
      throw new StudioError(
        "STUDIO_APPLY_FAILED",
        "Runtime did not confirm the official appearance was restored",
        restored.nextAction,
      );
    }
    return restored;
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw new StudioError(
      "STUDIO_APPLY_FAILED",
      "Codex official appearance could not be restored",
      error instanceof RuntimeError ? error.nextAction : undefined,
    );
  }
}
