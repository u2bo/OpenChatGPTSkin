import {
  ACCEPTANCE_SWITCH_EDGES,
} from "./acceptance-sequence.js";
import {
  RuntimeAcceptanceEvidenceSchema,
  type RuntimeAcceptanceEvidence,
} from "./acceptance-evidence.js";
import {
  PendingAcceptanceSessionSchema,
  type AcceptanceSessionStore,
} from "./acceptance-session.js";
import type { RuntimeStatusView } from "./control/protocol.js";
import { RuntimeError } from "./errors.js";
import { RUNTIME_BUILTIN_THEME_IDS, type RuntimeBuiltinThemeId } from "./themes/ids.js";
import type { ProcessIdentity, WindowsRuntimeProvider } from "./types.js";

export type RuntimeAcceptanceCommand =
  | { readonly kind: "begin" }
  | { readonly kind: "finalize" };

export type RuntimeAcceptanceControlCommand =
  | { readonly command: "launch" | "switch"; readonly themeId: RuntimeBuiltinThemeId }
  | { readonly command: "pause" | "resume" | "restore" | "status" };

export interface ManagedAcceptanceSession {
  readonly runtime: { readonly pid: number; readonly startedAt: string };
  readonly root: { readonly pid: number; readonly startedAt: string };
  readonly cdp: { readonly host: "127.0.0.1"; readonly port: number };
  readonly packageVersion: string;
}

export interface RuntimeAcceptanceDependencies {
  readonly provider: Pick<WindowsRuntimeProvider,
    | "listCodexRoots"
    | "waitForExit"
    | "inspectPort"
    | "inspectRemoteDebuggingArguments"
    | "measureProcessCpuPercent"
  >;
  readonly sessionStore: AcceptanceSessionStore;
  readonly readManagedSession: () => Promise<ManagedAcceptanceSession | null>;
  readonly securePendingDirectory: () => Promise<void>;
  readonly executeControl: (
    command: RuntimeAcceptanceControlCommand,
  ) => Promise<RuntimeStatusView>;
  readonly discoverNormalCodex: () => Promise<{
    readonly install: { readonly packageVersion: string };
    readonly root: ProcessIdentity | null;
  }>;
  readonly recordEvidence: (evidence: RuntimeAcceptanceEvidence) => Promise<string>;
  readonly now: () => string;
  readonly performanceNow: () => number;
  readonly newSessionId: () => string;
  readonly runtimeVersion: string;
}

export type RuntimeAcceptanceResult =
  | {
    readonly compatible: null;
    readonly phase: "awaiting-exit";
    readonly nextAction: string;
  }
  | {
    readonly compatible: true;
    readonly phase: "complete";
    readonly evidence: RuntimeAcceptanceEvidence;
  };

function assertedStatus(
  result: RuntimeStatusView,
  expectedStatus: RuntimeStatusView["status"],
  selectedTheme: RuntimeBuiltinThemeId | null,
  appliedTheme: RuntimeBuiltinThemeId | null,
): RuntimeStatusView {
  if (result.status !== expectedStatus ||
    (result.selectedTheme?.id ?? null) !== selectedTheme ||
    (result.appliedTheme?.id ?? null) !== appliedTheme ||
    result.skinApplied !== (appliedTheme !== null)) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "Acceptance control result was not verified");
  }
  return result;
}

function assertFiniteDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 2_000) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "Theme operation exceeded acceptance bounds");
  }
  return value;
}

