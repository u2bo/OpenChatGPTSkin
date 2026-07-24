import { createConnection } from "node:net";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { vi } from "vitest";
import {
  CurrentCodexAdapter,
  type CdpRuntimeClient,
  type CompiledTheme,
  type RuntimeThemeAdapter,
} from "@open-chatgpt-skin/cdp-adapter";
import {
  CONTROL_MAX_FRAME_BYTES,
  ControlRequestSchema,
  ControlResponseSchema,
  RuntimeControlDispatcher,
  RuntimeController,
  ExitMonitor,
  PowerShellWindowsProvider,
  SecurePipeServer,
  sendControlRequest,
  pipeNameForSid,
  type RecoverRuntimeControllerDependencies,
  type ControlDispatchResult,
  type ControlRequest,
  type ControlResponse,
  RuntimeError,
  RuntimeSessionStateSchema,
  RuntimeStateStore,
  RuntimeThemeRepository,
  type RuntimeThemeLookup,
  ThemeEngine,
  createRuntimePaths,
  type LaunchReceipt,
  type LoadedRuntimeTheme,
  type ProcessIdentity,
  type RuntimeBuiltinThemeId,
  type RuntimeControllerDependencies,
  type RuntimeErrorCode,
  type RuntimePageSession,
  type RuntimeSessionState,
  type WindowsRuntimeProvider,
} from "@open-chatgpt-skin/windows-runtime";

export interface RuntimeControllerFixtureOptions {
  readonly preflightError?: RuntimeErrorCode;
  readonly applyError?: RuntimeErrorCode;
  readonly cleanupError?: RuntimeErrorCode;
  readonly failApplyFor?: readonly RuntimeBuiltinThemeId[];
  readonly failApplyAfterLaunch?: boolean;
  readonly blockApply?: boolean;
  readonly blockCleanup?: boolean;
  readonly initialRecoveryRequired?: boolean;
  readonly initialPendingOperation?: "launch" | "switch" | "pause" | "resume" | "restore";
  readonly terminalStatus?: "restored-awaiting-exit" | "restored-cleanup-required";
  readonly failExitMonitorStart?: boolean;
  readonly failAppendRecentRequest?: RuntimeErrorCode;
  readonly previousThemeUnavailableAfterLaunch?: boolean;
}

export interface RuntimeControllerFixture {
  readonly controller: RuntimeController;
  readonly state: RuntimeStateStore;
  readonly provider: WindowsRuntimeProvider;
  readonly page: RuntimePageSession & { readonly adapter: RuntimeThemeAdapter };
  readonly launchManaged: ReturnType<typeof vi.fn>;
  readonly waitForPort: ReturnType<typeof vi.fn>;
  readonly activateWindow: ReturnType<typeof vi.fn>;
  readonly onStopped: ReturnType<typeof vi.fn>;
  calls(): readonly string[];
  exitRoot(): void;
  closePort(): void;
  replaceRootIdentity(): void;
  simulateControllerCrash(): void;
  runExitMonitor(): Promise<void>;
  runInitialPortWait(): Promise<void>;
  waitUntilApplyBlocked(): Promise<void>;
  releaseApply(): void;
  waitUntilCleanupBlocked(): Promise<void>;
  releaseCleanup(): void;
  failNextResume(error: RuntimeErrorCode): void;
  emitExecutionContextsCleared(): void;
  failReconnect(error: RuntimeErrorCode): void;
  disconnectPage(): void;
  recoveryDependencies(): RecoverRuntimeControllerDependencies;
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolvePromise!: () => void;
  return {
    promise: new Promise<void>((resolve) => { resolvePromise = resolve; }),
    resolve: () => resolvePromise(),
  };
}

const themeVersion = "1.0.0";
const timestamp = "2026-07-17T00:00:00.000Z";

