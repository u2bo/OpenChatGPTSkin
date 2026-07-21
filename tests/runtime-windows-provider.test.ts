import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  PowerShellWindowsProvider,
  windowsPathsEqual,
} from "@open-chatgpt-skin/windows-runtime";
import { POWERSHELL_SCRIPT } from "../runtime/windows/src/windows/powershell-script.js";

const execFileAsync = promisify(execFile);
const POWERSHELL = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

function inspectionRequest(request: {
  readonly args: readonly string[];
  readonly stdin: string;
  readonly env?: Readonly<Record<string, string>>;
}): unknown {
  expect(request.args).toEqual([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "& ([scriptblock]::Create([Console]::In.ReadToEnd()))",
  ]);
  expect(request.stdin).toBe(POWERSHELL_SCRIPT);
  const requestJson = request.env?.OPEN_CHATGPT_SKIN_REQUEST_JSON;
  expect(requestJson).toBeTypeOf("string");
  return JSON.parse(requestJson!);
}

async function runAclPowerShell(script: string, path: string): Promise<string> {
  const result = await execFileAsync(
    POWERSHELL,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      timeout: 60_000,
      env: { ...process.env, OCS_TEST_ACL_PATH: path },
    },
  );
  return result.stdout.trim();
}

async function unboundLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: "127.0.0.1", port: 0 }, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not provide a TCP port");
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return address.port;
}

