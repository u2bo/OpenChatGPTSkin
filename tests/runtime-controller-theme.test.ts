import { describe, expect, it } from "vitest";
import { RUNTIME_BUILTIN_THEME_IDS } from "@open-chatgpt-skin/windows-runtime";
import { createRuntimeControllerFixture } from "./helpers/runtime-fixture.js";

describe("RuntimeController theme commands", () => {
  it("supports every directed switch pair", async () => {
    for (const source of RUNTIME_BUILTIN_THEME_IDS) {
      for (const target of RUNTIME_BUILTIN_THEME_IDS) {
        if (source === target) continue;
        const fixture = await createRuntimeControllerFixture();

        await fixture.controller.launch(source, crypto.randomUUID());
        const result = await fixture.controller.switchTheme(target, crypto.randomUUID());

        expect(result).toMatchObject({
          status: "active",
          selectedTheme: { id: target },
          appliedTheme: { id: target },
          skinApplied: true,
        });
      }
    }
  });

  it("changes only selectedTheme while paused", async () => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await fixture.controller.pause(crypto.randomUUID());
    const switched = await fixture.controller.switchTheme(
      "glacier-aurora",
      crypto.randomUUID(),
    );

    expect(switched).toMatchObject({
      status: "paused",
      selectedTheme: { id: "glacier-aurora" },
      appliedTheme: null,
      skinApplied: false,
    });
    expect(fixture.page.adapter.apply).toHaveBeenCalledTimes(1);
  });

  it("upgrades an active theme when its previous built-in version is no longer installed", async () => {
    const fixture = await createRuntimeControllerFixture({
      previousThemeUnavailableAfterLaunch: true,
    });

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await expect(fixture.controller.switchTheme(
      "mountain-mist",
      crypto.randomUUID(),
      "2.0.0",
    )).resolves.toMatchObject({
      status: "active",
      selectedTheme: { id: "mountain-mist", version: "2.0.0" },
      appliedTheme: { id: "mountain-mist", version: "2.0.0" },
      skinApplied: true,
    });
  });

  it("returns the old active theme when candidate rollback succeeds", async () => {
    const fixture = await createRuntimeControllerFixture({
      failApplyFor: ["glacier-aurora"],
    });

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await expect(fixture.controller.switchTheme(
      "glacier-aurora",
      crypto.randomUUID(),
    )).rejects.toMatchObject({ code: "THEME_SWITCH_FAILED" });
    expect(await fixture.controller.status()).toMatchObject({
      status: "active",
      appliedTheme: { id: "mountain-mist" },
    });
  });

  it("degrades without lying when both candidate and rollback fail", async () => {
    const fixture = await createRuntimeControllerFixture({ failApplyAfterLaunch: true });

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await expect(fixture.controller.switchTheme(
      "glacier-aurora",
      crypto.randomUUID(),
    )).rejects.toMatchObject({ code: "THEME_ROLLBACK_FAILED" });
    expect((await fixture.controller.status()).status).toBe("paused-incompatible");
  });

  it("writes paused only after verified cleanup and treats repeated pause as success", async () => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    const first = await fixture.controller.pause(crypto.randomUUID());
    const second = await fixture.controller.pause(crypto.randomUUID());

    expect(first.status).toBe("paused");
    expect(second).toEqual(first);
    expect(fixture.calls().indexOf("cleanup-theme"))
      .toBeLessThan(fixture.calls().lastIndexOf("write-paused"));
  });

  it("resumes the theme selected while paused", async () => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await fixture.controller.pause(crypto.randomUUID());
    await fixture.controller.switchTheme("glacier-aurora", crypto.randomUUID());

    await expect(fixture.controller.resume(crypto.randomUUID())).resolves.toMatchObject({
      status: "active",
      appliedTheme: { id: "glacier-aurora" },
    });
  });

  it("can replace an incompatible paused selection before resuming", async () => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await fixture.controller.pause(crypto.randomUUID());
    fixture.failNextResume("ADAPTER_INCOMPATIBLE");
    await expect(fixture.controller.resume(crypto.randomUUID()))
      .rejects.toMatchObject({ code: "ADAPTER_INCOMPATIBLE" });

    await expect(fixture.controller.switchTheme(
      "glacier-aurora",
      crypto.randomUUID(),
    )).resolves.toMatchObject({
      status: "paused",
      selectedTheme: { id: "glacier-aurora" },
      appliedTheme: null,
      skinApplied: false,
    });
    await expect(fixture.controller.resume(crypto.randomUUID())).resolves.toMatchObject({
      status: "active",
      appliedTheme: { id: "glacier-aurora" },
      skinApplied: true,
    });
  });

  it.each([
    ["ADAPTER_INCOMPATIBLE", "paused-incompatible", false],
    ["THEME_CLEANUP_FAILED", "recovery-required", null],
  ] as const)("degrades resume failure %s truthfully", async (error, status, skinApplied) => {
    const fixture = await createRuntimeControllerFixture();

    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    await fixture.controller.pause(crypto.randomUUID());
    fixture.failNextResume(error);

    await expect(fixture.controller.resume(crypto.randomUUID()))
      .rejects.toMatchObject({ code: error });
    expect(await fixture.controller.status()).toMatchObject({ status, skinApplied });
  });

  it.each(["restored-awaiting-exit", "restored-cleanup-required"] as const)(
    "rejects theme commands in %s",
    async (terminalStatus) => {
      const fixture = await createRuntimeControllerFixture({ terminalStatus });

      await expect(fixture.controller.switchTheme("glacier-aurora", crypto.randomUUID()))
        .rejects.toMatchObject({ code: "RESTORE_AWAITING_EXIT" });
      await expect(fixture.controller.resume(crypto.randomUUID()))
        .rejects.toMatchObject({ code: "RESTORE_AWAITING_EXIT" });
    },
  );
});
