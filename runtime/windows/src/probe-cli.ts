import { randomUUID } from "node:crypto";
import {
  CdpConnection,
  waitForCompatibleCodexTarget,
  waitForCompatibleAdapter,
} from "@open-chatgpt-skin/cdp-adapter";
import { TrustedInstallStore } from "./discovery/trusted-cache.js";
import { RuntimeError, runtimeErrorCode } from "./errors.js";
import {
  activateManagedCodexWindow,
  launchManagedCodex,
  waitForManagedPort,
} from "./launcher/launcher.js";
import { prepareProductionRuntimePaths } from "./paths.js";
import { parseProbeArguments } from "./probe-command.js";
import { recordProbeEvidence } from "./probe-evidence.js";
import { finalizeProbe } from "./probe-finalize.js";
import { runProbePhaseOne } from "./probe-phase-one.js";
import { PendingProbeStore } from "./probe-session.js";
import { RuntimeStateStore } from "./state.js";
import { PowerShellWindowsProvider } from "./windows/powershell-provider.js";

try {
  if (process.platform !== "win32") {
    throw new RuntimeError(
      "RUNTIME_ENVIRONMENT_INVALID",
      "The compatibility Probe is currently available on Windows only",
      "Use the macOS Runtime commands, then complete the macOS manual acceptance checklist.",
    );
  }
  const command = parseProbeArguments(process.argv.slice(2));
  const paths = await prepareProductionRuntimePaths();
  const provider = new PowerShellWindowsProvider(undefined, paths.dataRoot);
  const sessionStore = new PendingProbeStore(paths.pendingProbeFile);
  const runtimeStateStore = new RuntimeStateStore(paths.sessionFile);
  const cache = new TrustedInstallStore(paths.installCache);

  if (command.mode === "finalize") {
    const evidence = await finalizeProbe({
      provider,
      sessionStore,
      runtimeStateStore,
      recordEvidence: (value) => recordProbeEvidence(paths.installRoot, value),
    });
    process.stdout.write(`${JSON.stringify({
      compatible: true,
      phase: "complete",
      ...evidence,
    })}\n`);
  } else {
    const result = await runProbePhaseOne({
      provider,
      sessionStore,
      securePendingDirectory: () => provider.secureDirectory(paths.runtimeDirectory),
      launch: () => launchManagedCodex({ provider, cache }),
      waitForPort: (receipt) => waitForManagedPort(provider, receipt),
      activateWindow: (receipt) => activateManagedCodexWindow(provider, receipt),
      waitForTarget: (endpoint) => waitForCompatibleCodexTarget(endpoint),
      connectPage: (target, endpoint) => CdpConnection.connect(
        target.webSocketDebuggerUrl,
        endpoint,
      ),
      waitForAdapter: (adapter) => waitForCompatibleAdapter(adapter),
      now: () => new Date().toISOString(),
      newSessionId: randomUUID,
    }, command.recordEvidence);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`${JSON.stringify({
    compatible: false,
    error: { code: runtimeErrorCode(error) },
  })}\n`);
}
