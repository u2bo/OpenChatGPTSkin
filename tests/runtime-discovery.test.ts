import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TrustedInstallStore,
  createRuntimePaths,
  discoverCodexInstall,
  type WindowsRuntimeProvider,
} from "@open-chatgpt-skin/windows-runtime";

const macOsInspection = {
  packageRoot: "/Applications/Codex.app",
  entryPath: "/Applications/Codex.app/Contents/MacOS/Codex",
  identityName: "OpenAI.Codex",
  packageVersion: "26.715.12143.0",
  packagePublisher: "2DC432GLL2",
  appId: "com.openai.codex",
  entryRelativePath: "Contents/MacOS/Codex",
  entryPoint: "macOS.Application",
  packageSignatureStatus: "Valid",
  packageSignerCommonName: "2DC432GLL2",
  catalogSignatureStatus: "Valid",
  catalogSignerCommonName: "Notarized Developer ID",
  entryBlockMapValid: true,
  resourceSignatureStatus: "Valid",
  resourceSignerCommonName: "OpenAI, L.L.C.",
};

const verifiedInspection = {
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

function provider(): WindowsRuntimeProvider {
  return {
    listCodexRoots: vi.fn(async () => [{
      pid: 100,
      parentPid: 1,
      startedAt: "2026-07-16T00:00:00.000Z",
      executablePath: verifiedInspection.entryPath,
    }]),
    currentUserPackageRoots: vi.fn(async () => []),
    inspectInstall: vi.fn(async () => verifiedInspection),
    inspectPort: vi.fn(async () => null),
    activateCodexApplication: vi.fn(async () => {}),
    inspectManagedWindows: vi.fn(async () => ({
      rootExists: true,
      visibleWindowCount: 1,
      activationReady: true,
    })),
    launch: vi.fn(async () => {
      throw new Error("not used");
    }),
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

describe("discoverCodexInstall", () => {
  it("discovers and caches the official macOS application bundle", async () => {
    const macProvider: WindowsRuntimeProvider = {
      ...provider(),
      platform: "darwin",
      listCodexRoots: vi.fn(async () => []),
      currentUserPackageRoots: vi.fn(async () => [macOsInspection.packageRoot]),
      inspectInstall: vi.fn(async () => macOsInspection),
      currentUserSid: vi.fn(async () => "uid:501"),
    };
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-macos-")),
      "D:/install",
    );
    const store = new TrustedInstallStore(paths.installCache);

    await expect(discoverCodexInstall(macProvider, store)).resolves.toMatchObject({
      source: "application",
      install: { entryPoint: "macOS.Application", packageVersion: "26.715.12143.0" },
    });
    await expect(store.read()).resolves.toMatchObject({
      packageRoot: "/Applications/Codex.app",
      packagePublisher: "2DC432GLL2",
    });
  });

  it("derives a macOS bundle root from a running executable and revalidates it", async () => {
    const macProvider: WindowsRuntimeProvider = {
      ...provider(),
      platform: "darwin",
      listCodexRoots: vi.fn(async () => [{
        pid: 200,
        parentPid: 1,
        startedAt: "2026-07-20T10:00:00.000Z",
        executablePath: macOsInspection.entryPath,
      }]),
      currentUserPackageRoots: vi.fn(async () => []),
      inspectInstall: vi.fn(async () => macOsInspection),
      currentUserSid: vi.fn(async () => "uid:501"),
    };
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-macos-running-")),
      "D:/install",
    );

    await expect(discoverCodexInstall(
      macProvider,
      new TrustedInstallStore(paths.installCache),
    )).resolves.toMatchObject({ source: "running", runningRoot: { pid: 200 } });
    expect(macProvider.inspectInstall).toHaveBeenCalledWith("/Applications/Codex.app");
  });

  it("verifies a running official host and writes a revalidated cache", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-")),
      "D:/install",
    );
    const store = new TrustedInstallStore(paths.installCache);
    const result = await discoverCodexInstall(provider(), store);
    expect(result.source).toBe("running");
    expect(result.runningRoot?.pid).toBe(100);
    expect((await store.read())?.packageVersion).toBe("26.707.9981.0");
  });

  it("fails closed when no running host, Appx record, or trusted cache exists", async () => {
    const empty = provider();
    vi.mocked(empty.listCodexRoots).mockResolvedValue([]);
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-")),
      "D:/install",
    );
    await expect(discoverCodexInstall(
      empty,
      new TrustedInstallStore(paths.installCache),
    )).rejects.toMatchObject({ code: "CODEX_DISCOVERY_REQUIRES_BOOTSTRAP" });
  });

  it("re-inspects a cached installation before accepting it", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-")),
      "D:/install",
    );
    const store = new TrustedInstallStore(paths.installCache);
    await discoverCodexInstall(provider(), store);

    const cachedOnly = provider();
    vi.mocked(cachedOnly.listCodexRoots).mockResolvedValue([]);
    const result = await discoverCodexInstall(cachedOnly, store);

    expect(result.source).toBe("cache");
    expect(cachedOnly.inspectInstall).toHaveBeenCalledWith(verifiedInspection.packageRoot);
  });

  it("prefers a current Appx registration over a stale trusted cache", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-")),
      "D:/install",
    );
    const store = new TrustedInstallStore(paths.installCache);
    await store.write(verifiedInspection);
    const current = {
      ...verifiedInspection,
      packageRoot: "C:/Program Files/WindowsApps/OpenAI.Codex_26.707.12708.0_x64__2p2nqsd0c76g0",
      entryPath: "C:/Program Files/WindowsApps/OpenAI.Codex_26.707.12708.0_x64__2p2nqsd0c76g0/app/ChatGPT.exe",
      packageVersion: "26.707.12708.0",
    };
    const appxOnly = provider();
    vi.mocked(appxOnly.listCodexRoots).mockResolvedValue([]);
    vi.mocked(appxOnly.currentUserPackageRoots).mockResolvedValue([current.packageRoot]);
    vi.mocked(appxOnly.inspectInstall).mockImplementation(async (root) => {
      if (root === current.packageRoot) return current;
      throw new Error("stale cache must not be inspected when Appx is current");
    });

    await expect(discoverCodexInstall(appxOnly, store)).resolves.toMatchObject({
      source: "appx",
      install: { packageVersion: "26.707.12708.0" },
    });
    expect(appxOnly.inspectInstall).toHaveBeenCalledTimes(1);
    await expect(store.read()).resolves.toMatchObject({
      packageVersion: "26.707.12708.0",
    });
  });

  it("rejects an unapproved Authenticode signer", async () => {
    const invalid = provider();
    vi.mocked(invalid.inspectInstall).mockResolvedValue({
      ...verifiedInspection,
      resourceSignerCommonName: "Untrusted Publisher",
    });
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-")),
      "D:/install",
    );

    await expect(discoverCodexInstall(
      invalid,
      new TrustedInstallStore(paths.installCache),
    )).rejects.toMatchObject({ code: "CODEX_IDENTITY_INVALID" });
  });

  it("rejects disagreement between running and Appx installation sources", async () => {
    const disagreeing = provider();
    vi.mocked(disagreeing.currentUserPackageRoots).mockResolvedValue(["D:/OtherCodex"]);
    vi.mocked(disagreeing.inspectInstall).mockImplementation(async (root) => root === "D:/OtherCodex"
      ? {
          ...verifiedInspection,
          packageRoot: "D:/OtherCodex",
          entryPath: "D:/OtherCodex/app/ChatGPT.exe",
        }
      : verifiedInspection);
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-discovery-")),
      "D:/install",
    );

    await expect(discoverCodexInstall(
      disagreeing,
      new TrustedInstallStore(paths.installCache),
    )).rejects.toMatchObject({ code: "CODEX_IDENTITY_INVALID" });
  });
});
