import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TrustedInstallStore,
  RuntimeError,
  activateManagedCodexWindow,
  createRuntimePaths,
  launchManagedCodex,
  waitForManagedPort,
  type WindowsRuntimeProvider,
} from "@open-chatgpt-skin/windows-runtime";

const inspection = {
  packageRoot: "C:/Program Files/WindowsApps/OpenAI.Codex_26.707.9981.0_x64__2p2nqsd0c76g0",
  entryPath: "C:/Program Files/WindowsApps/OpenAI.Codex_26.707.9981.0_x64__2p2nqsd0c76g0/app/ChatGPT.exe",
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
};

function provider(running: boolean): WindowsRuntimeProvider {
  return {
    listCodexRoots: vi.fn(async () => running ? [{
      pid: 100,
      parentPid: 1,
      startedAt: "2026-07-16T00:00:00.000Z",
      executablePath: inspection.entryPath,
    }] : []),
    currentUserPackageRoots: vi.fn(async () => running ? [] : [inspection.packageRoot]),
    inspectInstall: vi.fn(async () => inspection),
    inspectPort: vi.fn(async () => null),
    activateCodexApplication: vi.fn(async () => {}),
    inspectManagedWindows: vi.fn(async () => ({
      rootExists: true,
      visibleWindowCount: 1,
      activationReady: true,
    })),
    launch: vi.fn(async (executablePath) => ({
      pid: 200,
      parentPid: 1,
      startedAt: "2026-07-16T00:00:01.000Z",
      executablePath,
    })),
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

describe("launchManagedCodex", () => {
  it("caches but refuses a normal running Codex", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-launcher-")),
      "D:/install",
    );
    const system = provider(true);

    await expect(launchManagedCodex({
      provider: system,
      cache: new TrustedInstallStore(paths.installCache),
      allocatePort: async () => 55123,
    })).rejects.toMatchObject({ code: "CODEX_ALREADY_RUNNING_UNMANAGED" });
    expect(system.launch).not.toHaveBeenCalled();
  });

  it("launches the revalidated entry with loopback-only CDP arguments", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-launcher-")),
      "D:/install",
    );
    const system = provider(false);
    const receipt = await launchManagedCodex({
      provider: system,
      cache: new TrustedInstallStore(paths.installCache),
      allocatePort: async () => 55123,
    });

    expect(system.launch).toHaveBeenCalledWith(
      expect.stringMatching(/app[\\/]ChatGPT\.exe$/),
      ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=55123"],
    );
    expect(receipt.cdp).toEqual({ host: "127.0.0.1", port: 55123 });
  });

  it("verifies CDP ownership after the directly launched window settles", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-launcher-")),
      "D:/install",
    );
    const system = provider(false);
    const receipt = await launchManagedCodex({
      provider: system,
      cache: new TrustedInstallStore(paths.installCache),
      allocatePort: async () => 55123,
    });
    vi.mocked(system.inspectPort).mockResolvedValue({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 201,
      ancestors: [201, receipt.root.pid],
    });
    vi.mocked(system.listCodexRoots).mockResolvedValue([receipt.root]);
    vi.mocked(system.inspectManagedWindows)
      .mockResolvedValueOnce({
        rootExists: true,
        visibleWindowCount: 0,
        activationReady: false,
      })
      .mockResolvedValue({
        rootExists: true,
        visibleWindowCount: 1,
        activationReady: true,
      });

    await waitForManagedPort(system, receipt, { timeoutMs: 50, intervalMs: 1 });
    await activateManagedCodexWindow(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    });

    expect(system.activateCodexApplication).not.toHaveBeenCalled();
    expect(system.launch).toHaveBeenCalledOnce();
    expect(system.inspectPort).toHaveBeenCalledTimes(2);
  });

  it("waits for a managed window that becomes visible after 15 seconds by default", async () => {
    vi.useFakeTimers();
    try {
      const system = provider(false);
      const receipt = {
        install: inspection,
        root: {
          pid: 200,
          parentPid: 1,
          startedAt: "2026-07-16T00:00:01.000Z",
          executablePath: inspection.entryPath,
        },
        cdp: { host: "127.0.0.1" as const, port: 55123 },
        launchedAt: "2026-07-16T00:00:01.000Z",
      };
      let windowChecks = 0;
      vi.mocked(system.listCodexRoots).mockResolvedValue([receipt.root]);
      vi.mocked(system.inspectManagedWindows).mockImplementation(async () => {
        windowChecks += 1;
        return {
          rootExists: true,
          visibleWindowCount: windowChecks >= 151 ? 1 : 0,
          activationReady: windowChecks >= 151,
        };
      });
      vi.mocked(system.inspectPort).mockResolvedValue({
        host: "127.0.0.1",
        port: 55123,
        owningPid: 201,
        ancestors: [201, receipt.root.pid],
      });

      const activation = activateManagedCodexWindow(system, receipt).then(
        () => "success",
        () => "error",
      );
      await vi.advanceTimersByTimeAsync(15_100);

      await expect(activation).resolves.toBe("success");
      expect(system.activateCodexApplication).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips AUMID activation when the launched window and CDP ownership are already ready", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    const duplicateRoot = {
      ...receipt.root,
      pid: 300,
      startedAt: "2026-07-16T00:00:02.000Z",
    };
    let activated = false;
    vi.mocked(system.activateCodexApplication).mockImplementation(async () => {
      activated = true;
    });
    vi.mocked(system.listCodexRoots).mockImplementation(async () =>
      activated ? [receipt.root, duplicateRoot] : [receipt.root]
    );
    vi.mocked(system.inspectManagedWindows).mockResolvedValue({
      rootExists: true,
      visibleWindowCount: 1,
      activationReady: true,
    });
    vi.mocked(system.inspectPort).mockResolvedValue({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 201,
      ancestors: [201, receipt.root.pid],
    });

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 20,
      intervalMs: 1,
    })).resolves.toBe(receipt);
    expect(system.activateCodexApplication).not.toHaveBeenCalled();
  });

  it("lets the directly launched window settle before attempting AUMID activation", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    const duplicateRoot = {
      ...receipt.root,
      pid: 300,
      startedAt: "2026-07-16T00:00:02.000Z",
    };
    let activated = false;
    let windowChecks = 0;
    vi.mocked(system.activateCodexApplication).mockImplementation(async () => {
      activated = true;
    });
    vi.mocked(system.listCodexRoots).mockImplementation(async () =>
      activated ? [receipt.root, duplicateRoot] : [receipt.root]
    );
    vi.mocked(system.inspectManagedWindows).mockImplementation(async () => {
      windowChecks += 1;
      return {
        rootExists: true,
        visibleWindowCount: windowChecks >= 2 ? 1 : 0,
        activationReady: windowChecks >= 2,
      };
    });
    vi.mocked(system.inspectPort).mockResolvedValue({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 201,
      ancestors: [201, receipt.root.pid],
    });

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 20,
      intervalMs: 1,
    })).resolves.toBe(receipt);
    expect(system.activateCodexApplication).not.toHaveBeenCalled();
    expect(system.inspectManagedWindows).toHaveBeenCalledTimes(2);
  });

  it("retries a transient port-inspection denial before connecting", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-launcher-")),
      "D:/install",
    );
    const system = provider(false);
    const receipt = await launchManagedCodex({
      provider: system,
      cache: new TrustedInstallStore(paths.installCache),
      allocatePort: async () => 55123,
    });
    vi.mocked(system.inspectPort)
      .mockRejectedValueOnce(
        new RuntimeError("PROCESS_INSPECTION_DENIED", "listener table is changing"),
      )
      .mockResolvedValueOnce({
        host: "127.0.0.1",
        port: 55123,
        owningPid: 201,
        ancestors: [201, receipt.root.pid],
      });

    await expect(waitForManagedPort(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    })).resolves.toMatchObject({ port: 55123 });
    expect(system.inspectPort).toHaveBeenCalledTimes(2);
  });

  it("retries a transient root-inspection denial during AUMID activation", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    vi.mocked(system.listCodexRoots)
      .mockRejectedValueOnce(
        new RuntimeError("PROCESS_INSPECTION_DENIED", "process table is changing"),
      )
      .mockResolvedValue([receipt.root]);
    vi.mocked(system.inspectPort).mockResolvedValue({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 201,
      ancestors: [201, receipt.root.pid],
    });

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    })).resolves.toBe(receipt);
    expect(system.listCodexRoots).toHaveBeenCalledTimes(2);
  });

  it("retries a transient window-inspection denial during AUMID activation", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    vi.mocked(system.listCodexRoots).mockResolvedValue([receipt.root]);
    vi.mocked(system.inspectManagedWindows)
      .mockRejectedValueOnce(
        new RuntimeError("PROCESS_INSPECTION_DENIED", "window table is changing"),
      )
      .mockResolvedValue({ rootExists: true, visibleWindowCount: 1, activationReady: true });
    vi.mocked(system.inspectPort).mockResolvedValue({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 201,
      ancestors: [201, receipt.root.pid],
    });

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    })).resolves.toBe(receipt);
    expect(system.inspectManagedWindows).toHaveBeenCalledTimes(2);
  });

  it("preserves a persistent root-inspection denial after bounded activation retries", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    vi.mocked(system.listCodexRoots).mockRejectedValue(
      new RuntimeError("PROCESS_INSPECTION_DENIED", "process table remains unavailable"),
    );

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 20,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "PROCESS_INSPECTION_DENIED" });
    expect(vi.mocked(system.listCodexRoots).mock.calls.length).toBeGreaterThan(1);
  });

  it("preserves a persistent port-inspection denial after bounded retries", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    vi.mocked(system.inspectPort).mockRejectedValue(
      new RuntimeError("PROCESS_INSPECTION_DENIED", "listener table remains unavailable"),
    );

    await expect(waitForManagedPort(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "PROCESS_INSPECTION_DENIED" });
    expect(vi.mocked(system.inspectPort).mock.calls.length).toBeGreaterThan(1);
  });

  it("fails closed when AUMID activation changes CDP ownership", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-launcher-")),
      "D:/install",
    );
    const system = provider(false);
    const receipt = await launchManagedCodex({
      provider: system,
      cache: new TrustedInstallStore(paths.installCache),
      allocatePort: async () => 55123,
    });
    vi.mocked(system.inspectPort)
      .mockResolvedValueOnce({
        host: "127.0.0.1",
        port: 55123,
        owningPid: 201,
        ancestors: [201, receipt.root.pid],
      })
      .mockResolvedValueOnce({
        host: "127.0.0.1",
        port: 55123,
        owningPid: 301,
        ancestors: [301],
      });
    let activated = false;
    vi.mocked(system.activateCodexApplication).mockImplementation(async () => {
      activated = true;
    });
    vi.mocked(system.listCodexRoots).mockResolvedValue([receipt.root]);
    vi.mocked(system.inspectManagedWindows).mockImplementation(async () =>
      activated ? {
        rootExists: true,
        visibleWindowCount: 1,
        activationReady: true,
      } : {
        rootExists: true,
        visibleWindowCount: 0,
        activationReady: false,
      }
    );

    await waitForManagedPort(system, receipt, { timeoutMs: 50, intervalMs: 1 });
    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "CDP_PROCESS_MISMATCH" });
    expect(system.activateCodexApplication).toHaveBeenCalledOnce();
    expect(system.inspectPort).toHaveBeenCalledTimes(2);
  });

  it("rejects AUMID activation when a second root appears", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    vi.mocked(system.listCodexRoots).mockResolvedValue([
      receipt.root,
      { ...receipt.root, pid: 300, startedAt: "2026-07-16T00:00:02.000Z" },
    ]);

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 20,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "CODEX_WINDOW_ACTIVATION_FAILED" });
  });

  it("rejects an activation root outside the verified launch trust window", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    vi.mocked(system.listCodexRoots).mockResolvedValue([{
      ...receipt.root,
      pid: 300,
      startedAt: "2026-07-15T23:59:00.000Z",
    }]);

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 20,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "CODEX_WINDOW_ACTIVATION_FAILED" });
    expect(system.inspectManagedWindows).not.toHaveBeenCalled();
  });

  it("waits for a trusted transient AUMID root to exit", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    const transientRoot = {
      ...receipt.root,
      pid: 300,
      startedAt: "2026-07-16T00:00:02.000Z",
    };
    vi.mocked(system.listCodexRoots)
      .mockResolvedValueOnce([receipt.root, transientRoot])
      .mockResolvedValue([receipt.root]);
    vi.mocked(system.inspectPort).mockResolvedValue({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 201,
      ancestors: [201, receipt.root.pid],
    });

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    })).resolves.toMatchObject({ root: receipt.root });
    expect(system.inspectManagedWindows).toHaveBeenCalledWith(
      receipt.root.pid,
      receipt.root.startedAt,
    );
  });

  it("adopts a trusted replacement root after AUMID activation transfers ownership", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    const replacementRoot = {
      ...receipt.root,
      pid: 300,
      startedAt: "2026-07-16T00:00:02.000Z",
    };
    vi.mocked(system.listCodexRoots)
      .mockResolvedValueOnce([receipt.root, replacementRoot])
      .mockResolvedValue([replacementRoot]);
    vi.mocked(system.inspectPort).mockResolvedValue({
      host: "127.0.0.1",
      port: 55123,
      owningPid: 301,
      ancestors: [301, replacementRoot.pid],
    });

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 50,
      intervalMs: 1,
    })).resolves.toMatchObject({ root: replacementRoot });
    expect(system.inspectManagedWindows).toHaveBeenCalledWith(
      replacementRoot.pid,
      replacementRoot.startedAt,
    );
  });

  it("fails closed when the managed root never exposes a visible window", async () => {
    const system = provider(false);
    const receipt = {
      install: inspection,
      root: {
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-16T00:00:01.000Z",
        executablePath: inspection.entryPath,
      },
      cdp: { host: "127.0.0.1" as const, port: 55123 },
      launchedAt: "2026-07-16T00:00:01.000Z",
    };
    vi.mocked(system.listCodexRoots).mockResolvedValue([receipt.root]);
    vi.mocked(system.inspectManagedWindows).mockResolvedValue({
      rootExists: true,
      visibleWindowCount: 0,
      activationReady: false,
    });

    await expect(activateManagedCodexWindow(system, receipt, {
      timeoutMs: 5,
      intervalMs: 1,
    })).rejects.toMatchObject({ code: "CODEX_WINDOW_ACTIVATION_FAILED" });
  });
});
