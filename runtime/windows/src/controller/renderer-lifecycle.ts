import type { RuntimePageSession } from "./page-session.js";

export interface RendererLifecycleDependencies {
  readonly reconcile: () => Promise<void>;
  readonly reconnect: () => Promise<RuntimePageSession>;
  readonly debounceMs?: number;
}

export interface RendererEventSource {
  on(method: string, listener: (params: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
}

type ScheduledWork = "reconcile" | "reconnect";

export class RendererLifecycleMonitor {
  private source: RendererEventSource | null = null;
  private unsubscribeContext: (() => void) | null = null;
  private unsubscribeClose: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduled: ScheduledWork | null = null;
  private reconnecting = false;
  private running = false;

  constructor(private readonly dependencies: RendererLifecycleDependencies) {}

  start(source: RendererEventSource): void {
    this.stop();
    this.running = true;
    this.subscribe(source);
  }

  replace(source: RendererEventSource): void {
    if (!this.running) return;
    this.unsubscribe();
    this.subscribe(source);
  }

  stop(): void {
    this.running = false;
    this.reconnecting = false;
    this.scheduled = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe();
  }

  private subscribe(source: RendererEventSource): void {
    this.source = source;
    this.unsubscribeContext = source.on("Runtime.executionContextsCleared", () => {
      this.schedule("reconcile");
    });
    this.unsubscribeClose = source.onClose(() => {
      if (this.reconnecting || this.scheduled === "reconnect") return;
      this.schedule("reconnect");
    });
  }

  private unsubscribe(): void {
    this.unsubscribeContext?.();
    this.unsubscribeClose?.();
    this.unsubscribeContext = null;
    this.unsubscribeClose = null;
    this.source = null;
  }

  private schedule(work: ScheduledWork): void {
    if (!this.running) return;
    if (this.scheduled === "reconnect") work = "reconnect";
    this.scheduled = work;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.timer = null;
      const scheduled = this.scheduled;
      this.scheduled = null;
      if (scheduled) await this.run(scheduled);
    }, this.dependencies.debounceMs ?? 250);
  }

  private async run(work: ScheduledWork): Promise<void> {
    if (!this.running) return;
    if (work === "reconcile") {
      try {
        await this.dependencies.reconcile();
      } catch {
        // The Controller owns state classification for reconciliation failures.
      }
      return;
    }

    this.reconnecting = true;
    try {
      const page = await this.dependencies.reconnect();
      if (!this.running) return;
      this.replace(page.connection);
      await this.dependencies.reconcile();
    } catch {
      // reconnect() records the one truthful Controller outcome before rejecting.
    } finally {
      this.reconnecting = false;
    }
  }
}
