import { describe, expect, it, vi } from "vitest";
import {
  RuntimeControlDispatcher,
  RuntimeError,
  recoverRuntimeController,
} from "@open-chatgpt-skin/windows-runtime";
import { createRuntimeControllerFixture } from "./helpers/runtime-fixture.js";

const requestId = {
  launch: "00000000-0000-4000-8000-000000000010",
  status: "00000000-0000-4000-8000-000000000011",
  switch: "00000000-0000-4000-8000-000000000012",
  mismatch: "00000000-0000-4000-8000-000000000013",
} as const;

function launchRequest(id = requestId.launch) {
  return {
    protocolVersion: 1 as const,
    requestId: id,
    command: "launch" as const,
    params: { themeId: "mountain-mist" as const },
  };
}

function statusRequest(id = requestId.status) {
  return {
    protocolVersion: 1 as const,
    requestId: id,
    command: "status" as const,
    params: {},
  };
}

function switchRequest(id = requestId.switch) {
  return {
    protocolVersion: 1 as const,
    requestId: id,
    command: "switch" as const,
    params: { themeId: "glacier-aurora" as const },
  };
}

describe("Runtime controller recovery", () => {
  it("revalidates the exact official root and port before reconnecting", async () => {
    const fixture = await createRuntimeControllerFixture();
    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    const callsBeforeCrash = fixture.calls().length;

    fixture.simulateControllerCrash();
    const recovered = await recoverRuntimeController(fixture.recoveryDependencies());
    const recoveryCalls = fixture.calls().slice(callsBeforeCrash);

    await expect(recovered.status()).resolves.toMatchObject({ status: "active" });
    expect(recoveryCalls).toContain("revalidate-install");
    expect(recoveryCalls).toContain("revalidate-port");
    expect(recoveryCalls.indexOf("revalidate-port"))
      .toBeLessThan(recoveryCalls.indexOf("connect-page"));
  });

  it("refuses a PID/start-time mismatch without deleting session evidence", async () => {
    const fixture = await createRuntimeControllerFixture();
    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    const callsBeforeRecovery = fixture.calls().length;
    fixture.replaceRootIdentity();

    await expect(recoverRuntimeController(fixture.recoveryDependencies()))
      .rejects.toMatchObject({ code: "RUNTIME_SESSION_STALE" });

    expect(await fixture.state.read()).not.toBeNull();
    expect(fixture.page.adapter.apply).toHaveBeenCalledTimes(1);
    expect(fixture.calls().slice(callsBeforeRecovery)).not.toContain("connect-page");
  });

  it("refuses a port-owner mismatch without deleting session evidence", async () => {
    const fixture = await createRuntimeControllerFixture();
    await fixture.controller.launch("mountain-mist", crypto.randomUUID());
    const callsBeforeRecovery = fixture.calls().length;
    fixture.closePort();

    await expect(recoverRuntimeController(fixture.recoveryDependencies()))
      .rejects.toMatchObject({ code: "CDP_PROCESS_MISMATCH" });

    expect(await fixture.state.read()).not.toBeNull();
    expect(fixture.calls().slice(callsBeforeRecovery)).not.toContain("connect-page");
  });

  it("reconciles an interrupted switch to the prior verified appearance", async () => {
    const fixture = await createRuntimeControllerFixture({
      initialPendingOperation: "switch",
    });

    const recovered = await recoverRuntimeController(fixture.recoveryDependencies());

    await expect(recovered.status()).resolves.toMatchObject({
      status: "active",
      selectedTheme: { id: "mountain-mist" },
      appliedTheme: { id: "mountain-mist" },
      skinApplied: true,
    });
    expect(fixture.calls()).toEqual(expect.arrayContaining([
      "cleanup-theme",
      "apply-theme",
    ]));
  });

  it("restores exit monitoring for a terminal session without connecting a page", async () => {
    const fixture = await createRuntimeControllerFixture({
      terminalStatus: "restored-awaiting-exit",
    });

    const recovered = await recoverRuntimeController(fixture.recoveryDependencies());

    await expect(recovered.status()).resolves.toMatchObject({
      status: "restored-awaiting-exit",
    });
    expect(fixture.calls()).toContain("exit-monitor-started");
    expect(fixture.calls()).not.toContain("connect-page");
  });

  it("conservatively restores an interrupted launch to the awaiting-exit terminal state", async () => {
    const fixture = await createRuntimeControllerFixture({
      initialPendingOperation: "launch",
    });

    const recovered = await recoverRuntimeController(fixture.recoveryDependencies());

    await expect(recovered.status()).resolves.toMatchObject({
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
    });
    expect(fixture.page.adapter.apply).not.toHaveBeenCalled();
    expect(fixture.calls()).toContain("cleanup-theme");
  });

  it.each([
    ["pause", "active", "mountain-mist", true],
    ["resume", "paused", null, false],
  ] as const)(
    "reconciles an interrupted %s to its last verified stable appearance",
    async (operation, status, appliedTheme, skinApplied) => {
      const fixture = await createRuntimeControllerFixture({
        initialPendingOperation: operation,
      });

      const recovered = await recoverRuntimeController(fixture.recoveryDependencies());

      await expect(recovered.status()).resolves.toMatchObject({
        status,
        appliedTheme: appliedTheme ? { id: appliedTheme } : null,
        skinApplied,
      });
    },
  );

  it("continues an interrupted restore before starting exit monitoring", async () => {
    const fixture = await createRuntimeControllerFixture({
      initialPendingOperation: "restore",
    });

    const recovered = await recoverRuntimeController(fixture.recoveryDependencies());

    await expect(recovered.status()).resolves.toMatchObject({
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
    });
    expect(fixture.calls()).toEqual(expect.arrayContaining([
      "cleanup-theme",
      "exit-monitor-started",
    ]));
  });

  it("keeps a verified restore terminal state when exit monitoring cannot start", async () => {
    const fixture = await createRuntimeControllerFixture({
      initialPendingOperation: "restore",
      failExitMonitorStart: true,
    });

    await expect(recoverRuntimeController(fixture.recoveryDependencies()))
      .rejects.toMatchObject({ code: "RUNTIME_CONTROL_UNAVAILABLE" });
    expect(await fixture.state.read()).toMatchObject({
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
    });
  });

  it("finishes restore after a recovery-required session has fully exited", async () => {
    const fixture = await createRuntimeControllerFixture({
      initialRecoveryRequired: true,
    });
    fixture.exitRoot();
    fixture.closePort();
    const callsBeforeRecovery = fixture.calls().length;

    const recovered = await recoverRuntimeController(fixture.recoveryDependencies());
    await expect(recovered.restore(crypto.randomUUID())).resolves.toMatchObject({
      status: "restored-awaiting-exit",
      appliedTheme: null,
      skinApplied: false,
    });
    expect(fixture.calls().slice(callsBeforeRecovery)).not.toContain("connect-page");
    expect(fixture.calls().slice(callsBeforeRecovery)).not.toContain("cleanup-theme");
  });
});

