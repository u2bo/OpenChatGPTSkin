import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_SWITCH_EDGES,
  RUNTIME_BUILTIN_THEME_IDS,
  RuntimeAcceptanceEvidenceSchema,
  runRuntimeAcceptance,
  type ControlRequest,
  type ProcessIdentity,
  type RuntimeAcceptanceControlCommand,
  type RuntimeAcceptanceDependencies,
  type RuntimeBuiltinThemeId,
  type RuntimeStatusView,
} from "@open-chatgpt-skin/windows-runtime";

const timestamp = "2026-07-17T00:00:00.000Z";
const root: ProcessIdentity = {
  pid: 200,
  parentPid: 1,
  startedAt: timestamp,
  executablePath: "C:/Program Files/WindowsApps/OpenAI.Codex/ChatGPT.exe",
};

const normalRoot: ProcessIdentity = {
  ...root,
  pid: 201,
  startedAt: "2026-07-17T00:01:00.000Z",
};

function validAcceptanceEvidence() {
  return {
    schemaVersion: 1 as const,
    packageIdentity: "OpenAI.Codex" as const,
    packageVersion: "26.707.12708.0",
    runtimeVersion: "0.1.0",
    themes: RUNTIME_BUILTIN_THEME_IDS.map((id) => ({
      id,
      applied: true as const,
      verified: true as const,
    })),
    switches: ACCEPTANCE_SWITCH_EDGES.map(([from, to]) => ({
      from,
      to,
      verified: true as const,
    })),
    pauseVerified: true as const,
    pausedSwitchVerified: true as const,
    resumeVerified: true as const,
    restoreVerified: true as const,
    maxThemeOperationDurationMs: 500,
    idleCpuPercent: 0.25,
    managedExitVerified: true as const,
    cdpClosedVerified: true as const,
    normalLaunchNoDebugArguments: true as const,
  };
}

interface AcceptanceFixture {
  readonly dependencies: RuntimeAcceptanceDependencies;
  appliedThemeIds(): readonly RuntimeBuiltinThemeId[];
  switchEdges(): readonly (readonly [RuntimeBuiltinThemeId, RuntimeBuiltinThemeId])[];
  lastCommand(): ControlRequest["command"] | null;
}

function status(
  state: "active" | "paused" | "restored-awaiting-exit",
  selectedTheme: RuntimeBuiltinThemeId | null,
  appliedTheme: RuntimeBuiltinThemeId | null,
): RuntimeStatusView {
  return {
    status: state,
    controllerAvailable: state !== "restored-awaiting-exit",
    selectedTheme: selectedTheme ? { id: selectedTheme, version: "1.0.0" } : null,
    appliedTheme: appliedTheme ? { id: appliedTheme, version: "1.0.0" } : null,
    skinApplied: appliedTheme !== null,
    packageVersion: "26.707.12708.0",
    operation: null,
    nextAction: "Continue acceptance validation.",
  };
}

interface AcceptanceFixtureOptions {
  readonly managedExited?: boolean;
  readonly oldPortClosed?: boolean;
  readonly normalNoCdp?: boolean;
  readonly normalCodexRunning?: boolean;
}

