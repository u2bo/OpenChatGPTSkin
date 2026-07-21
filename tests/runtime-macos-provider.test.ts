import { describe, expect, it, vi } from "vitest";
import {
  MacOsRuntimeProvider,
  type CommandRequest,
  type CommandResult,
} from "@open-chatgpt-skin/windows-runtime";

const BUNDLE = "/Applications/Codex.app";
const ENTRY = "/Applications/Codex.app/Contents/MacOS/Codex";

function ok(stdout = "", stderr = ""): CommandResult {
  return { exitCode: 0, stdout, stderr };
}

function officialRunner(overrides: {
  readonly teamId?: string;
  readonly lsof?: string;
  readonly ps?: string;
} = {}) {
  const run = vi.fn(async (request: CommandRequest): Promise<CommandResult> => {
    if (request.executable === "/usr/bin/plutil") {
      const key = request.args[1];
      if (key === "CFBundleIdentifier") return ok("com.openai.codex\n");
      if (key === "CFBundleExecutable") return ok("Codex\n");
      if (key === "CFBundleVersion") return ok("26.715.12143\n");
    }
    if (request.executable === "/usr/bin/codesign" && request.args[0] === "--verify") {
      return ok();
    }
    if (request.executable === "/usr/bin/codesign" && request.args[0] === "-dv") {
      return ok("", [
        `Authority=Developer ID Application: OpenAI, L.L.C. (${overrides.teamId ?? "2DC432GLL2"})`,
        `TeamIdentifier=${overrides.teamId ?? "2DC432GLL2"}`,
      ].join("\n"));
    }
    if (request.executable === "/usr/sbin/spctl") {
      return ok("", `${BUNDLE}: accepted\nsource=Notarized Developer ID\n`);
    }
    if (request.executable === "/usr/sbin/lsof") return ok(overrides.lsof ?? "");
    if (request.executable === "/bin/ps") return ok(overrides.ps ?? "");
    if (request.executable === "/usr/bin/open") return ok();
    throw new Error(`unexpected command: ${request.executable} ${request.args.join(" ")}`);
  });
  return { run };
}

function providerWith(run: ReturnType<typeof officialRunner>["run"]): MacOsRuntimeProvider {
  return new MacOsRuntimeProvider({
    runner: { run },
    platform: "darwin",
    currentUid: 501,
    homeDirectory: "/Users/tester",
    dataRoot: "/Users/tester/Library/Application Support/OpenChatGPTSkin",
    inspectBundlePath: async () => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }),
  });
}

describe("MacOsRuntimeProvider", () => {
  it("finds only exact Codex bundle root commands", async () => {
    const runner = officialRunner({
      ps: [
        ` 200   1 Mon Jul 20 10:00:00 2026 ${ENTRY} --remote-debugging-port=9222`,
        " 300   1 Mon Jul 20 10:00:00 2026 /tmp/Codex --remote-debugging-port=9333",
      ].join("\n"),
    });
    const provider = providerWith(runner.run);

    await expect(provider.listCodexRoots()).resolves.toEqual([{
      pid: 200,
      parentPid: 1,
      startedAt: new Date("Mon Jul 20 10:00:00 2026").toISOString(),
      executablePath: ENTRY,
    }]);
  });

  it("maps an official signed and notarized Codex.app to the shared install contract", async () => {
    const runner = officialRunner();
    const provider = providerWith(runner.run);

    await expect(provider.inspectInstall(BUNDLE)).resolves.toEqual({
      packageRoot: BUNDLE,
      entryPath: ENTRY,
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
    });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: "/usr/bin/codesign",
      args: ["--verify", "--deep", "--strict", BUNDLE],
      shell: false,
    }));
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: "/usr/sbin/spctl",
      args: ["--assess", "--type", "execute", "--verbose=4", BUNDLE],
    }));
  });

  it("fails closed for a different Apple Team ID", async () => {
    const provider = providerWith(officialRunner({ teamId: "BADTEAM123" }).run);
    await expect(provider.inspectInstall(BUNDLE))
      .rejects.toMatchObject({ code: "CODEX_IDENTITY_INVALID" });
  });

  it("accepts only a single IPv4-loopback listener and traces its ancestors", async () => {
    const ps = [
      ` 200   1 Mon Jul 20 10:00:00 2026 ${ENTRY}`,
      " 201 200 Mon Jul 20 10:00:01 2026 /Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper",
    ].join("\n");
    const provider = providerWith(officialRunner({
      lsof: "p201\nn127.0.0.1:9222\n",
      ps,
    }).run);

    await expect(provider.inspectPort(9222)).resolves.toEqual({
      host: "127.0.0.1",
      port: 9222,
      owningPid: 201,
      ancestors: [201, 200, 1],
    });
  });

  it("rejects a CDP listener bound beyond IPv4 loopback", async () => {
    const provider = providerWith(officialRunner({
      lsof: "p201\nn*:9222\n",
    }).run);
    await expect(provider.inspectPort(9222))
      .rejects.toMatchObject({ code: "CDP_ENDPOINT_UNSAFE" });
  });

  it("checks remote-debugging flags only in the exact managed process tree", async () => {
    const ps = [
      ` 200   1 Mon Jul 20 10:00:00 2026 ${ENTRY}`,
      " 201 200 Mon Jul 20 10:00:01 2026 helper --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222",
      " 300   1 Mon Jul 20 10:00:01 2026 unrelated --remote-debugging-port=9333",
    ].join("\n");
    const provider = providerWith(officialRunner({ ps }).run);

    await expect(provider.inspectRemoteDebuggingArguments(
      200,
      new Date("Mon Jul 20 10:00:00 2026").toISOString(),
    )).resolves.toEqual({
      hasRemoteDebuggingAddress: true,
      hasRemoteDebuggingPort: true,
    });
  });

  it("uses bundle activation and a UID-scoped control identity", async () => {
    const runner = officialRunner();
    const provider = providerWith(runner.run);
    await provider.activateCodexApplication();
    await expect(provider.currentUserSid()).resolves.toBe("uid:501");
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: "/usr/bin/open",
      args: ["-b", "com.openai.codex"],
    }));
  });

  it("refuses nested Runtime permission targets before touching the filesystem", async () => {
    const provider = providerWith(officialRunner().run);
    await expect(provider.secureDirectory(
      "/Users/tester/Library/Application Support/OpenChatGPTSkin/runtime/nested",
    )).rejects.toMatchObject({ code: "RUNTIME_ENVIRONMENT_INVALID" });
  });

  it("launches Codex.app with fixed open arguments and waits for one new root", async () => {
    const runner = officialRunner();
    const provider = providerWith(runner.run);
    vi.spyOn(provider, "listCodexRoots").mockResolvedValue([{
      pid: 200,
      parentPid: 1,
      startedAt: new Date().toISOString(),
      executablePath: ENTRY,
    }]);
    await expect(provider.launch(ENTRY, [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9222",
    ])).resolves.toMatchObject({ pid: 200, executablePath: ENTRY });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      executable: "/usr/bin/open",
      args: [
        "-n",
        BUNDLE,
        "--args",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9222",
      ],
    }));
  });
});
