import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_SWITCH_EDGES,
  type ControlResponse,
} from "@open-chatgpt-skin/windows-runtime";
import { createIntegratedRuntimeFixture } from "./helpers/runtime-fixture.js";

describe.skipIf(process.platform !== "win32")("secured Controller Pipe integration", () => {
  it("runs the complete four-theme control flow through protocol boundaries", async () => {
    const fixture = await createIntegratedRuntimeFixture();
    await fixture.startPipe();
    try {
      await expect(fixture.send("launch", { themeId: "future-idol-cyan" }))
        .resolves.toMatchObject({ ok: true, result: { status: "active" } });

      for (const [source, target] of ACCEPTANCE_SWITCH_EDGES) {
        expect((await fixture.status()).result.appliedTheme?.id).toBe(source);
        await expect(fixture.send("switch", { themeId: target }))
          .resolves.toMatchObject({
            ok: true,
            result: { appliedTheme: { id: target }, skinApplied: true },
          });
      }

      await fixture.send("pause", {});
      await fixture.send("switch", { themeId: "glacier-aurora" });
      await expect(fixture.status()).resolves.toMatchObject({
        result: { status: "paused", appliedTheme: null },
      });
      await fixture.send("resume", {});
      await fixture.send("restore", {});
      await expect(fixture.send("resume", {})).resolves.toMatchObject({
        ok: false,
        error: { code: "RESTORE_AWAITING_EXIT" },
      });
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it("does not dispatch malformed input and executes duplicate IDs once", async () => {
    const fixture = await createIntegratedRuntimeFixture();
    await fixture.startPipe();
    try {
      await fixture.sendRawOversizedFrame();
      expect(fixture.dispatchCount()).toBe(0);
      const requestId = "00000000-0000-4000-8000-000000000099";
      await fixture.send("launch", { themeId: "mountain-mist" }, requestId);
      await fixture.send("launch", { themeId: "mountain-mist" }, requestId);
      expect(fixture.launchCount()).toBe(1);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it("starts exit monitoring only after flush and keeps reused ports pending", async () => {
    const fixture = await createIntegratedRuntimeFixture({ reuseOldPort: true });
    await fixture.startPipe();
    try {
      await fixture.send("launch", { themeId: "mountain-mist" });
      const restored = await fixture.send("restore", {});
      expect(restored.ok).toBe(true);
      expect(fixture.events()).toEqual(
        expect.arrayContaining(["response-flushed", "exit-monitor-started"]),
      );
      expect(fixture.events().indexOf("response-flushed"))
        .toBeLessThan(fixture.events().indexOf("exit-monitor-started"));
      fixture.exitRoot();
      await fixture.runInitialPortWait();
      await expect(fixture.status()).resolves.toMatchObject({
        result: { status: "restored-cleanup-required" },
      });
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe("in-process Controller integration", () => {
  it("keeps all twelve fixed switches active without the Pipe transport", async () => {
    const fixture = await createIntegratedRuntimeFixture();
    try {
      await fixture.send("launch", { themeId: "future-idol-cyan" });
      for (const [source, target] of ACCEPTANCE_SWITCH_EDGES) {
        expect((await fixture.status()).result.appliedTheme?.id).toBe(source);
        await expect(fixture.send("switch", { themeId: target }))
          .resolves.toMatchObject({ ok: true, result: { status: "active" } });
      }
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it.each([
    ["candidate-fails", "THEME_SWITCH_FAILED", "active"],
    ["rollback-fails", "THEME_ROLLBACK_FAILED", "paused-incompatible"],
    ["ambiguous-reconnect", "CDP_TARGET_AMBIGUOUS", "recovery-required"],
  ] as const)("handles %s without false success", async (mode, code, status) => {
    const fixture = await createIntegratedRuntimeFixture({ mode });
    try {
      await fixture.send("launch", { themeId: "mountain-mist" });
      const response = mode === "ambiguous-reconnect"
        ? await fixture.disconnectAndReadResult()
        : await fixture.send("switch", { themeId: "glacier-aurora" });
      expect(response).toMatchObject({ ok: false, error: { code } });
      await expect(fixture.status()).resolves.toMatchObject({ result: { status } });
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it("keeps protocol response schemas at the dispatcher boundary", async () => {
    const fixture = await createIntegratedRuntimeFixture();
    try {
      const response: ControlResponse = await fixture.send("launch", {
        themeId: "mountain-mist",
      });
      expect(response).toMatchObject({
        protocolVersion: 1,
        ok: true,
        result: { status: "active" },
      });
    } finally {
      await fixture.close();
    }
  });
});
