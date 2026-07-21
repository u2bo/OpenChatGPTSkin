import { describe, expect, it, vi } from "vitest";
import {
  applyProductionRuntimeTheme,
  mapRuntimeControlResult,
  mapRuntimeStatus,
  restoreProductionRuntimeTheme,
} from "@open-chatgpt-skin/theme-studio-service";
import type { RuntimeStatusView } from "@open-chatgpt-skin/windows-runtime";

describe("Theme Studio Runtime projection", () => {
  it.each([
    "stopped",
    "launching",
    "active",
    "paused",
    "paused-incompatible",
    "recovery-required",
    "restoring",
    "restored-awaiting-exit",
    "restored-cleanup-required",
  ] as const)("maps %s without process details", (status) => {
    const source: RuntimeStatusView = {
      status,
      controllerAvailable: status !== "stopped",
      selectedTheme: status === "stopped"
        ? null
        : { id: "mountain-mist", version: "1.0.0" },
      appliedTheme: status === "active"
        ? { id: "mountain-mist", version: "1.0.0" }
        : null,
      skinApplied: status === "active"
        ? true
        : status === "recovery-required"
          ? null
          : false,
      packageVersion: null,
      operation: null,
      nextAction: "Structured next action.",
    };

    expect(mapRuntimeStatus(source)).toEqual(source);
    expect(JSON.stringify(mapRuntimeStatus(source))).not.toMatch(/pid|port|path|websocket/i);
  });

  it("unwraps a successful Runtime controller response", () => {
    expect(mapRuntimeControlResult({
      protocolVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000000",
      ok: true,
      result: {
        status: "stopped",
        controllerAvailable: false,
        selectedTheme: null,
        appliedTheme: null,
        skinApplied: false,
        packageVersion: null,
        operation: null,
        nextAction: "Launch one of the built-in themes.",
      },
    })).toMatchObject({ status: "stopped" });
  });

  it("converts Runtime controller failures to a stable Studio error", () => {
    expect(() => mapRuntimeControlResult({
      protocolVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000000",
      ok: false,
      error: {
        code: "RUNTIME_CONTROL_UNAVAILABLE",
        message: "Internal Runtime detail",
        nextAction: "Start the managed Runtime.",
      },
    })).toThrow(expect.objectContaining({
      code: "RUNTIME_STATUS_UNAVAILABLE",
      nextAction: "Start the managed Runtime.",
    }));
  });

  it("resumes a paused Runtime and confirms the exact applied version", async () => {
    const ref = { id: "my-theme", version: "1.2.3" };
    const paused = mapRuntimeStatus({
      status: "paused",
      controllerAvailable: true,
      selectedTheme: { id: "mountain-mist", version: "1.0.0" },
      appliedTheme: null,
      skinApplied: false,
      packageVersion: "26.707.12708.0",
      operation: null,
      nextAction: "Resume the managed Runtime.",
    });
    const execute = vi.fn()
      .mockResolvedValueOnce({
        ...paused,
        selectedTheme: ref,
      })
      .mockResolvedValueOnce({
        ...paused,
        status: "active",
        selectedTheme: ref,
        appliedTheme: ref,
        skinApplied: true,
      });

    await expect(applyProductionRuntimeTheme(ref, {
      readStatus: async () => paused,
      execute,
    })).resolves.toMatchObject({
      status: "active",
      appliedTheme: ref,
      skinApplied: true,
    });
    expect(execute).toHaveBeenNthCalledWith(1, {
      kind: "switch",
      themeId: ref.id,
      themeVersion: ref.version,
    });
    expect(execute).toHaveBeenNthCalledWith(2, { kind: "resume" });
  });

  it("restores the official Codex appearance through the Runtime controller", async () => {
    const active = mapRuntimeStatus({
      status: "active",
      controllerAvailable: true,
      selectedTheme: { id: "mountain-mist", version: "1.0.0" },
      appliedTheme: { id: "mountain-mist", version: "1.0.0" },
      skinApplied: true,
      packageVersion: "26.715.2305.0",
      operation: null,
      nextAction: "Theme is active.",
    });
    const restored = {
      ...active,
      status: "restored-awaiting-exit" as const,
      appliedTheme: null,
      skinApplied: false,
      nextAction: "Quit Codex normally to finish restoring.",
    };
    const execute = vi.fn(async () => restored);

    await expect(restoreProductionRuntimeTheme({
      readStatus: async () => active,
      execute,
    })).resolves.toEqual(restored);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ kind: "restore" });
  });
});