function acceptanceFixture(options: AcceptanceFixtureOptions = {}): AcceptanceFixture {
  const appliedThemeIds: RuntimeBuiltinThemeId[] = [];
  const switchEdges: (readonly [RuntimeBuiltinThemeId, RuntimeBuiltinThemeId])[] = [];
  let command: ControlRequest["command"] | null = null;
  let selectedTheme: RuntimeBuiltinThemeId | null = null;
  let appliedTheme: RuntimeBuiltinThemeId | null = null;
  let state: "active" | "paused" | "restored-awaiting-exit" = "active";
  let tick = 0;
  let pending: unknown = null;

  const executeControl = async (
    request: RuntimeAcceptanceControlCommand,
  ): Promise<RuntimeStatusView> => {
    command = request.command;
    switch (request.command) {
      case "launch":
        selectedTheme = request.themeId;
        appliedTheme = request.themeId;
        state = "active";
        appliedThemeIds.push(request.themeId);
        break;
      case "switch":
        if (state === "active" && selectedTheme) {
          switchEdges.push([selectedTheme, request.themeId]);
        }
        selectedTheme = request.themeId;
        if (state === "active") {
          appliedTheme = request.themeId;
          appliedThemeIds.push(request.themeId);
        }
        break;
      case "pause":
        state = "paused";
        appliedTheme = null;
        break;
      case "resume":
        state = "active";
        appliedTheme = selectedTheme;
        if (selectedTheme) appliedThemeIds.push(selectedTheme);
        break;
      case "restore":
        state = "restored-awaiting-exit";
        appliedTheme = null;
        break;
      case "status":
        break;
    }
    return status(state, selectedTheme, appliedTheme);
  };

  const dependencies: RuntimeAcceptanceDependencies = {
    provider: {
      listCodexRoots: async () => options.normalCodexRunning ? [normalRoot] : [],
      waitForExit: async () => options.managedExited ?? false,
      inspectPort: async () => options.oldPortClosed ?? false ? null : {
        host: "127.0.0.1",
        port: 55123,
        owningPid: root.pid,
        ancestors: [root.pid],
      },
      inspectRemoteDebuggingArguments: async () => ({
        hasRemoteDebuggingAddress: !(options.normalNoCdp ?? false),
        hasRemoteDebuggingPort: !(options.normalNoCdp ?? false),
      }),
      measureProcessCpuPercent: async () => 0.25,
    },
    sessionStore: {
      read: async () => pending,
      write: async (value) => { pending = value; },
      clear: async () => { pending = null; },
    },
    readManagedSession: async () => ({
      runtime: { pid: 100, startedAt: timestamp },
      root: { pid: root.pid, startedAt: root.startedAt },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      packageVersion: "26.707.12708.0",
    }),
    securePendingDirectory: async () => {},
    executeControl,
    discoverNormalCodex: async () => ({
      install: { packageVersion: "26.707.12708.0" },
      root: normalRoot,
    }),
    recordEvidence: async () => "docs/runtime-acceptance/codex-26.707.12708.0.json",
    now: () => timestamp,
    performanceNow: () => {
      tick += 10;
      return tick;
    },
    newSessionId: () => "00000000-0000-4000-8000-000000000061",
    runtimeVersion: "0.1.0",
  };

  return {
    dependencies,
    appliedThemeIds: () => [...appliedThemeIds],
    switchEdges: () => [...switchEdges],
    lastCommand: () => command,
  };
}

describe("Runtime acceptance evidence", () => {
  it("rejects every privacy-sensitive extra field", () => {
    const evidence = validAcceptanceEvidence();
    expect(RuntimeAcceptanceEvidenceSchema.parse(evidence)).toEqual(evidence);
    for (const extra of [
      { pid: 1 }, { port: 9222 }, { username: "user" },
      { commandLine: "--remote-debugging-port=9222" },
      { webSocketUrl: "ws://127.0.0.1:9222/devtools" },
      { projectPath: "D:/secret" }, { screenshot: "base64" },
    ]) {
      expect(() => RuntimeAcceptanceEvidenceSchema.parse({ ...evidence, ...extra }))
        .toThrow();
    }
  });

  it("records all four themes and all 12 directed switch pairs", async () => {
    const fixture = acceptanceFixture();
    const result = await runRuntimeAcceptance({ kind: "begin" }, fixture.dependencies);

    expect(result.phase).toBe("awaiting-exit");
    expect(fixture.appliedThemeIds()).toEqual(expect.arrayContaining([
      "future-idol-cyan", "rose-carpet-star", "mountain-mist", "glacier-aurora",
    ]));
    expect(fixture.switchEdges()).toHaveLength(12);
    expect(fixture.lastCommand()).toBe("restore");
  });

  it("refuses begin while ordinary Codex is still running", async () => {
    const fixture = acceptanceFixture({ normalCodexRunning: true });

    await expect(runRuntimeAcceptance({ kind: "begin" }, fixture.dependencies))
      .rejects.toMatchObject({ code: "CODEX_ALREADY_RUNNING_UNMANAGED" });
  });

  it("finalizes only after managed exit, old-port closure, and normal no-CDP startup", async () => {
    const fixture = acceptanceFixture({
      managedExited: true,
      oldPortClosed: true,
      normalNoCdp: true,
    });
    await runRuntimeAcceptance({ kind: "begin" }, fixture.dependencies);

    await expect(runRuntimeAcceptance({ kind: "finalize" }, fixture.dependencies))
      .resolves.toMatchObject({ compatible: true });
  });

  it.each([
    ["the managed root is still running", {
      managedExited: false,
      oldPortClosed: true,
      normalNoCdp: true,
    }],
    ["the old CDP port remains open", {
      managedExited: true,
      oldPortClosed: false,
      normalNoCdp: true,
    }],
    ["normal Codex still has debugging arguments", {
      managedExited: true,
      oldPortClosed: true,
      normalNoCdp: false,
    }],
  ] as const)("rejects finalization when %s", async (_reason, options) => {
    const fixture = acceptanceFixture(options);
    await runRuntimeAcceptance({ kind: "begin" }, fixture.dependencies);

    await expect(runRuntimeAcceptance({ kind: "finalize" }, fixture.dependencies))
      .rejects.toMatchObject({ code: expect.any(String) });
  });
});
