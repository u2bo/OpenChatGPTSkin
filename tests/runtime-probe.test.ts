import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PendingProbeStore,
  RuntimeError,
  RuntimeStateStore,
  createRuntimePaths,
  finalizeProbe,
  parseProbeArguments,
  runProbePhaseOne,
  type ProbePhaseOneDependencies,
  type WindowsRuntimeProvider,
} from "@open-chatgpt-skin/windows-runtime";

const receipt = {
  install: {
    packageRoot: "C:/Program Files/WindowsApps/OpenAI.Codex",
    entryPath: "C:/Program Files/WindowsApps/OpenAI.Codex/app/ChatGPT.exe",
    identityName: "OpenAI.Codex",
    packageVersion: "26.707.9981.0",
    packagePublisher: "CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B",
    appId: "App",
    entryRelativePath: "app/ChatGPT.exe",
    entryPoint: "Windows.FullTrustApplication",
    packageSignatureStatus: "Valid",
    packageSignerCommonName: "50BDFD77-8903-4850-9FFE-6E8522F64D5B",
    catalogSignatureStatus: "Valid",
    catalogSignerCommonName: "50BDFD77-8903-4850-9FFE-6E8522F64D5B",
    entryBlockMapValid: true,
    resourceSignatureStatus: "Valid",
    resourceSignerCommonName: "OpenAI OpCo, LLC",
  },
  root: {
    pid: 200,
    parentPid: 1,
    startedAt: "2026-07-16T00:00:01.000Z",
    executablePath: "C:/Program Files/WindowsApps/OpenAI.Codex/app/ChatGPT.exe",
  },
  cdp: { host: "127.0.0.1" as const, port: 55123 },
  launchedAt: "2026-07-16T00:00:01.000Z",
};

function provider(): WindowsRuntimeProvider {
  return {
    listCodexRoots: vi.fn(async () => [receipt.root]),
    currentUserPackageRoots: vi.fn(async () => []),
    inspectInstall: vi.fn(async () => receipt.install),
    inspectPort: vi.fn(async () => null),
    activateCodexApplication: vi.fn(async () => {}),
    inspectManagedWindows: vi.fn(async () => ({
      rootExists: true,
      visibleWindowCount: 1,
      activationReady: true,
    })),
    launch: vi.fn(async () => receipt.root),
    waitForExit: vi.fn(async () => true),
    inspectProcessStartedAt: vi.fn(async () => "2026-07-17T00:00:00.000Z"),
    inspectRemoteDebuggingArguments: vi.fn(async () => ({
      hasRemoteDebuggingAddress: false,
      hasRemoteDebuggingPort: false,
    })),
    measureProcessCpuPercent: vi.fn(async () => 0.25),
    currentUserSid: vi.fn(async () => "S-1-5-21-test"),
    secureDirectory: vi.fn(async () => {}),
  };
}

async function fixture() {
  const paths = createRuntimePaths(
    await mkdtemp(join(tmpdir(), "ocs-probe-")),
    "D:/install",
  );
  const store = new PendingProbeStore(paths.pendingProbeFile);
  const pageClosed = vi.fn();
  const evaluate = async <T>(expression: string): Promise<T> => {
    if (expression === "window.location.href") return "app://-/index.html" as T;
    if (expression.includes("const visible")) {
      return { main: true, navigation: true, composer: true } as T;
    }
    if (expression.includes("--ocs-probe")) return true as T;
    return 0 as T;
  };
  const deps: ProbePhaseOneDependencies = {
    provider: provider(),
    sessionStore: store,
    securePendingDirectory: vi.fn(async () => {}),
    launch: vi.fn(async () => receipt),
    waitForPort: vi.fn(async () => ({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 201,
      ancestors: [201, 200],
    })),
    activateWindow: vi.fn(async (launchReceipt) => launchReceipt),
    waitForTarget: vi.fn(async () => ({
      id: "codex",
      type: "page",
      title: "Codex",
      url: "app://-/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1:55123/devtools/page/codex",
    })),
    connectPage: vi.fn(async () => ({ evaluate, close: pageClosed })),
    waitForAdapter: vi.fn(async (adapter) => adapter.probe()),
    now: vi.fn(() => "2026-07-16T00:00:02.000Z"),
    newSessionId: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
  };
  return { deps, store, pageClosed };
}

