import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExitMonitor,
  RuntimeSessionStateSchema,
  type RuntimeSessionState,
  type RuntimeStateStore,
  type WindowsRuntimeProvider,
} from "@open-chatgpt-skin/windows-runtime";
import { createRuntimeControllerFixture, makeRuntimeState } from "./helpers/runtime-fixture.js";

describe("Runtime safe restore", () => {
  it("restores official appearance and waits for a real user Quit", async () => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    const restored = await fixture.controller.restore(crypto.randomUUID());

    expect(restored).toMatchObject({
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
    });
    expect(fixture.provider.waitForExit).not.toHaveBeenCalled();
    await expect(fixture.controller.resume(crypto.randomUUID()))
      .rejects.toMatchObject({ code: "RESTORE_AWAITING_EXIT" });
  });

  it("clears state only after exact root exit and old port closure", async () => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await fixture.controller.restore(crypto.randomUUID());
    fixture.exitRoot();
    fixture.closePort();
    await fixture.runExitMonitor();

    expect(await fixture.state.read()).toBeNull();
    expect(fixture.onStopped).toHaveBeenCalledOnce();
  });

  it("persists cleanup-required while the old port remains open", async () => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await fixture.controller.restore(crypto.randomUUID());
    fixture.exitRoot();
    await fixture.runInitialPortWait();

    expect(await fixture.state.read()).toMatchObject({
      status: "restored-cleanup-required",
    });
    expect(fixture.onStopped).not.toHaveBeenCalled();
  });

  it("restores the verified active appearance when cleanup fails", async () => {
    const fixture = await createRuntimeControllerFixture({
      cleanupError: "THEME_CLEANUP_FAILED",
    });
    await fixture.controller.launch("mountain-mist", crypto.randomUUID());

    await expect(fixture.controller.restore(crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THEME_CLEANUP_FAILED" });

    expect(await fixture.controller.status()).toMatchObject({
      status: "active",
      appliedTheme: { id: "mountain-mist" },
      skinApplied: true,
    });
  });

  it("records unknown appearance when cleanup and re-verification both fail", async () => {
    const fixture = await createRuntimeControllerFixture({
      cleanupError: "THEME_CLEANUP_FAILED",
    });
    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    vi.mocked(fixture.page.adapter.verify).mockResolvedValueOnce({ valid: false });

    await expect(fixture.controller.restore(crypto.randomUUID()))
      .rejects.toMatchObject({ code: "THEME_CLEANUP_FAILED" });

    expect(await fixture.controller.status()).toMatchObject({
      status: "recovery-required",
      appliedTheme: null,
      skinApplied: null,
    });
  });
});

describe("ExitMonitor cleanup polling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not restart the initial port grace period after cleanup is required", async () => {
    const session = makeRuntimeState({
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
      pendingOperation: null,
    });
    let current: RuntimeSessionState | null = session;
    const state = {
      read: vi.fn(async () => current),
      write: vi.fn(async (value: RuntimeSessionState) => {
        current = RuntimeSessionStateSchema.parse(value);
      }),
      clear: vi.fn(async () => { current = null; }),
    } as unknown as RuntimeStateStore;
    const provider = {
      waitForExit: vi.fn(async () => true),
      inspectPort: vi.fn(async () => ({
        host: "127.0.0.1",
        port: 55123,
        owningPid: 201,
        ancestors: [201, 200],
      })),
      inspectRemoteDebuggingArguments: vi.fn(async () => ({
        hasRemoteDebuggingAddress: false,
        hasRemoteDebuggingPort: false,
      })),
      measureProcessCpuPercent: vi.fn(async () => 0.25),
    } as unknown as WindowsRuntimeProvider;
    const monitor = new ExitMonitor({
      provider,
      state,
      onStopped: vi.fn(),
      initialPortWaitMs: 1_000,
      initialIntervalMs: 100,
      cleanupIntervalMs: 500,
    });

    monitor.start(session);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(current).toMatchObject({ status: "restored-cleanup-required" });

    const checksAfterInitialGrace = vi.mocked(provider.inspectPort).mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(provider.inspectPort).toHaveBeenCalledTimes(checksAfterInitialGrace + 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(provider.inspectPort).toHaveBeenCalledTimes(checksAfterInitialGrace + 1);
    monitor.stop();
  });
});

it("does not include a production API that force-closes Codex", async () => {
  const source = await readTypeScriptTree("runtime/windows/src");

  expect(source).not.toMatch(/Browser\.close|window\.close\(\)|CloseMainWindow|TerminateProcess|taskkill/);
});

async function readTypeScriptTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readTypeScriptTree(path);
    return entry.name.endsWith(".ts") ? readFile(path, "utf8") : "";
  }));
  return contents.join("\n");
}
