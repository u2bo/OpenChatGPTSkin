import { describe, expect, it } from "vitest";
import { createRuntimeControllerFixture } from "./helpers/runtime-fixture.js";

describe("RuntimeController launch", () => {
  it("commits active only after official identity, page, apply, and verify succeed", async () => {
    const fixture = await createRuntimeControllerFixture();

    const result = await fixture.controller.launch(
      "mountain-mist",
      "00000000-0000-4000-8000-000000000001",
    );

    expect(result).toMatchObject({
      status: "active",
      selectedTheme: { id: "mountain-mist" },
      appliedTheme: { id: "mountain-mist" },
      skinApplied: true,
    });
    expect(fixture.calls()).toEqual([
      "secure", "load-theme", "write-launching", "launch-codex", "wait-port",
      "activate-window", "wait-port", "connect-page", "apply-theme", "write-active",
    ]);
  });

  it("keeps Codex open and waits for Quit when launch fails after safe cleanup", async () => {
    const fixture = await createRuntimeControllerFixture({ applyError: "THEME_VERIFY_FAILED" });

    await expect(fixture.controller.launch(
      "mountain-mist",
      "00000000-0000-4000-8000-000000000002",
    )).rejects.toMatchObject({ code: "THEME_VERIFY_FAILED" });

    expect(await fixture.state.read()).toMatchObject({
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
    });
    expect(fixture.provider.waitForExit).not.toHaveBeenCalled();
  });

  it("persists the final Codex root adopted during window activation", async () => {
    const fixture = await createRuntimeControllerFixture();
    fixture.activateWindow.mockImplementationOnce(async (receipt) => ({
      ...receipt,
      root: {
        ...receipt.root,
        pid: 300,
        startedAt: "2026-07-17T00:00:01.000Z",
      },
    }));

    await fixture.controller.launch(
      "mountain-mist",
      "00000000-0000-4000-8000-000000000004",
    );

    expect(await fixture.state.read()).toMatchObject({
      status: "active",
      codex: {
        rootPid: 300,
        startedAt: "2026-07-17T00:00:01.000Z",
      },
    });
    expect(fixture.waitForPort).toHaveBeenNthCalledWith(2, expect.objectContaining({
      root: expect.objectContaining({
        pid: 300,
        startedAt: "2026-07-17T00:00:01.000Z",
      }),
    }));
  });

  it("records unknown appearance instead of false cleanup success", async () => {
    const fixture = await createRuntimeControllerFixture({
      applyError: "THEME_VERIFY_FAILED",
      cleanupError: "THEME_CLEANUP_FAILED",
    });

    await expect(fixture.controller.launch(
      "mountain-mist",
      "00000000-0000-4000-8000-000000000003",
    )).rejects.toMatchObject({ code: "THEME_CLEANUP_FAILED" });

    expect(await fixture.state.read()).toMatchObject({
      status: "recovery-required",
      appliedTheme: null,
      skinApplied: null,
    });
  });
});