describe("PowerShellWindowsProvider", () => {
  it("compares Windows paths case-insensitively across slash styles", () => {
    expect(windowsPathsEqual(
      "C:/Program Files/WindowsApps/OpenAI.Codex/app/ChatGPT.exe",
      "c:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\ChatGPT.exe",
    )).toBe(true);
  });

  it("streams a fixed script without shell parsing or command-line payloads", async () => {
    const run = vi.fn(async (
      request: Parameters<typeof inspectionRequest>[0],
    ) => {
      expect(inspectionRequest(request)).toEqual({ action: "currentUserPackageRoots" });
      return { exitCode: 0, stdout: "[]", stderr: "" };
    });
    const provider = new PowerShellWindowsProvider({ run });

    await provider.currentUserPackageRoots();

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]).toMatchObject({
      executable: expect.stringMatching(/powershell\.exe$/i),
      shell: false,
    });
  });

  it("resets existing ACLs without requiring the SeSecurityPrivilege", () => {
    expect(POWERSHELL_SCRIPT).toContain("& icacls.exe $path /reset");
    expect(POWERSHELL_SCRIPT).toContain(
      "& icacls.exe $path /inheritance:r /grant:r $userGrant $systemGrant",
    );
    expect(POWERSHELL_SCRIPT).toContain("$verified = $directory.GetAccessControl()");
    expect(POWERSHELL_SCRIPT).not.toContain("Get-Acl -LiteralPath $path");
    expect(POWERSHELL_SCRIPT).not.toContain("Set-Acl -LiteralPath $path");
  });

  it("activates only the fixed official Codex AUMID", async () => {
    const run = vi.fn(async (request) => {
      expect(inspectionRequest(request)).toEqual({ action: "activateCodexApplication" });
      return { exitCode: 0, stdout: '{"activated":true}', stderr: "" };
    });
    const provider = new PowerShellWindowsProvider({ run });

    await provider.activateCodexApplication();

    expect(run).toHaveBeenCalledOnce();
  });

  it("maps AUMID failures to an activation error with a safe next action", async () => {
    const run = vi.fn(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "official Codex AUMID is unavailable",
    }));
    const provider = new PowerShellWindowsProvider({ run });

    await expect(provider.activateCodexApplication()).rejects.toMatchObject({
      code: "CODEX_WINDOW_ACTIVATION_FAILED",
      nextAction: expect.stringContaining("Start menu"),
    });
  });

  it("inspects visible windows for one exact managed root", async () => {
    const run = vi.fn(async (request) => {
      expect(inspectionRequest(request)).toEqual({
        action: "inspectManagedWindows",
        rootPid: 200,
        startedAt: "2026-07-16T00:00:01.000Z",
      });
      return {
        exitCode: 0,
        stdout: '{"rootExists":true,"visibleWindowCount":1}',
        stderr: "",
      };
    });
    const provider = new PowerShellWindowsProvider({ run });

    await expect(provider.inspectManagedWindows(
      200,
      "2026-07-16T00:00:01.000Z",
    )).resolves.toEqual({
      rootExists: true,
      visibleWindowCount: 1,
      activationReady: true,
    });
  });

  it("returns only the exact process start time for a positive PID", async () => {
    const run = vi.fn(async (request) => {
      expect(inspectionRequest(request)).toEqual({
        action: "inspectProcessStartedAt",
        pid: 200,
      });
      return { exitCode: 0, stdout: '"2026-07-17T00:00:00.000Z"', stderr: "" };
    });
    const provider = new PowerShellWindowsProvider({ run });

    await expect(provider.inspectProcessStartedAt(200))
      .resolves.toBe("2026-07-17T00:00:00.000Z");
    await expect(provider.inspectProcessStartedAt(0))
      .rejects.toMatchObject({ code: "RUNTIME_ENVIRONMENT_INVALID" });
  });

  it("reads the live Node process start time through the real streamed script", async () => {
    await expect(new PowerShellWindowsProvider().inspectProcessStartedAt(process.pid))
      .resolves.toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
  }, 60_000);

  it("enumerates live ChatGPT roots without requiring CIM process access", async () => {
    const roots = await new PowerShellWindowsProvider().listCodexRoots();

    for (const root of roots) {
      expect(root.pid).toBeGreaterThan(0);
      expect(root.parentPid).toBeGreaterThanOrEqual(0);
      expect(root.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
      expect(root.executablePath).toMatch(/\\ChatGPT\.exe$/i);
    }
  }, 60_000);

  it("avoids policy-sensitive full process-table CIM enumeration", () => {
    expect(POWERSHELL_SCRIPT).not.toContain("Get-CimInstance Win32_Process");
    expect(POWERSHELL_SCRIPT).toContain("CreateToolhelp32Snapshot");
    expect(POWERSHELL_SCRIPT).toContain("ProcessCommandLineInformation");
  });

  it("reads remote-debugging flags for the exact live Node process", async () => {
    const provider = new PowerShellWindowsProvider();
    const startedAt = await provider.inspectProcessStartedAt(process.pid);
    if (!startedAt) throw new Error("live Node process start time is unavailable");

    await expect(provider.inspectRemoteDebuggingArguments(process.pid, startedAt))
      .resolves.toEqual({
        hasRemoteDebuggingAddress: false,
        hasRemoteDebuggingPort: false,
      });
  }, 60_000);

  it("returns only boolean remote-debugging observations for one exact root", async () => {
    const run = vi.fn(async (request) => {
      expect(inspectionRequest(request)).toEqual({
        action: "inspectRemoteDebuggingArguments",
        rootPid: 200,
        startedAt: "2026-07-17T00:00:00.000Z",
      });
      return {
        exitCode: 0,
        stdout: '{"hasRemoteDebuggingAddress":false,"hasRemoteDebuggingPort":false}',
        stderr: "",
      };
    });
    const provider = new PowerShellWindowsProvider({ run });

    await expect(provider.inspectRemoteDebuggingArguments(
      200,
      "2026-07-17T00:00:00.000Z",
    )).resolves.toEqual({
      hasRemoteDebuggingAddress: false,
      hasRemoteDebuggingPort: false,
    });
  });

  it("uses whitespace regex boundaries for remote-debugging flags", () => {
    expect(POWERSHELL_SCRIPT).toContain(
      "(?i)(?:^|\\s)--remote-debugging-address(?:=|\\s|$)",
    );
    expect(POWERSHELL_SCRIPT).toContain(
      "(?i)(?:^|\\s)--remote-debugging-port(?:=|\\s|$)",
    );
    expect(POWERSHELL_SCRIPT).not.toContain(
      "(?i)(?:^|\\\\s)--remote-debugging-address",
    );
    expect(POWERSHELL_SCRIPT).not.toContain(
      "(?i)(?:^|\\\\s)--remote-debugging-port",
    );
  });

  it("samples exact-process CPU only within the bounded acceptance window", async () => {
    const run = vi.fn(async (request) => {
      expect(inspectionRequest(request)).toEqual({
        action: "measureProcessCpuPercent",
        rootPid: 200,
        startedAt: "2026-07-17T00:00:00.000Z",
        sampleMs: 2_000,
      });
      return { exitCode: 0, stdout: "0.25", stderr: "" };
    });
    const provider = new PowerShellWindowsProvider({ run });

    await expect(provider.measureProcessCpuPercent(
      200,
      "2026-07-17T00:00:00.000Z",
      2_000,
    )).resolves.toBe(0.25);
    await expect(provider.measureProcessCpuPercent(
      200,
      "2026-07-17T00:00:00.000Z",
      999,
    )).rejects.toMatchObject({ code: "RUNTIME_ENVIRONMENT_INVALID" });
  });

  it("returns null instead of failing when a loopback port is unbound", async () => {
    const port = await unboundLoopbackPort();

    await expect(new PowerShellWindowsProvider().inspectPort(port)).resolves.toBeNull();
  });

  it("removes pre-existing explicit ACL entries from pending-session storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-acl-"));
    const target = join(root, "runtime");
    await mkdir(target);
    try {
      await runAclPowerShell(`
        $ErrorActionPreference = "Stop"
        $directory = [System.IO.DirectoryInfo]::new($env:OCS_TEST_ACL_PATH)
        $acl = $directory.GetAccessControl()
        $users = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-545")
        $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
          [Security.AccessControl.InheritanceFlags]::ObjectInherit
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
          $users,
          [Security.AccessControl.FileSystemRights]::ReadAndExecute,
          $inheritance,
          [Security.AccessControl.PropagationFlags]::None,
          [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
        $directory.SetAccessControl($acl)
      `, target);

      const provider = new PowerShellWindowsProvider(undefined, root);
      await provider.secureDirectory(target);
      const currentUserSid = await provider.currentUserSid();
      const result = JSON.parse(await runAclPowerShell(`
        $directory = [System.IO.DirectoryInfo]::new($env:OCS_TEST_ACL_PATH)
        $acl = $directory.GetAccessControl()
        [pscustomobject]@{
          protected = $acl.AreAccessRulesProtected
          identities = @($acl.Access | ForEach-Object {
            $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
          } | Sort-Object -Unique)
        } | ConvertTo-Json -Compress
      `, target)) as { protected: boolean; identities: string[] };

      expect(result.protected).toBe(true);
      expect(result.identities).toEqual(
        expect.arrayContaining([currentUserSid, "S-1-5-18"]),
      );
      expect(result.identities).not.toContain("S-1-5-32-545");
      expect(result.identities).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
