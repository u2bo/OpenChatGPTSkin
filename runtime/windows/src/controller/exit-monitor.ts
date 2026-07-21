import { RuntimeError } from "../errors.js";
import { transitionRuntimeState } from "../session/state-machine.js";
import type { RuntimeSessionState, RuntimeStateStore } from "../state.js";
import type { WindowsRuntimeProvider } from "../types.js";

export interface ExitMonitorDependencies {
  readonly provider: WindowsRuntimeProvider;
  readonly state: RuntimeStateStore;
  readonly onStopped: () => Promise<void> | void;
  readonly initialPortWaitMs?: number;
  readonly initialIntervalMs?: number;
  readonly cleanupIntervalMs?: number;
}

function boundedDelay(value: number | undefined, fallback: number, allowZero = false): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < (allowZero ? 0 : 1) || resolved > 60_000) {
    throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Exit monitor delay is invalid");
  }
  return resolved;
}

export class ExitMonitor {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly dependencies: ExitMonitorDependencies) {}

  start(session: RuntimeSessionState): void {
    if (!session.codex || !session.cdp) {
      throw new RuntimeError("RUNTIME_SESSION_STALE", "Exit monitor requires managed identities");
    }
    this.stop();
    this.running = true;
    void this.observe(session).catch(() => {
      // The terminal session remains persisted so a later Controller can retry safely.
      this.stop();
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async observe(session: RuntimeSessionState): Promise<void> {
    if (!this.running) return;
    if (session.status === "restored-cleanup-required") {
      await this.observePort(session, false);
      return;
    }

    const exited = await this.dependencies.provider.waitForExit(
      session.codex!.rootPid,
      session.codex!.startedAt,
      500,
    );
    if (!this.running) return;
    if (!exited) {
      this.schedule(session, boundedDelay(this.dependencies.initialIntervalMs, 100));
      return;
    }

    await this.observePort(session, true);
  }

  private async observePort(
    session: RuntimeSessionState,
    initial: boolean,
  ): Promise<void> {
    const initialWaitMs = boundedDelay(this.dependencies.initialPortWaitMs, 10_000, true);
    const intervalMs = boundedDelay(this.dependencies.initialIntervalMs, 100);
    const deadline = Date.now() + (initial ? initialWaitMs : 0);

    while (this.running) {
      const listener = await this.dependencies.provider.inspectPort(session.cdp!.port);
      if (!listener) {
        await this.clearStoppedSession(session);
        return;
      }
      if (!initial || Date.now() >= deadline) {
        const cleanupSession = await this.markCleanupRequired(session);
        if (cleanupSession) {
          this.schedule(cleanupSession, boundedDelay(this.dependencies.cleanupIntervalMs, 5_000));
        }
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  private async clearStoppedSession(session: RuntimeSessionState): Promise<void> {
    const current = await this.dependencies.state.read();
    if (!current || current.sessionId !== session.sessionId) {
      this.stop();
      return;
    }
    await this.dependencies.state.clear();
    await this.dependencies.onStopped();
    this.stop();
  }

  private async markCleanupRequired(
    session: RuntimeSessionState,
  ): Promise<RuntimeSessionState | null> {
    const current = await this.dependencies.state.read();
    if (!current || current.sessionId !== session.sessionId) {
      this.stop();
      return null;
    }
    if (current.status === "restored-cleanup-required") return current;

    const next: RuntimeSessionState = {
      ...current,
      status: "restored-cleanup-required",
      appliedTheme: null,
      skinApplied: false,
      pendingOperation: null,
      updatedAt: new Date().toISOString(),
    };
    await this.dependencies.state.write(transitionRuntimeState(current, next));
    return next;
  }

  private schedule(session: RuntimeSessionState, delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.observe(session);
      } catch {
        // Keep the terminal state intact rather than claiming cleanup succeeded.
        this.stop();
      }
    }, delayMs);
  }
}
