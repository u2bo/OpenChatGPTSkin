import { RuntimeError } from "./errors.js";
import { ProbeEvidenceSchema, type ProbeEvidence } from "./probe-evidence.js";
import type { PendingProbeStore } from "./probe-session.js";
import type { RuntimeStateStore } from "./state.js";
import type { WindowsRuntimeProvider } from "./types.js";

export interface FinalizeProbeDependencies {
  readonly provider: WindowsRuntimeProvider;
  readonly sessionStore: PendingProbeStore;
  readonly runtimeStateStore: RuntimeStateStore;
  readonly recordEvidence: (evidence: ProbeEvidence) => Promise<string>;
}

export async function finalizeProbe(
  dependencies: FinalizeProbeDependencies,
): Promise<ProbeEvidence> {
  const pending = await dependencies.sessionStore.read();
  if (!pending) {
    throw new RuntimeError("PROBE_PENDING_SESSION_INVALID", "No pending probe exists");
  }
  const exited = await dependencies.provider.waitForExit(
    pending.root.pid,
    pending.root.startedAt,
    100,
  );
  if (!exited || await dependencies.provider.inspectPort(pending.cdp.port)) {
    throw new RuntimeError("PROBE_EXIT_PENDING", "Managed Codex or CDP is active");
  }
  const runtime = await dependencies.runtimeStateStore.read();
  if (runtime?.codex &&
    runtime.codex.rootPid === pending.root.pid &&
    runtime.codex.startedAt === pending.root.startedAt) {
    throw new RuntimeError("PROBE_EXIT_PENDING", "Runtime still owns this root");
  }
  if (pending.status === "failed-awaiting-exit") {
    await dependencies.sessionStore.clear();
    throw new RuntimeError(pending.failureCode, "Phase-one probe failed");
  }
  const evidence = ProbeEvidenceSchema.parse({
    schemaVersion: 2,
    ...pending.observation,
    managedExitVerified: true,
    cdpClosedVerified: true,
  });
  if (pending.recordEvidenceRequested) {
    await dependencies.recordEvidence(evidence);
  }
  await dependencies.sessionStore.clear();
  return evidence;
}
