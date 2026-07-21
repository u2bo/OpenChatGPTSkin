import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  runRuntimeAcceptance,
  type RuntimeAcceptanceCommand,
  type RuntimeAcceptanceControlCommand,
  type RuntimeAcceptanceDependencies,
} from "./acceptance-runner.js";
import { recordRuntimeAcceptanceEvidence } from "./acceptance-evidence.js";
import { PendingAcceptanceStore } from "./acceptance-session.js";
import {
  createProductionRuntimeCliDependencies,
  RUNTIME_VERSION,
} from "./controller/production.js";
import { executeRuntimeControlCommand, type RuntimeControlCliCommand } from "./cli/run.js";
import { TrustedInstallStore } from "./discovery/trusted-cache.js";
import { discoverCodexInstall } from "./discovery/discover.js";
import { RuntimeError, runtimeErrorCode } from "./errors.js";
import { createProductionRuntimePaths, prepareProductionRuntimePaths } from "./paths.js";
import { RuntimeStateStore } from "./state.js";
import { PowerShellWindowsProvider } from "./windows/powershell-provider.js";
import type { RuntimeStatusView } from "./control/protocol.js";

function parseAcceptanceArguments(args: readonly string[]): RuntimeAcceptanceCommand {
  if (args.length === 1 && args[0] === "--begin") return { kind: "begin" };
  if (args.length === 1 && args[0] === "--finalize") return { kind: "finalize" };
  throw new RuntimeError(
    "RUNTIME_ENVIRONMENT_INVALID",
    "runtime:acceptance accepts only --begin or --finalize",
  );
}

function cliCommand(command: RuntimeAcceptanceControlCommand): RuntimeControlCliCommand {
  switch (command.command) {
    case "launch":
      return { kind: "launch", themeId: command.themeId };
    case "switch":
      return { kind: "switch", themeId: command.themeId };
    case "pause":
      return { kind: "pause" };
    case "resume":
      return { kind: "resume" };
    case "restore":
      return { kind: "restore" };
    case "status":
      return { kind: "status" };
  }
}

function statusFromControlResult(value: Awaited<ReturnType<typeof executeRuntimeControlCommand>>): RuntimeStatusView {
  if (!("protocolVersion" in value)) return value;
  if (!value.ok) {
    throw new RuntimeError(value.error.code, "Runtime acceptance control command failed");
  }
  return value.result;
}

function productionDependencies(): RuntimeAcceptanceDependencies {
  const paths = createProductionRuntimePaths();
  const provider = new PowerShellWindowsProvider(undefined, paths.dataRoot);
  const runtimeState = new RuntimeStateStore(paths.sessionFile);
  const acceptanceStore = new PendingAcceptanceStore(paths.acceptanceSessionFile);
  const cache = new TrustedInstallStore(paths.installCache);
  const runtimeCli = createProductionRuntimeCliDependencies();
  return {
    provider,
    sessionStore: acceptanceStore,
    readManagedSession: async () => {
      const state = await runtimeState.read();
      if (!state?.runtime || !state.codex || !state.cdp) return null;
      return {
        runtime: state.runtime,
        root: { pid: state.codex.rootPid, startedAt: state.codex.startedAt },
        cdp: state.cdp,
        packageVersion: state.codex.packageVersion,
      };
    },
    securePendingDirectory: () => provider.secureDirectory(paths.runtimeDirectory),
    executeControl: async (command) => statusFromControlResult(
      await executeRuntimeControlCommand(cliCommand(command), runtimeCli),
    ),
    discoverNormalCodex: async () => {
      const discovery = await discoverCodexInstall(provider, cache);
      return { install: discovery.install, root: discovery.runningRoot };
    },
    recordEvidence: (evidence) => recordRuntimeAcceptanceEvidence(
      paths.acceptanceEvidenceDirectory,
      evidence,
    ),
    now: () => new Date().toISOString(),
    performanceNow: () => performance.now(),
    newSessionId: randomUUID,
    runtimeVersion: RUNTIME_VERSION,
  };
}

try {
  if (process.platform !== "win32") {
    throw new RuntimeError(
      "RUNTIME_ENVIRONMENT_INVALID",
      "Automated Runtime acceptance is currently available on Windows only",
      "Complete the macOS manual acceptance checklist on a real Mac.",
    );
  }
  const command = parseAcceptanceArguments(process.argv.slice(2));
  await prepareProductionRuntimePaths();
  const result = await runRuntimeAcceptance(command, productionDependencies());
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${JSON.stringify({
    compatible: false,
    error: { code: runtimeErrorCode(error) },
  })}\n`);
}
