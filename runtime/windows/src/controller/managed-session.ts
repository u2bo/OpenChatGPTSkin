import { RuntimeError } from "../errors.js";
import type { RuntimeSessionState } from "../state.js";
import type { WindowsRuntimeProvider } from "../types.js";
import { windowsPathsEqual } from "../windows/powershell-provider.js";

export async function hasManagedSessionExited(
  state: RuntimeSessionState,
  provider: WindowsRuntimeProvider,
): Promise<boolean> {
  if (!state.codex || !state.cdp) return false;

  const [roots, listener] = await Promise.all([
    provider.listCodexRoots(),
    provider.inspectPort(state.cdp.port),
  ]);
  const recordedRootExists = roots.some((root) =>
    root.pid === state.codex!.rootPid && root.startedAt === state.codex!.startedAt
  );
  return !recordedRootExists && listener === null;
}

export async function revalidateManagedSession(
  state: RuntimeSessionState,
  provider: WindowsRuntimeProvider,
): Promise<void> {
  if (!state.codex || !state.cdp) {
    throw new RuntimeError("RUNTIME_SESSION_STALE", "Managed identity is incomplete");
  }

  const roots = await provider.listCodexRoots();
  const exact = roots.find((root) =>
    root.pid === state.codex!.rootPid && root.startedAt === state.codex!.startedAt
  );
  if (!exact || !windowsPathsEqual(exact.executablePath, state.codex.executablePath)) {
    throw new RuntimeError("RUNTIME_SESSION_STALE", "Managed Codex root changed");
  }

  const port = await provider.inspectPort(state.cdp.port);
  if (!port || port.host !== "127.0.0.1" || port.port !== state.cdp.port ||
    !port.ancestors.includes(state.codex.rootPid)) {
    throw new RuntimeError("CDP_PROCESS_MISMATCH", "Managed CDP ownership changed");
  }
}
