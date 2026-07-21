import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RuntimeSessionStateSchema,
  RuntimeStateStore,
  createRuntimePaths,
  transitionRuntimeState,
} from "@open-chatgpt-skin/windows-runtime";

function activeState() {
  return {
    schemaVersion: 2 as const,
    sessionId: "00000000-0000-4000-8000-000000000001",
    status: "active" as const,
    runtime: { pid: 100, startedAt: "2026-07-17T00:00:00.000Z" },
    codex: {
      rootPid: 200,
      startedAt: "2026-07-17T00:00:01.000Z",
      executablePath: "C:/Program Files/WindowsApps/OpenAI.Codex/app/ChatGPT.exe",
      packageRoot: "C:/Program Files/WindowsApps/OpenAI.Codex",
      packageVersion: "26.707.12708.0",
    },
    cdp: { host: "127.0.0.1" as const, port: 55123 },
    adapter: { id: "current-2026-07", version: 1 as const },
    selectedTheme: { id: "mountain-mist" as const, version: "1.0.0" },
    appliedTheme: { id: "mountain-mist" as const, version: "1.0.0" },
    skinApplied: true as const,
    pendingOperation: null,
    recentRequests: [],
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:02.000Z",
  };
}

function recentRequest(index: number, command: "launch" | "status" | "switch" = "status") {
  const requestId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    requestId,
    command,
    response: {
      protocolVersion: 1 as const,
      requestId,
      ok: true as const,
      result: {
        status: "active" as const,
        controllerAvailable: true,
        selectedTheme: { id: "mountain-mist" as const, version: "1.0.0" },
        appliedTheme: { id: "mountain-mist" as const, version: "1.0.0" },
        skinApplied: true,
        packageVersion: "26.707.12708.0",
        operation: null,
        nextAction: "Theme is active.",
      },
    },
    completedAt: "2026-07-17T00:00:03.000Z",
  };
}

describe("RuntimeStateStore", () => {
  it("atomically persists schema v2 and clears a validated session", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );
    const store = new RuntimeStateStore(paths.sessionFile);

    await store.write(activeState());

    expect((await store.read())?.schemaVersion).toBe(2);
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("rejects schema v1 instead of treating it as a current Runtime session", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-runtime-"));
    const paths = createRuntimePaths(root, "D:/install");
    await mkdir(paths.runtimeDirectory, { recursive: true });
    await writeFile(paths.sessionFile, JSON.stringify({
      ...activeState(),
      schemaVersion: 1,
    }));

    await expect(new RuntimeStateStore(paths.sessionFile).read())
      .rejects.toMatchObject({ code: "RUNTIME_SESSION_STALE" });
  });

  it("rejects corrupt session JSON instead of treating it as stopped", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-runtime-"));
    const paths = createRuntimePaths(root, "D:/install");
    await mkdir(paths.runtimeDirectory, { recursive: true });
    await writeFile(paths.sessionFile, "{}");

    await expect(new RuntimeStateStore(paths.sessionFile).read())
      .rejects.toMatchObject({ code: "RUNTIME_SESSION_STALE" });
  });
});

describe("RuntimeSessionStateSchema", () => {
  it("rejects states that would lie about the visible appearance", () => {
    expect(() => RuntimeSessionStateSchema.parse({
      ...activeState(),
      appliedTheme: { id: "glacier-aurora", version: "1.0.0" },
    })).toThrow();
    expect(() => RuntimeSessionStateSchema.parse({
      ...activeState(),
      status: "recovery-required",
      appliedTheme: null,
      skinApplied: false,
    })).toThrow();
  });

  it("permits recovery-required only with unknown appearance", () => {
    expect(RuntimeSessionStateSchema.parse({
      ...activeState(),
      status: "recovery-required",
      appliedTheme: null,
      skinApplied: null,
    }).skinApplied).toBeNull();
  });

  it("accepts only bounded, internally consistent response records", () => {
    expect(RuntimeSessionStateSchema.parse({
      ...activeState(),
      recentRequests: [recentRequest(2)],
    }).recentRequests).toHaveLength(1);
    expect(() => RuntimeSessionStateSchema.parse({
      ...activeState(),
      recentRequests: Array.from({ length: 33 }, (_, index) => recentRequest(index + 1)),
    })).toThrow();
    expect(() => RuntimeSessionStateSchema.parse({
      ...activeState(),
      recentRequests: [{
        ...recentRequest(2),
        response: { ...recentRequest(2).response, requestId: "00000000-0000-4000-8000-000000000003" },
      }],
    })).toThrow();
    expect(() => RuntimeSessionStateSchema.parse({
      ...activeState(),
      recentRequests: [recentRequest(2, "launch"), recentRequest(2, "switch")],
    })).toThrow();
  });
});

describe("RuntimeStateStore recent requests", () => {
  it("keeps the newest 32 completed responses after the Controller commits state", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );
    const store = new RuntimeStateStore(paths.sessionFile);
    await store.write(activeState());

    for (let index = 1; index <= 33; index += 1) {
      await store.appendRecentRequest(recentRequest(index));
    }

    const state = await store.read();
    expect(state?.recentRequests).toHaveLength(32);
    expect(state?.recentRequests[0]?.requestId).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(state?.recentRequests.at(-1)?.requestId).toBe(
      "00000000-0000-4000-8000-000000000033",
    );
  });
});

describe("transitionRuntimeState", () => {
  it("permits only declared Runtime status transitions", () => {
    const current = RuntimeSessionStateSchema.parse(activeState());
    const paused = RuntimeSessionStateSchema.parse({
      ...activeState(),
      status: "paused",
      appliedTheme: null,
      skinApplied: false,
    });
    const terminal = RuntimeSessionStateSchema.parse({
      ...activeState(),
      status: "restored-cleanup-required",
      appliedTheme: null,
      skinApplied: false,
    });

    expect(transitionRuntimeState(current, paused)).toEqual(paused);
    expect(() => transitionRuntimeState(current, terminal))
      .toThrowError(expect.objectContaining({ code: "RUNTIME_INVALID_STATE" }));
  });

  it("permits restoring to return to a positively verified active appearance", () => {
    const active = RuntimeSessionStateSchema.parse(activeState());
    const restoring = RuntimeSessionStateSchema.parse({
      ...activeState(),
      status: "restoring",
      pendingOperation: {
        kind: "restore",
        requestId: "00000000-0000-4000-8000-000000000003",
        startedAt: "2026-07-17T00:00:03.000Z",
        previousStatus: "active",
        previousSelectedTheme: active.selectedTheme,
        previousAppliedTheme: active.appliedTheme,
        candidateTheme: null,
      },
    });

    expect(transitionRuntimeState(restoring, active)).toEqual(active);
  });
});