const install = {
  packageRoot: "C:/Program Files/WindowsApps/OpenAI.Codex_26.707.12708.0_x64__2p2nqsd0c76g0",
  entryPath: "C:/Program Files/WindowsApps/OpenAI.Codex_26.707.12708.0_x64__2p2nqsd0c76g0/app/ChatGPT.exe",
  identityName: "OpenAI.Codex",
  packageVersion: "26.707.12708.0",
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

export function makeRuntimeState(
  overrides: Partial<RuntimeSessionState> = {},
): RuntimeSessionState {
  const selectedTheme = { id: "mountain-mist" as const, version: themeVersion };
  return RuntimeSessionStateSchema.parse({
    schemaVersion: 2,
    sessionId: "00000000-0000-4000-8000-000000000010",
    status: "active",
    runtime: { pid: 100, startedAt: timestamp },
    codex: {
      rootPid: 200,
      startedAt: timestamp,
      executablePath: install.entryPath,
      packageRoot: install.packageRoot,
      packageVersion: install.packageVersion,
    },
    cdp: { host: "127.0.0.1", port: 55123 },
    adapter: { id: "current-2026-07", version: 1 },
    selectedTheme,
    appliedTheme: selectedTheme,
    skinApplied: true,
    pendingOperation: null,
    recentRequests: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}

function loadedTheme(
  id: RuntimeBuiltinThemeId,
  version = themeVersion,
): LoadedRuntimeTheme {
  return {
    descriptor: { id, name: id, version, ready: true },
    bundle: {} as LoadedRuntimeTheme["bundle"],
    compiled: { themeId: id } as LoadedRuntimeTheme["compiled"],
  };
}

export async function createRuntimeControllerFixture(
  options: RuntimeControllerFixtureOptions = {},
): Promise<RuntimeControllerFixture> {
  const calls: string[] = [];
  const paths = createRuntimePaths("D:/OpenChatGPTSkin-data", "D:/OpenChatGPTSkin");
  let stored: RuntimeSessionState | null = null;
  let lastWrittenStatus: string | null = null;
  const state = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (value: RuntimeSessionState) => {
      const incoming = RuntimeSessionStateSchema.parse(value);
      const byRequestId = new Map<string, RuntimeSessionState["recentRequests"][number]>();
      for (const record of [...(stored?.recentRequests ?? []), ...incoming.recentRequests]) {
        if (!byRequestId.has(record.requestId)) byRequestId.set(record.requestId, record);
      }
      const validated = RuntimeSessionStateSchema.parse({
        ...incoming,
        recentRequests: [...byRequestId.values()].slice(-32),
      });
      if (validated.status !== lastWrittenStatus) calls.push(`write-${validated.status}`);
      lastWrittenStatus = validated.status;
      stored = validated;
    }),
    appendRecentRequest: vi.fn(async (record: RuntimeSessionState["recentRequests"][number]) => {
      if (options.failAppendRecentRequest) {
        throw new RuntimeError(options.failAppendRecentRequest, "Configured response persistence failure");
      }
      if (!stored) return false;
      const existing = stored.recentRequests.find((entry) => entry.requestId === record.requestId);
      if (existing && existing.command !== record.command) {
        throw new RuntimeError("RUNTIME_SESSION_STALE", "Recent request command changed");
      }
      if (existing) return true;
      stored = RuntimeSessionStateSchema.parse({
        ...stored,
        recentRequests: [...stored.recentRequests, record].slice(-32),
        updatedAt: record.completedAt,
      });
      return true;
    }),
    clear: vi.fn(async () => {
      calls.push("clear-state");
      lastWrittenStatus = null;
      stored = null;
    }),
  } as unknown as RuntimeStateStore;
  let root: ProcessIdentity = {
    pid: 200,
    parentPid: 1,
    startedAt: timestamp,
    executablePath: install.entryPath,
  };
  let rootExists = true;
  let portOpen = true;
  let applyCount = 0;
  let nextResumeError: RuntimeErrorCode | null = null;
  let nextReconnectError: RuntimeErrorCode | null = null;
  const applyBlocked = options.blockApply ? deferred() : null;
  const applyStarted = options.blockApply ? deferred() : null;
  const cleanupBlocked = options.blockCleanup ? deferred() : null;
  const cleanupStarted = options.blockCleanup ? deferred() : null;
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const closeListeners = new Set<() => void>();

  const adapter = {
    preflight: vi.fn(async () => {
      calls.push("preflight-theme");
      if (options.preflightError) {
        throw new RuntimeError(options.preflightError, "Configured preflight failure");
      }
      return {
        valid: true,
        welcomeSupported: true,
        requiredLayersResolved: true,
      };
    }),
    apply: vi.fn(async (compiled: { readonly themeId?: RuntimeBuiltinThemeId }) => {
      calls.push("apply-theme");
      applyCount += 1;
      applyStarted?.resolve();
      if (options.blockApply) await applyBlocked!.promise;
      if (nextResumeError) {
        const error = nextResumeError;
        nextResumeError = null;
        throw new RuntimeError(error, "Configured resume failure");
      }
      if (options.applyError ||
        options.failApplyFor?.includes(compiled.themeId ?? "mountain-mist") ||
        (options.failApplyAfterLaunch && applyCount > 1)) {
        throw new RuntimeError(
          options.applyError ?? "THEME_APPLY_FAILED",
          "Configured apply failure",
        );
      }
    }),
    verify: vi.fn(async () => ({ valid: true })),
    remove: vi.fn(async () => {
      calls.push("cleanup-theme");
      cleanupStarted?.resolve();
      if (options.blockCleanup) await cleanupBlocked!.promise;
      if (options.cleanupError) {
        throw new RuntimeError(options.cleanupError, "Configured cleanup failure");
      }
    }),
    verifyOfficialAppearance: vi.fn(async () => ({ valid: true })),
  } as unknown as RuntimeThemeAdapter;

  const connection = {
    evaluate: vi.fn(async <T>(): Promise<T> => undefined as T),
    close: vi.fn(() => {}),
    on: vi.fn((method: string, listener: (params: unknown) => void) => {
      const subscriptions = listeners.get(method) ?? new Set<(params: unknown) => void>();
      subscriptions.add(listener);
      listeners.set(method, subscriptions);
      return () => subscriptions.delete(listener);
    }),
    onClose: vi.fn((listener: () => void) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    }),
  } as unknown as RuntimePageSession["connection"];
  const page = {
    endpoint: { host: "127.0.0.1" as const, port: 55123 },
    target: {
      id: "codex",
      type: "page",
      title: "Codex",
      url: "app://-/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1:55123/devtools/page/codex",
    },
    adapterId: "current-2026-07",
    connection,
    adapter,
    close: () => connection.close(),
  } as RuntimePageSession & { readonly adapter: RuntimeThemeAdapter };

  const provider: WindowsRuntimeProvider = {
    listCodexRoots: vi.fn(async () => {
      calls.push("revalidate-root");
      return rootExists ? [root] : [];
    }),
    currentUserPackageRoots: vi.fn(async () => [install.packageRoot]),
    inspectInstall: vi.fn(async () => {
      calls.push("revalidate-install");
      return install;
    }),
    inspectPort: vi.fn(async () => {
      calls.push("revalidate-port");
      return portOpen ? {
        host: "127.0.0.1",
        port: 55123,
        owningPid: 201,
        ancestors: [201, 200],
      } : null;
    }),
    activateCodexApplication: vi.fn(async () => {}),
    inspectManagedWindows: vi.fn(async () => ({
      rootExists,
      visibleWindowCount: rootExists ? 1 : 0,
      activationReady: rootExists,
    })),
    launch: vi.fn(async (executablePath) => ({ ...root, executablePath })),
    waitForExit: vi.fn(async () => !rootExists),
    inspectProcessStartedAt: vi.fn(async (pid) => pid === 100 ? timestamp : null),
    inspectRemoteDebuggingArguments: vi.fn(async () => ({
      hasRemoteDebuggingAddress: false,
      hasRemoteDebuggingPort: false,
    })),
    measureProcessCpuPercent: vi.fn(async () => 0.25),
    currentUserSid: vi.fn(async () => "S-1-5-21-test"),
    secureDirectory: vi.fn(async () => {}),
  };

  const repository = {
    load: vi.fn(async (value: RuntimeThemeLookup) => {
      calls.push("load-theme");
      const id = typeof value === "string" ? value : value.id;
      const version = typeof value === "string" ? undefined : value.version;
      if (options.previousThemeUnavailableAfterLaunch && applyCount > 0 &&
        version === themeVersion) {
        throw new RuntimeError("THEME_NOT_READY", "Configured previous theme is unavailable");
      }
      return loadedTheme(id as RuntimeBuiltinThemeId, version ?? themeVersion);
    }),
  } as unknown as RuntimeThemeRepository;
  const themes = new ThemeEngine(repository);
  const launchManaged = vi.fn(async (): Promise<LaunchReceipt> => {
    calls.push("launch-codex");
    rootExists = true;
    portOpen = true;
    return {
      install,
      root,
      cdp: { host: "127.0.0.1", port: 55123 },
      launchedAt: timestamp,
    };
  });
  const waitForPort = vi.fn(async (): Promise<{ readonly host: string; readonly port: number; readonly owningPid: number; readonly ancestors: readonly number[] }> => {
    calls.push("wait-port");
    if (!portOpen) throw new RuntimeError("CDP_NOT_READY", "Configured port is closed");
    return { host: "127.0.0.1", port: 55123, owningPid: 201, ancestors: [201, 200] };
  });
  const activateWindow = vi.fn(async (receipt: LaunchReceipt) => {
    calls.push("activate-window");
    return receipt;
  });
  const connectPage = vi.fn(async () => {
    calls.push("connect-page");
    if (nextReconnectError) {
      const error = nextReconnectError;
      nextReconnectError = null;
      throw new RuntimeError(error, "Configured reconnect failure");
    }
    return page;
  });
  const stopped = deferred();
  const onStopped = vi.fn(async () => { stopped.resolve(); });

  if (options.initialRecoveryRequired) {
    stored = makeRuntimeState({
      status: "recovery-required",
      appliedTheme: null,
      skinApplied: null,
      pendingOperation: null,
    });
  } else if (options.terminalStatus) {
    stored = makeRuntimeState({
      status: options.terminalStatus,
      appliedTheme: null,
      skinApplied: false,
      pendingOperation: null,
    });
  } else if (options.initialPendingOperation) {
    const kind = options.initialPendingOperation;
    const previousStatus = kind === "launch"
      ? null
      : kind === "resume"
        ? "paused"
        : "active";
    const status = kind === "launch"
      ? "launching"
      : kind === "restore"
        ? "restoring"
        : kind === "resume"
          ? "paused"
          : "active";
    const priorTheme = { id: "mountain-mist" as const, version: themeVersion };
    stored = makeRuntimeState({
      status,
      appliedTheme: kind === "launch" || kind === "resume" ? null : priorTheme,
      skinApplied: kind === "launch" || kind === "resume" ? false : true,
      pendingOperation: {
        kind,
        requestId: "00000000-0000-4000-8000-000000000020",
        startedAt: timestamp,
        previousStatus,
        previousSelectedTheme: kind === "launch" ? null : priorTheme,
        previousAppliedTheme: kind === "launch" || kind === "resume" ? null : priorTheme,
        candidateTheme: kind === "switch"
          ? { id: "glacier-aurora", version: themeVersion }
          : kind === "launch" || kind === "resume"
            ? priorTheme
            : null,
      },
    });
  }
  lastWrittenStatus = stored?.status ?? null;
  const exitMonitor = new ExitMonitor({
    provider,
    state,
    onStopped,
    initialPortWaitMs: 0,
    initialIntervalMs: 1,
    cleanupIntervalMs: 1,
  });

  const dependencies: RuntimeControllerDependencies = {
    paths,
    provider,
    state,
    themes,
    launchManaged,
    waitForPort,
    activateWindow,
    connectPage,
    secureRuntimeDirectories: vi.fn(async () => { calls.push("secure"); }),
    now: () => timestamp,
    runtimeIdentity: { pid: 100, startedAt: timestamp },
    newSessionId: () => "00000000-0000-4000-8000-000000000010",
    onStopped,
    createExitMonitor: () => ({
      start: () => {
        calls.push("exit-monitor-started");
        if (options.failExitMonitorStart) {
          throw new RuntimeError("RUNTIME_CONTROL_UNAVAILABLE", "Configured exit monitor failure");
        }
      },
      stop: () => { calls.push("exit-monitor-stopped"); },
    }),
  };
  const cache = {
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
  } as unknown as RecoverRuntimeControllerDependencies["cache"];

  return {
    controller: new RuntimeController(dependencies),
    state,
    provider,
    page,
    launchManaged,
    waitForPort,
    activateWindow,
    onStopped,
    calls: () => [...calls],
    exitRoot: () => { rootExists = false; },
    closePort: () => { portOpen = false; },
    replaceRootIdentity: () => {
      root = { ...root, pid: 300, startedAt: "2026-07-17T00:00:01.000Z" };
    },
    simulateControllerCrash: () => page.close(),
    runExitMonitor: async () => {
      const session = await state.read();
      if (!session) throw new Error("Runtime session is missing");
      exitMonitor.start(session);
      await stopped.promise;
    },
    runInitialPortWait: async () => {
      const session = await state.read();
      if (!session) throw new Error("Runtime session is missing");
      exitMonitor.start(session);
      await waitForCleanupRequired(state);
      exitMonitor.stop();
    },
    waitUntilApplyBlocked: async () => {
      if (!applyStarted) throw new Error("Apply is not configured to block");
      await applyStarted.promise;
    },
    releaseApply: () => applyBlocked?.resolve(),
    waitUntilCleanupBlocked: async () => {
      if (!cleanupStarted) throw new Error("Cleanup is not configured to block");
      await cleanupStarted.promise;
    },
    releaseCleanup: () => cleanupBlocked?.resolve(),
    failNextResume: (error) => { nextResumeError = error; },
    emitExecutionContextsCleared: () => {
      for (const listener of listeners.get("Runtime.executionContextsCleared") ?? []) listener({});
    },
    failReconnect: (error) => { nextReconnectError = error; },
    disconnectPage: () => {
      for (const listener of closeListeners) listener();
    },
    recoveryDependencies: () => ({ ...dependencies, cache }),
  };
}