describe("RuntimeControlDispatcher", () => {
  it("returns the persisted response for a duplicate request ID", async () => {
    const fixture = await createRuntimeControllerFixture();
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    const request = launchRequest();

    const first = await dispatcher.dispatch(request);
    const second = await dispatcher.dispatch(request);

    expect(second.response).toEqual(first.response);
    expect(fixture.launchManaged).toHaveBeenCalledOnce();
    expect((await fixture.state.read())?.recentRequests).toEqual([
      expect.objectContaining({ requestId: request.requestId, command: "launch" }),
    ]);
  });

  it("rejects a duplicate request ID when its command differs", async () => {
    const fixture = await createRuntimeControllerFixture();
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);

    await dispatcher.dispatch(launchRequest(requestId.mismatch));
    await expect(dispatcher.dispatch(statusRequest(requestId.mismatch)))
      .resolves.toMatchObject({
        response: { ok: false, error: { code: "RUNTIME_CONTROL_UNAVAILABLE" } },
      });
  });

  it("serializes mutations while status remains readable", async () => {
    const fixture = await createRuntimeControllerFixture({ blockApply: true });
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    const launch = dispatcher.dispatch(launchRequest());
    await fixture.waitUntilApplyBlocked();

    await expect(dispatcher.dispatch(statusRequest())).resolves.toMatchObject({
      response: { ok: true, result: { status: "launching", operation: "launch" } },
    });
    await expect(dispatcher.dispatch(switchRequest()))
      .resolves.toMatchObject({
        response: { ok: false, error: { code: "RUNTIME_BUSY" } },
      });

    fixture.releaseApply();
    await launch;
  });

  it("starts exit monitoring only from the post-response restore callback", async () => {
    const fixture = await createRuntimeControllerFixture();
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    await dispatcher.dispatch(launchRequest());

    const restored = await dispatcher.dispatch({
      protocolVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000014",
      command: "restore",
      params: {},
    });

    expect(restored.response).toMatchObject({
      ok: true,
      result: { status: "restored-awaiting-exit" },
    });
    expect(fixture.calls()).not.toContain("exit-monitor-started");
    await restored.afterResponse?.();
    expect(fixture.calls()).toContain("exit-monitor-started");
  });

  it("does not duplicate the post-response restore callback for an in-flight retry", async () => {
    const fixture = await createRuntimeControllerFixture({ blockCleanup: true });
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    await dispatcher.dispatch(launchRequest());
    const request = {
      protocolVersion: 1 as const,
      requestId: "00000000-0000-4000-8000-000000000016",
      command: "restore" as const,
      params: {},
    };

    const original = dispatcher.dispatch(request);
    await fixture.waitUntilCleanupBlocked();
    const retry = dispatcher.dispatch(request);
    fixture.releaseCleanup();
    const [first, second] = await Promise.all([original, retry]);

    expect(first.afterResponse).toEqual(expect.any(Function));
    expect(second.afterResponse).toBeUndefined();
  });

  it("keeps only the newest 32 in-memory responses when no session file exists", async () => {
    const fixture = await createRuntimeControllerFixture();
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    const status = vi.spyOn(fixture.controller, "status");
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

    for (let index = 1; index <= 33; index += 1) {
      await dispatcher.dispatch(statusRequest(id(index)));
    }
    await dispatcher.dispatch(statusRequest(id(2)));
    await dispatcher.dispatch(statusRequest(id(1)));

    expect(status).toHaveBeenCalledTimes(34);
  });

  it("persists only sanitized stable error responses", async () => {
    const fixture = await createRuntimeControllerFixture({
      applyError: "THEME_VERIFY_FAILED",
    });
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    const request = launchRequest("00000000-0000-4000-8000-000000000015");

    const result = await dispatcher.dispatch(request);
    const serialized = JSON.stringify(result.response);
    const stored = await fixture.state.read();

    expect(result.response).toMatchObject({
      ok: false,
      error: { code: "THEME_VERIFY_FAILED" },
    });
    expect(result.afterResponse).toEqual(expect.any(Function));
    expect(fixture.calls()).not.toContain("exit-monitor-started");
    await result.afterResponse?.();
    expect(fixture.calls()).toContain("exit-monitor-started");
    expect(serialized).not.toContain("Configured apply failure");
    expect(JSON.stringify(stored?.recentRequests)).not.toContain("Configured apply failure");
  });

  it.each([
    "THEME_SCHEMA_VERSION_UNSUPPORTED",
    "THEME_WELCOME_INVALID",
    "THEME_DISPLAY_FONT_MISSING",
    "THEME_COMPOSITION_INVALID",
  ] as const)("recommends repairing the package for %s", async (code) => {
    const fixture = await createRuntimeControllerFixture({ applyError: code });
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    const result = await dispatcher.dispatch(launchRequest(
      `00000000-0000-4000-8001-${String(code.length).padStart(12, "0")}`,
    ));

    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code,
        nextAction: "Repair or replace the theme package.",
      },
    });
  });

  it.each([
    "THEME_HOME_WELCOME_UNSUPPORTED",
    "THEME_REQUIRED_LAYER_UNRESOLVED",
  ] as const)("recommends returning to a supported surface for %s", async (code) => {
    const fixture = await createRuntimeControllerFixture({ applyError: code });
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);
    const result = await dispatcher.dispatch(launchRequest(
      `00000000-0000-4000-8002-${String(code.length).padStart(12, "0")}`,
    ));

    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code,
        nextAction: "Return to a supported ChatGPT/Codex home surface or restore the previous theme.",
      },
    });
  });

  it("explains a window activation failure without suggesting a new request ID", async () => {
    const fixture = await createRuntimeControllerFixture();
    fixture.activateWindow.mockRejectedValueOnce(new RuntimeError(
      "CODEX_WINDOW_ACTIVATION_FAILED",
      "private process detail",
    ));
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);

    const result = await dispatcher.dispatch(launchRequest(
      "00000000-0000-4000-8000-000000000017",
    ));

    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code: "CODEX_WINDOW_ACTIVATION_FAILED",
        message: "Codex window activation could not be verified safely.",
        nextAction: expect.stringContaining("CODEX_WINDOW_ACTIVATION_FAILED"),
      },
    });
    expect(JSON.stringify(result.response)).not.toContain("request ID");
    expect(JSON.stringify(result.response)).not.toContain("private process detail");
  });

  it("explains a process-inspection denial with a stable support code", async () => {
    const fixture = await createRuntimeControllerFixture();
    fixture.launchManaged.mockRejectedValueOnce(new RuntimeError(
      "PROCESS_INSPECTION_DENIED",
      "private process-table detail",
    ));
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);

    const result = await dispatcher.dispatch(launchRequest(
      "00000000-0000-4000-8000-000000000018",
    ));

    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code: "PROCESS_INSPECTION_DENIED",
        message: "Codex process identity could not be inspected safely.",
        nextAction: expect.stringContaining("PROCESS_INSPECTION_DENIED"),
      },
    });
    expect(JSON.stringify(result.response)).not.toContain("request ID");
    expect(JSON.stringify(result.response)).not.toContain("private process-table detail");
  });

  it("maps response-record persistence failures to a stable response", async () => {
    const fixture = await createRuntimeControllerFixture({
      failAppendRecentRequest: "RUNTIME_SESSION_STALE",
    });
    const dispatcher = new RuntimeControlDispatcher(fixture.controller, fixture.state);

    await expect(dispatcher.dispatch(statusRequest()))
      .resolves.toMatchObject({
        response: { ok: false, error: { code: "RUNTIME_SESSION_STALE" } },
      });
  });
});