async function runBegin(
  dependencies: RuntimeAcceptanceDependencies,
): Promise<RuntimeAcceptanceResult> {
  if (await dependencies.sessionStore.read()) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "Acceptance finalization is still required");
  }
  if ((await dependencies.provider.listCodexRoots()).length !== 0) {
    throw new RuntimeError("CODEX_ALREADY_RUNNING_UNMANAGED", "Codex must be closed before acceptance");
  }
  await dependencies.securePendingDirectory();

  let maxThemeOperationDurationMs = 0;
  const timed = async (command: RuntimeAcceptanceControlCommand): Promise<RuntimeStatusView> => {
    const started = dependencies.performanceNow();
    const result = await dependencies.executeControl(command);
    const duration = assertFiniteDuration(dependencies.performanceNow() - started);
    maxThemeOperationDurationMs = Math.max(maxThemeOperationDurationMs, duration);
    return result;
  };

  assertedStatus(
    await dependencies.executeControl({ command: "launch", themeId: "future-idol-cyan" }),
    "active",
    "future-idol-cyan",
    "future-idol-cyan",
  );

  const appliedThemeIds = new Set<RuntimeBuiltinThemeId>(["future-idol-cyan"]);
  const switches: RuntimeAcceptanceEvidence["switches"] = [];
  for (const [source, target] of ACCEPTANCE_SWITCH_EDGES) {
    const status = await dependencies.executeControl({ command: "status" });
    assertedStatus(status, "active", source, source);
    assertedStatus(await timed({ command: "switch", themeId: target }), "active", target, target);
    appliedThemeIds.add(target);
    switches.push({ from: source, to: target, verified: true });
  }

  if (appliedThemeIds.size !== RUNTIME_BUILTIN_THEME_IDS.length ||
    RUNTIME_BUILTIN_THEME_IDS.some((id) => !appliedThemeIds.has(id))) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "Acceptance did not apply every built-in theme");
  }

  const activeBeforePause = ACCEPTANCE_SWITCH_EDGES.at(-1)![1];
  const pausedTheme = "glacier-aurora" as const;
  assertedStatus(await timed({ command: "pause" }), "paused", activeBeforePause, null);
  assertedStatus(await timed({ command: "switch", themeId: pausedTheme }), "paused", pausedTheme, null);
  assertedStatus(await timed({ command: "resume" }), "active", pausedTheme, pausedTheme);
  assertedStatus(await dependencies.executeControl({ command: "restore" }), "restored-awaiting-exit", pausedTheme, null);

  const managed = await dependencies.readManagedSession();
  if (!managed) {
    throw new RuntimeError("RUNTIME_SESSION_STALE", "Managed Runtime session is unavailable");
  }
  const idleCpuPercent = await dependencies.provider.measureProcessCpuPercent(
    managed.runtime.pid,
    managed.runtime.startedAt,
    2_000,
  );
  if (!Number.isFinite(idleCpuPercent) || idleCpuPercent < 0 || idleCpuPercent >= 1) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "Idle CPU exceeded acceptance bounds");
  }

  const now = dependencies.now();
  await dependencies.sessionStore.write(PendingAcceptanceSessionSchema.parse({
    schemaVersion: 1,
    sessionId: dependencies.newSessionId(),
    status: "awaiting-exit",
    runtime: managed.runtime,
    root: managed.root,
    cdp: managed.cdp,
    packageVersion: managed.packageVersion,
    runtimeVersion: dependencies.runtimeVersion,
    themes: RUNTIME_BUILTIN_THEME_IDS.map((id) => ({ id, applied: true, verified: true })),
    switches,
    pauseVerified: true,
    pausedSwitchVerified: true,
    resumeVerified: true,
    restoreVerified: true,
    maxThemeOperationDurationMs,
    idleCpuPercent,
    createdAt: now,
    updatedAt: now,
  }));
  return {
    compatible: null,
    phase: "awaiting-exit",
    nextAction: "Quit the managed Codex completely, start Codex normally, then run runtime:acceptance -- --finalize.",
  };
}

async function runFinalize(
  dependencies: RuntimeAcceptanceDependencies,
): Promise<RuntimeAcceptanceResult> {
  const pending = await dependencies.sessionStore.read();
  if (!pending) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "No acceptance session is awaiting finalization");
  }
  const exited = await dependencies.provider.waitForExit(
    pending.root.pid,
    pending.root.startedAt,
    100,
  );
  if (!exited || await dependencies.provider.inspectPort(pending.cdp.port)) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "Managed Codex cleanup is still pending");
  }
  const normal = await dependencies.discoverNormalCodex();
  if (!normal.root || normal.install.packageVersion !== pending.packageVersion ||
    (normal.root.pid === pending.root.pid && normal.root.startedAt === pending.root.startedAt)) {
    throw new RuntimeError("CODEX_IDENTITY_INVALID", "Normal Codex identity could not be verified");
  }
  const debug = await dependencies.provider.inspectRemoteDebuggingArguments(
    normal.root.pid,
    normal.root.startedAt,
  );
  if (debug.hasRemoteDebuggingAddress || debug.hasRemoteDebuggingPort) {
    throw new RuntimeError("RUNTIME_INVALID_STATE", "Normal Codex still has remote debugging enabled");
  }
  const evidence = RuntimeAcceptanceEvidenceSchema.parse({
    schemaVersion: 1,
    packageIdentity: "OpenAI.Codex",
    packageVersion: pending.packageVersion,
    runtimeVersion: pending.runtimeVersion,
    themes: pending.themes,
    switches: pending.switches,
    pauseVerified: pending.pauseVerified,
    pausedSwitchVerified: pending.pausedSwitchVerified,
    resumeVerified: pending.resumeVerified,
    restoreVerified: pending.restoreVerified,
    maxThemeOperationDurationMs: pending.maxThemeOperationDurationMs,
    idleCpuPercent: pending.idleCpuPercent,
    managedExitVerified: true,
    cdpClosedVerified: true,
    normalLaunchNoDebugArguments: true,
  });
  await dependencies.recordEvidence(evidence);
  await dependencies.sessionStore.clear();
  return { compatible: true, phase: "complete", evidence };
}

export async function runRuntimeAcceptance(
  command: RuntimeAcceptanceCommand,
  dependencies: RuntimeAcceptanceDependencies,
): Promise<RuntimeAcceptanceResult> {
  return command.kind === "begin"
    ? runBegin(dependencies)
    : runFinalize(dependencies);
}