async function waitForCleanupRequired(state: RuntimeStateStore): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await state.read())?.status === "restored-cleanup-required") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Exit monitor did not persist cleanup-required");
}

export type IntegratedRuntimeMode =
  | "normal"
  | "candidate-fails"
  | "rollback-fails"
  | "ambiguous-reconnect";

export interface IntegratedRuntimeFixture {
  startPipe(): Promise<void>;
  send(
    command: ControlRequest["command"],
    params: Readonly<Record<string, unknown>>,
    requestId?: string,
  ): Promise<ControlResponse>;
  status(): Promise<Extract<ControlResponse, { readonly ok: true }>>;
  disconnectAndReadResult(): Promise<ControlResponse>;
  sendRawOversizedFrame(): Promise<void>;
  dispatchCount(): number;
  launchCount(): number;
  events(): readonly string[];
  exitRoot(): void;
  runInitialPortWait(): Promise<void>;
  close(): Promise<void>;
}

interface LinkedomRuntimePage {
  readonly session: RuntimePageSession;
  disconnect(): void;
}

interface IntegratedAdapterControl {
  candidateFailed: boolean;
}

const integratedEndpoint = { host: "127.0.0.1" as const, port: 55123 };

function pageClient(html: string): {
  readonly client: CdpRuntimeClient;
  readonly disconnect: () => void;
  readonly on: (method: string, listener: (params: unknown) => void) => () => void;
  readonly onClose: (listener: () => void) => () => void;
} {
  const { document, window } = parseHTML(html);
  const runtimeWindow = Object.create(window) as Window;
  const eventListeners = new Map<string, Set<(params: unknown) => void>>();
  const closeListeners = new Set<() => void>();
  let closed = false;

  Object.defineProperty(runtimeWindow, "location", {
    configurable: false,
    value: { href: "app://-/index.html" },
  });
  Object.defineProperty(runtimeWindow, "getComputedStyle", {
    configurable: false,
    value: (node: HTMLElement) => ({ pointerEvents: node.style.pointerEvents }),
  });
  class TestImage {
    src = "";

    decode(): Promise<void> {
      return Promise.resolve();
    }
  }
  Object.defineProperty(runtimeWindow, "Image", {
    configurable: false,
    value: TestImage,
  });
  for (const node of document.querySelectorAll("nav,main,textarea")) {
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => ({
        width: 100,
        height: 40,
        top: 0,
        left: 0,
        right: 100,
        bottom: 40,
      }),
    });
  }

  const disconnect = () => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener();
    closeListeners.clear();
  };
  return {
    client: {
      evaluate: async <T>(expression: string): Promise<T> => await Function(
        "document",
        "window",
        `return (${expression});`,
      )(document, runtimeWindow) as T,
    },
    disconnect,
    on: (method, listener) => {
      const listeners = eventListeners.get(method) ?? new Set<(params: unknown) => void>();
      listeners.add(listener);
      eventListeners.set(method, listeners);
      return () => listeners.delete(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
  };
}

function controlledAdapter(
  adapter: RuntimeThemeAdapter,
  mode: IntegratedRuntimeMode,
  control: IntegratedAdapterControl,
): RuntimeThemeAdapter {
  return {
    probe: () => adapter.probe(),
    preflight: (theme) => adapter.preflight(theme),
    verify: () => adapter.verify(),
    verifyOfficialAppearance: () => adapter.verifyOfficialAppearance(),
    remove: () => adapter.remove(),
    async apply(theme: CompiledTheme): Promise<void> {
      if ((mode === "candidate-fails" || mode === "rollback-fails") &&
        theme.themeId === "glacier-aurora") {
        control.candidateFailed = true;
        throw new RuntimeError("THEME_APPLY_FAILED", "Configured candidate failure");
      }
      if (mode === "rollback-fails" && control.candidateFailed &&
        theme.themeId === "mountain-mist") {
        throw new RuntimeError("THEME_APPLY_FAILED", "Configured rollback failure");
      }
      await adapter.apply(theme);
    },
  };
}

async function createLinkedomRuntimePage(
  mode: IntegratedRuntimeMode,
  control: IntegratedAdapterControl,
): Promise<LinkedomRuntimePage> {
  const html = await readFile("tests/fixtures/runtime/codex-page.html", "utf8");
  const page = pageClient(html);
  const connection = {
    evaluate: page.client.evaluate,
    close: page.disconnect,
    on: page.on,
    onClose: page.onClose,
  };
  const adapter = controlledAdapter(new CurrentCodexAdapter(connection), mode, control);
  return {
    session: {
      endpoint: integratedEndpoint,
      target: {
        id: "codex",
        type: "page",
        title: "Codex",
        url: "app://-/index.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:55123/devtools/page/codex",
      },
      adapterId: "current-2026-07",
      connection,
      adapter,
      close: page.disconnect,
    },
    disconnect: page.disconnect,
  };
}

function integratedRequest(
  command: ControlRequest["command"],
  params: Readonly<Record<string, unknown>>,
  requestId: string,
): ControlRequest {
  let raw: unknown;
  switch (command) {
    case "launch":
    case "switch":
      raw = { protocolVersion: 1, requestId, command, params };
      break;
    case "status":
    case "pause":
    case "resume":
    case "restore":
      raw = { protocolVersion: 1, requestId, command, params };
      break;
  }
  const parsed = ControlRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Integrated fixture command is invalid");
  }
  return parsed.data;
}

