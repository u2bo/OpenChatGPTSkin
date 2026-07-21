import {
  CdpConnection,
  CurrentCodexAdapter,
  waitForCompatibleAdapter,
  waitForCompatibleCodexTarget,
  type AdapterProbe,
  type CdpEndpoint,
  type CdpRuntimeClient,
  type CdpTarget,
  type RuntimeThemeAdapter,
} from "@open-chatgpt-skin/cdp-adapter";

const RUNTIME_PAGE_TARGET_WAIT_OPTIONS = {
  timeoutMs: 30_000,
  intervalMs: 100,
} as const;

export interface RuntimePageConnection extends CdpRuntimeClient {
  close(): void;
  on(method: string, listener: (params: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
}

export interface RuntimePageSession {
  readonly endpoint: CdpEndpoint;
  readonly target: CdpTarget;
  readonly adapterId: string;
  readonly connection: RuntimePageConnection;
  readonly adapter: RuntimeThemeAdapter;
  close(): void;
}

export interface ConnectRuntimePageDependencies {
  readonly waitForTarget: typeof waitForCompatibleCodexTarget;
  readonly connect: (url: string, endpoint: CdpEndpoint) => Promise<RuntimePageConnection>;
  readonly createAdapter: (connection: RuntimePageConnection) => RuntimeThemeAdapter;
  readonly waitForAdapter: (adapter: RuntimeThemeAdapter) => Promise<AdapterProbe>;
}

export async function connectRuntimePage(
  endpoint: CdpEndpoint,
  dependencies: Partial<ConnectRuntimePageDependencies> = {},
): Promise<RuntimePageSession> {
  const waitForTarget = dependencies.waitForTarget ?? waitForCompatibleCodexTarget;
  const connect = dependencies.connect ?? CdpConnection.connect;
  const createAdapter = dependencies.createAdapter ??
    ((connection: RuntimePageConnection) => new CurrentCodexAdapter(connection));
  const waitForAdapter = dependencies.waitForAdapter ??
    ((adapter: RuntimeThemeAdapter) => waitForCompatibleAdapter(adapter));
  const target = await waitForTarget(endpoint, RUNTIME_PAGE_TARGET_WAIT_OPTIONS);
  const connection = await connect(target.webSocketDebuggerUrl, endpoint);
  const adapter = createAdapter(connection);
  try {
    const probe = await waitForAdapter(adapter);
    return {
      endpoint,
      target,
      adapterId: probe.adapterId,
      connection,
      adapter,
      close: () => connection.close(),
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}
