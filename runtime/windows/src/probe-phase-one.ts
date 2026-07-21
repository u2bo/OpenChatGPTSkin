import {
  CurrentCodexAdapter,
  REMOVE_EXPRESSION,
  type AdapterProbe,
  type CdpEndpoint,
  type CdpRuntimeClient,
  type CdpTarget,
} from "@open-chatgpt-skin/cdp-adapter";
import { RuntimeError, runtimeErrorCode } from "./errors.js";
import type { LaunchReceipt } from "./launcher/launcher.js";
import { ProbeObservationSchema, type ProbeObservation } from "./probe-evidence.js";
import type { PendingProbeStore } from "./probe-session.js";
import type { PortInspection, WindowsRuntimeProvider } from "./types.js";

const PROBE_MARKER_EXPRESSION = `(() => {
  const selector = '[data-open-chatgpt-skin]';
  if (document.querySelectorAll(selector).length !== 0) return false;
  const style = document.createElement("style");
  style.dataset.openChatgptSkin = "theme";
  style.textContent = ":root{--ocs-probe:1}";
  document.head.append(style);
  const created = document.querySelectorAll(selector).length === 1;
  style.remove();
  return created && document.querySelectorAll(selector).length === 0;
})()`;
const VERIFY_NO_MARKERS_EXPRESSION =
  `document.querySelectorAll('[data-open-chatgpt-skin]').length`;

export interface ClosableCdpRuntimeClient extends CdpRuntimeClient {
  close(): void;
}

export interface ProbePhaseOneDependencies {
  readonly provider: WindowsRuntimeProvider;
  readonly sessionStore: PendingProbeStore;
  readonly securePendingDirectory: () => Promise<void>;
  readonly launch: () => Promise<LaunchReceipt>;
  readonly waitForPort: (receipt: LaunchReceipt) => Promise<PortInspection>;
  readonly activateWindow: (receipt: LaunchReceipt) => Promise<LaunchReceipt>;
  readonly waitForTarget: (endpoint: CdpEndpoint) => Promise<CdpTarget>;
  readonly connectPage: (
    target: CdpTarget,
    endpoint: CdpEndpoint,
  ) => Promise<ClosableCdpRuntimeClient>;
  readonly waitForAdapter: (adapter: CurrentCodexAdapter) => Promise<AdapterProbe>;
  readonly now: () => string;
  readonly newSessionId: () => string;
}

export interface ProbeAwaitingExitResult {
  readonly compatible: null;
  readonly phase: "awaiting-exit";
  readonly nextAction: string;
}

function targetCategory(targetUrl: string): ProbeObservation["target"] {
  const url = new URL(targetUrl);
  return {
    type: "page",
    protocol: url.protocol as "app:" | "https:",
    host: url.hostname,
    pathCategory: url.protocol === "app:" ? "app-root" : "codex",
  };
}

async function ensureNoPendingProbe(
  dependencies: ProbePhaseOneDependencies,
): Promise<void> {
  const pending = await dependencies.sessionStore.read();
  if (!pending) return;
  const exited = await dependencies.provider.waitForExit(
    pending.root.pid,
    pending.root.startedAt,
    100,
  );
  if (!exited || await dependencies.provider.inspectPort(pending.cdp.port)) {
    throw new RuntimeError("PROBE_EXIT_PENDING", "Previous managed Codex is active");
  }
  if (pending.status === "passed-awaiting-exit") {
    throw new RuntimeError(
      "PROBE_FINALIZE_REQUIRED",
      "Finalize the previous successful probe first",
    );
  }
  await dependencies.sessionStore.clear();
}

async function removeAndVerifyMarkers(page: CdpRuntimeClient): Promise<void> {
  const managedRemaining = await page.evaluate<number>(REMOVE_EXPRESSION);
  const allRemaining = await page.evaluate<number>(VERIFY_NO_MARKERS_EXPRESSION);
  if (managedRemaining !== 0 || allRemaining !== 0) {
    throw new RuntimeError("THEME_CLEANUP_FAILED", "probe marker cleanup failed");
  }
}

export async function runProbePhaseOne(
  dependencies: ProbePhaseOneDependencies,
  recordEvidenceRequested: boolean,
): Promise<ProbeAwaitingExitResult> {
  await ensureNoPendingProbe(dependencies);
  await dependencies.securePendingDirectory();
  let receipt: LaunchReceipt | null = null;
  let page: ClosableCdpRuntimeClient | null = null;
  try {
    receipt = await dependencies.launch();
    await dependencies.waitForPort(receipt);
    receipt = await dependencies.activateWindow(receipt);
    const target = await dependencies.waitForTarget(receipt.cdp);
    page = await dependencies.connectPage(target, receipt.cdp);
    await dependencies.waitForAdapter(new CurrentCodexAdapter(page));
    const markerRoundTrip = await page.evaluate<boolean>(PROBE_MARKER_EXPRESSION);
    await removeAndVerifyMarkers(page);
    if (!markerRoundTrip) {
      throw new RuntimeError("THEME_CLEANUP_FAILED", "probe marker round trip failed");
    }
    const observation = ProbeObservationSchema.parse({
      packageIdentity: "OpenAI.Codex",
      packageVersion: receipt.install.packageVersion,
      target: targetCategory(target.url),
      capabilities: { main: true, navigation: true, composer: true },
      markerRoundTrip: true,
      loopbackOnly: true,
      windowActivationVerified: true,
      officialAppearanceRestored: true,
    });
    const now = dependencies.now();
    await dependencies.sessionStore.write({
      schemaVersion: 1,
      sessionId: dependencies.newSessionId(),
      status: "passed-awaiting-exit",
      root: { pid: receipt.root.pid, startedAt: receipt.root.startedAt },
      cdp: receipt.cdp,
      packageVersion: receipt.install.packageVersion,
      observation,
      recordEvidenceRequested,
      createdAt: now,
      updatedAt: now,
    });
    return {
      compatible: null,
      phase: "awaiting-exit",
      nextAction: "Quit Codex completely, then run runtime:probe -- --finalize.",
    };
  } catch (error) {
    let failure = error;
    if (page) {
      try {
        await removeAndVerifyMarkers(page);
      } catch (cleanupError) {
        failure = cleanupError;
      }
    }
    if (receipt) {
      const now = dependencies.now();
      await dependencies.sessionStore.write({
        schemaVersion: 1,
        sessionId: dependencies.newSessionId(),
        status: "failed-awaiting-exit",
        root: { pid: receipt.root.pid, startedAt: receipt.root.startedAt },
        cdp: receipt.cdp,
        packageVersion: receipt.install.packageVersion,
        failureCode: runtimeErrorCode(failure),
        recordEvidenceRequested,
        createdAt: now,
        updatedAt: now,
      });
    }
    throw failure;
  } finally {
    page?.close();
  }
}