function safeRendererFailureResponse(
  requestId: string,
  error: RuntimeError,
): ControlResponse {
  return ControlResponseSchema.parse({
    protocolVersion: 1,
    requestId,
    ok: false,
    error: {
      code: error.code,
      message: "Renderer reconciliation failed safely.",
      nextAction: "Review Runtime status and restore Codex if required.",
    },
  });
}

async function waitForState(
  state: RuntimeStateStore,
  predicate: (value: RuntimeSessionState | null) => boolean,
): Promise<RuntimeSessionState | null> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const current = await state.read();
    if (predicate(current)) return current;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("Integrated Runtime fixture did not reach the expected state");
}

export async function createIntegratedRuntimeFixture(options: {
  readonly mode?: IntegratedRuntimeMode;
  readonly reuseOldPort?: boolean;
} = {}): Promise<IntegratedRuntimeFixture> {
  const mode = options.mode ?? "normal";
  const root = await mkdtemp(join(tmpdir(), "ocs-integrated-runtime-"));
  const paths = createRuntimePaths(root, resolve("."));
  const state = new RuntimeStateStore(paths.sessionFile);
  const events: string[] = [];
  const adapterControl: IntegratedAdapterControl = { candidateFailed: false };
  let rootExists = false;
  let portOpen = false;
  let launches = 0;
  let dispatches = 0;
  let requestNumber = 0;
  let page: LinkedomRuntimePage | null = null;
  let reconnectFailure: RuntimeError | null = null;
  let connectionCount = 0;
  let pipe: SecurePipeServer | null = null;
  let pipeSid: string | null = null;
  const rootIdentity: ProcessIdentity = {
    pid: 200,
    parentPid: 1,
    startedAt: timestamp,
    executablePath: install.entryPath,
  };

  const inspection = () => portOpen
    ? {
        host: "127.0.0.1",
        port: integratedEndpoint.port,
        owningPid: 201,
        ancestors: [201, rootIdentity.pid],
      }
    : null;
  const provider: WindowsRuntimeProvider = {
    listCodexRoots: async () => rootExists ? [rootIdentity] : [],
    currentUserPackageRoots: async () => [install.packageRoot],
    inspectInstall: async () => install,
    inspectPort: async () => inspection(),
    inspectProcessStartedAt: async (pid) => pid === 100 ? timestamp : null,
    activateCodexApplication: async () => {},
    inspectManagedWindows: async () => ({
      rootExists,
      visibleWindowCount: rootExists ? 1 : 0,
      activationReady: rootExists,
    }),
    launch: async () => rootIdentity,
    waitForExit: async () => !rootExists,
    inspectRemoteDebuggingArguments: async () => ({
      hasRemoteDebuggingAddress: false,
      hasRemoteDebuggingPort: false,
    }),
    measureProcessCpuPercent: async () => 0.25,
    currentUserSid: async () => "S-1-5-21-integrated",
    secureDirectory: async () => {},
  };
  const repository = new RuntimeThemeRepository(paths.themesRoot);
  const themes = new ThemeEngine(repository);
  const exitMonitor = new ExitMonitor({
    provider,
    state,
    onStopped: async () => { events.push("controller-stopped"); },
    initialPortWaitMs: 0,
    initialIntervalMs: 1,
    cleanupIntervalMs: 1,
  });
  const connectPage = async (): Promise<RuntimePageSession> => {
    connectionCount += 1;
    if (mode === "ambiguous-reconnect" && connectionCount > 1) {
      reconnectFailure = new RuntimeError(
        "CDP_TARGET_AMBIGUOUS",
        "Configured ambiguous renderer target",
      );
      throw reconnectFailure;
    }
    page = await createLinkedomRuntimePage(mode, adapterControl);
    return page.session;
  };
  const dependencies: RuntimeControllerDependencies = {
    paths,
    provider,
    state,
    themes,
    launchManaged: async (): Promise<LaunchReceipt> => {
      launches += 1;
      rootExists = true;
      portOpen = true;
      return {
        install,
        root: rootIdentity,
        cdp: integratedEndpoint,
        launchedAt: timestamp,
      };
    },
    waitForPort: async () => {
      const value = inspection();
      if (!value) throw new RuntimeError("CDP_NOT_READY", "Integrated port is closed");
      return value;
    },
    activateWindow: async (receipt) => receipt,
    connectPage,
    secureRuntimeDirectories: async () => {
      await mkdir(paths.runtimeDirectory, { recursive: true });
      await mkdir(paths.installDirectory, { recursive: true });
      await mkdir(paths.themeStoreDirectory, { recursive: true });
    },
    now: () => timestamp,
    runtimeIdentity: { pid: 100, startedAt: timestamp },
    newSessionId: () => "00000000-0000-4000-8000-000000000040",
    onStopped: async () => { events.push("controller-stopped"); },
    createExitMonitor: () => ({
      start(session) {
        events.push("exit-monitor-started");
        exitMonitor.start(session);
      },
      stop() {
        exitMonitor.stop();
      },
    }),
  };
  const controller = new RuntimeController(dependencies);
  const dispatcher = new RuntimeControlDispatcher(controller, state);
  const dispatch = async (request: ControlRequest): Promise<ControlDispatchResult> => {
    dispatches += 1;
    const result = await dispatcher.dispatch(request);
    const afterResponse = result.afterResponse;
    if (!afterResponse) return result;
    return {
      response: result.response,
      afterResponse: async () => {
        events.push("response-flushed");
        await afterResponse();
      },
    };
  };
  const nextRequestId = () => {
    requestNumber += 1;
    return `00000000-0000-4000-8000-${String(requestNumber).padStart(12, "0")}`;
  };
  const waitForEvent = async (event: string) => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (events.includes(event)) return;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`Integrated Runtime fixture did not record ${event}`);
  };

  return {
    async startPipe(): Promise<void> {
      if (pipe || process.platform !== "win32") return;
      pipeSid = await new PowerShellWindowsProvider().currentUserSid();
      pipe = await SecurePipeServer.start({ sid: pipeSid, dispatch });
    },
    async send(command, params, requestId = nextRequestId()): Promise<ControlResponse> {
      const request = integratedRequest(command, params, requestId);
      if (pipe && pipeSid) {
        const response = await sendControlRequest({ sid: pipeSid, request });
        if (command === "restore" && response.ok) await waitForEvent("exit-monitor-started");
        return response;
      }
      const result = await dispatch(request);
      if (result.afterResponse) await result.afterResponse();
      return result.response;
    },
    async status(): Promise<Extract<ControlResponse, { readonly ok: true }>> {
      const response = await this.send("status", {});
      if (!response.ok) throw new Error("Integrated Runtime status unexpectedly failed");
      return response;
    },
    async disconnectAndReadResult(): Promise<ControlResponse> {
      if (!page) throw new Error("Integrated Runtime page is unavailable");
      page.disconnect();
      await waitForState(state, (value) => value?.status === "recovery-required");
      if (!reconnectFailure) throw new Error("Integrated Runtime reconnect did not fail");
      return safeRendererFailureResponse(nextRequestId(), reconnectFailure);
    },
    async sendRawOversizedFrame(): Promise<void> {
      if (!pipeSid) throw new Error("Secured Pipe was not started");
      await new Promise<void>((resolveClosed, rejectClosed) => {
        const socket = createConnection(pipeNameForSid(pipeSid!));
        socket.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code === "EPIPE") resolveClosed();
          else rejectClosed(error);
        });
        socket.once("close", () => resolveClosed());
        socket.once("connect", () => {
          const header = Buffer.alloc(4);
          header.writeUInt32LE(CONTROL_MAX_FRAME_BYTES + 1, 0);
          socket.write(header);
        });
      });
    },
    dispatchCount: () => dispatches,
    launchCount: () => launches,
    events: () => [...events],
    exitRoot: () => {
      rootExists = false;
      if (!options.reuseOldPort) portOpen = false;
    },
    async runInitialPortWait(): Promise<void> {
      await waitForState(state, (value) => value?.status === "restored-cleanup-required");
    },
    async close(): Promise<void> {
      await controller.close();
      await pipe?.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