describe("phase-one compatibility probe", () => {
  it("does not launch Codex when pending-session storage cannot be secured", async () => {
    const test = await fixture();
    vi.mocked(test.deps.securePendingDirectory).mockRejectedValue(
      new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "pending directory unavailable"),
    );

    await expect(runProbePhaseOne(test.deps, true)).rejects.toMatchObject({
      code: "RUNTIME_ENVIRONMENT_INVALID",
    });
    expect(test.deps.launch).not.toHaveBeenCalled();
    await expect(test.store.read()).resolves.toBeNull();
  });

  it("records a passed pending session without closing Codex", async () => {
    const test = await fixture();

    await expect(runProbePhaseOne(test.deps, true)).resolves.toEqual({
      compatible: null,
      phase: "awaiting-exit",
      nextAction: expect.stringContaining("--finalize"),
    });
    await expect(test.store.read()).resolves.toMatchObject({
      status: "passed-awaiting-exit",
      recordEvidenceRequested: true,
    });
    expect(test.deps.activateWindow).toHaveBeenCalledOnce();
    expect(test.pageClosed).toHaveBeenCalledOnce();
  });

  it("records the final root adopted during AUMID activation", async () => {
    const test = await fixture();
    vi.mocked(test.deps.activateWindow).mockImplementationOnce(async (launchReceipt) => ({
      ...launchReceipt,
      root: {
        ...launchReceipt.root,
        pid: 300,
        startedAt: "2026-07-16T00:00:02.000Z",
      },
    }));

    await runProbePhaseOne(test.deps, true);

    await expect(test.store.read()).resolves.toMatchObject({
      status: "passed-awaiting-exit",
      root: {
        pid: 300,
        startedAt: "2026-07-16T00:00:02.000Z",
      },
    });
  });

  it("records a failed pending session after managed launch", async () => {
    const test = await fixture();
    vi.mocked(test.deps.activateWindow).mockRejectedValue(
      new RuntimeError("CODEX_WINDOW_ACTIVATION_FAILED", "window unavailable"),
    );

    await expect(runProbePhaseOne(test.deps, true))
      .rejects.toMatchObject({ code: "CODEX_WINDOW_ACTIVATION_FAILED" });
    await expect(test.store.read()).resolves.toMatchObject({
      status: "failed-awaiting-exit",
      failureCode: "CODEX_WINDOW_ACTIVATION_FAILED",
    });
  });

  it("requires finalize for a passed session whose root already exited", async () => {
    const test = await fixture();
    await runProbePhaseOne(test.deps, true);

    await expect(runProbePhaseOne(test.deps, true))
      .rejects.toMatchObject({ code: "PROBE_FINALIZE_REQUIRED" });
  });

  it("clears an exited failed session before starting a new probe", async () => {
    const test = await fixture();
    vi.mocked(test.deps.activateWindow).mockRejectedValueOnce(
      new RuntimeError("CODEX_WINDOW_ACTIVATION_FAILED", "window unavailable"),
    );
    await expect(runProbePhaseOne(test.deps, false)).rejects.toMatchObject({
      code: "CODEX_WINDOW_ACTIVATION_FAILED",
    });

    await expect(runProbePhaseOne(test.deps, false)).resolves.toMatchObject({
      phase: "awaiting-exit",
    });
    await expect(test.store.read()).resolves.toMatchObject({
      status: "passed-awaiting-exit",
    });
  });
});

