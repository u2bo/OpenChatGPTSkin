import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererLifecycleMonitor } from "@open-chatgpt-skin/windows-runtime";
import { createRuntimeControllerFixture } from "./helpers/runtime-fixture.js";

describe("RendererLifecycleMonitor", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces execution-context events into one reconciliation", async () => {
    const session = fakePageSession();
    const reconcile = vi.fn(async () => undefined);
    const monitor = new RendererLifecycleMonitor({ reconcile, reconnect: vi.fn() });

    monitor.start(session);
    session.emit("Runtime.executionContextsCleared", {});
    session.emit("Runtime.executionContextsCleared", {});
    await vi.advanceTimersByTimeAsync(249);
    expect(reconcile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("attempts one reconnect after close and never polls indefinitely", async () => {
    const session = fakePageSession();
    const reconnect = vi.fn(async () => fakePageSession());
    const monitor = new RendererLifecycleMonitor({ reconcile: vi.fn(), reconnect });

    monitor.start(session);
    session.closeFromRemote();
    await vi.advanceTimersByTimeAsync(250);
    expect(reconnect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reconnect).toHaveBeenCalledOnce();
  });
});

describe("RuntimeController renderer reconciliation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reapplies only while active", async () => {
    const active = await createRuntimeControllerFixture();
    await active.controller.launch("mountain-mist", crypto.randomUUID());
    active.emitExecutionContextsCleared();
    await vi.advanceTimersByTimeAsync(250);
    expect(active.page.adapter.apply).toHaveBeenCalledTimes(2);

    const paused = await createRuntimeControllerFixture();
    await paused.controller.launch("mountain-mist", crypto.randomUUID());
    await paused.controller.pause(crypto.randomUUID());
    paused.emitExecutionContextsCleared();
    await vi.advanceTimersByTimeAsync(250);
    expect(paused.page.adapter.apply).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ADAPTER_INCOMPATIBLE", "paused-incompatible", false],
    ["THEME_CLEANUP_FAILED", "recovery-required", null],
  ] as const)("records reconnect failure %s as %s", async (error, status, skinApplied) => {
    const fixture = await createRuntimeControllerFixture();
    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    fixture.failReconnect(error);
    fixture.disconnectPage();
    await vi.advanceTimersByTimeAsync(250);
    expect(await fixture.controller.status()).toMatchObject({ status, skinApplied });
  });

  it("does not claim official appearance when the old page cannot be cleaned", async () => {
    const fixture = await createRuntimeControllerFixture({
      cleanupError: "THEME_CLEANUP_FAILED",
    });
    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    fixture.failReconnect("ADAPTER_INCOMPATIBLE");
    fixture.disconnectPage();

    await vi.advanceTimersByTimeAsync(250);

    expect(await fixture.controller.status()).toMatchObject({
      status: "recovery-required",
      skinApplied: null,
    });
  });
});

function fakePageSession() {
  const events = new Map<string, Set<(value: unknown) => void>>();
  const closes = new Set<() => void>();
  const source = {
    on(method: string, listener: (value: unknown) => void) {
      const listeners = events.get(method) ?? new Set<(value: unknown) => void>();
      listeners.add(listener);
      events.set(method, listeners);
      return () => listeners.delete(listener);
    },
    onClose(listener: () => void) {
      closes.add(listener);
      return () => closes.delete(listener);
    },
    emit(method: string, value: unknown) {
      for (const listener of events.get(method) ?? []) listener(value);
    },
    closeFromRemote() {
      for (const listener of closes) listener();
    },
  };
  return { ...source, connection: source };
}