describe("probe finalize", () => {
  it("rejects finalize while the exact root is active", async () => {
    const test = await fixture();
    await runProbePhaseOne(test.deps, true);
    const runtimePaths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );
    const dependencies = {
      provider: {
        ...test.deps.provider,
        waitForExit: vi.fn(async () => false),
      },
      sessionStore: test.store,
      runtimeStateStore: new RuntimeStateStore(runtimePaths.sessionFile),
      recordEvidence: vi.fn(async () => "unused"),
    };

    await expect(finalizeProbe(dependencies))
      .rejects.toMatchObject({ code: "PROBE_EXIT_PENDING" });
    await expect(test.store.read()).resolves.not.toBeNull();
  });

  it("records evidence only after exact exit and port closure", async () => {
    const test = await fixture();
    await runProbePhaseOne(test.deps, true);
    const runtimePaths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );
    const recorded = vi.fn(async () =>
      "docs/runtime-probes/codex-26.707.9981.0.json"
    );

    await expect(finalizeProbe({
      provider: {
        ...test.deps.provider,
        waitForExit: vi.fn(async () => true),
        inspectPort: vi.fn(async () => null),
      },
      sessionStore: test.store,
      runtimeStateStore: new RuntimeStateStore(runtimePaths.sessionFile),
      recordEvidence: recorded,
    })).resolves.toMatchObject({
      schemaVersion: 2,
      managedExitVerified: true,
      cdpClosedVerified: true,
    });
    expect(recorded).toHaveBeenCalledOnce();
    await expect(test.store.read()).resolves.toBeNull();
  });

  it("does not mistake an early v2 launch state for an active managed Codex identity", async () => {
    const test = await fixture();
    await runProbePhaseOne(test.deps, true);
    const runtimePaths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );
    const runtimeStateStore = new RuntimeStateStore(runtimePaths.sessionFile);
    await runtimeStateStore.write({
      schemaVersion: 2,
      sessionId: "00000000-0000-4000-8000-000000000002",
      status: "launching",
      runtime: { pid: 100, startedAt: "2026-07-17T00:00:00.000Z" },
      codex: null,
      cdp: null,
      adapter: null,
      selectedTheme: { id: "mountain-mist", version: "1.0.0" },
      appliedTheme: null,
      skinApplied: null,
      pendingOperation: null,
      recentRequests: [],
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    const recorded = vi.fn(async () => "unused");

    await expect(finalizeProbe({
      provider: {
        ...test.deps.provider,
        waitForExit: vi.fn(async () => true),
        inspectPort: vi.fn(async () => null),
      },
      sessionStore: test.store,
      runtimeStateStore,
      recordEvidence: recorded,
    })).resolves.toMatchObject({ schemaVersion: 2 });
    expect(recorded).toHaveBeenCalledOnce();
  });

  it("keeps pending state while the old CDP port still listens", async () => {
    const test = await fixture();
    await runProbePhaseOne(test.deps, true);
    const runtimePaths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );

    await expect(finalizeProbe({
      provider: {
        ...test.deps.provider,
        waitForExit: vi.fn(async () => true),
        inspectPort: vi.fn(async () => ({
          host: "127.0.0.1",
          port: 55123,
          owningPid: 201,
          ancestors: [201],
        })),
      },
      sessionStore: test.store,
      runtimeStateStore: new RuntimeStateStore(runtimePaths.sessionFile),
      recordEvidence: vi.fn(async () => "unused"),
    })).rejects.toMatchObject({ code: "PROBE_EXIT_PENDING" });
    await expect(test.store.read()).resolves.not.toBeNull();
  });

  it("does not write evidence when phase one did not request it", async () => {
    const test = await fixture();
    await runProbePhaseOne(test.deps, false);
    const runtimePaths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );
    const recordEvidence = vi.fn(async () => "unused");

    await finalizeProbe({
      provider: {
        ...test.deps.provider,
        waitForExit: vi.fn(async () => true),
        inspectPort: vi.fn(async () => null),
      },
      sessionStore: test.store,
      runtimeStateStore: new RuntimeStateStore(runtimePaths.sessionFile),
      recordEvidence,
    });

    expect(recordEvidence).not.toHaveBeenCalled();
  });

  it("clears a safely exited failed session without generating success evidence", async () => {
    const test = await fixture();
    vi.mocked(test.deps.activateWindow).mockRejectedValue(
      new RuntimeError("CODEX_WINDOW_ACTIVATION_FAILED", "window unavailable"),
    );
    await expect(runProbePhaseOne(test.deps, true)).rejects.toMatchObject({
      code: "CODEX_WINDOW_ACTIVATION_FAILED",
    });
    const runtimePaths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-runtime-")),
      "D:/install",
    );
    const recordEvidence = vi.fn(async () => "unused");

    await expect(finalizeProbe({
      provider: {
        ...test.deps.provider,
        waitForExit: vi.fn(async () => true),
        inspectPort: vi.fn(async () => null),
      },
      sessionStore: test.store,
      runtimeStateStore: new RuntimeStateStore(runtimePaths.sessionFile),
      recordEvidence,
    })).rejects.toMatchObject({ code: "CODEX_WINDOW_ACTIVATION_FAILED" });
    expect(recordEvidence).not.toHaveBeenCalled();
    await expect(test.store.read()).resolves.toBeNull();
  });
});

describe("probe command", () => {
  it("accepts only the fixed CLI forms", () => {
    expect(parseProbeArguments([])).toEqual({ mode: "start", recordEvidence: false });
    expect(parseProbeArguments(["--record-evidence"]))
      .toEqual({ mode: "start", recordEvidence: true });
    expect(parseProbeArguments(["--finalize"])).toEqual({ mode: "finalize" });
    expect(() => parseProbeArguments(["--record-evidence", "--finalize"]))
      .toThrowError(expect.objectContaining({ code: "RUNTIME_ENVIRONMENT_INVALID" }));
  });
});
