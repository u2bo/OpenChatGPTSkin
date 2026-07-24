import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  loadThemeCatalog,
  loadThemeDirectory,
  packTheme,
  ThemeStore,
  unpackTheme,
  validateThemeBundle,
  type ValidatedThemeBundle,
} from "../../packages/theme-core/src/index.js";
import {
  parseThemeDocument,
  type ThemeDocument,
} from "../../packages/theme-schema/src/index.js";
import {
  STUDIO_SECURITY_HEADERS,
} from "../../packages/theme-studio-core/src/index.js";
import {
  CONTROL_MAX_FRAME_BYTES,
  ControlRequestSchema,
  ControlResponseSchema,
  ControllerLock,
  ControllerLockRecordSchema,
  createRuntimePaths,
  decodeControlFrame,
  encodeControlFrame,
  controlEndpointForIdentity,
  PowerShellWindowsProvider,
  RuntimeControlDispatcher,
  RuntimeStateStore,
  RuntimeSessionStateSchema,
  sendControlRequest,
  startSecureControlServer,
  TrustedInstallStore,
  TrustedCodexInstallSchema,
  type ControlRequest,
  type RecentRequest,
  type RuntimeController,
  type RuntimeStateStore,
  type RuntimeStatusView,
} from "../../runtime/windows/src/index.js";
import {
  DraftRecordSchema,
  startThemeStudioServer,
  ThemeStudioWorkspace,
} from "../../runtime/theme-studio-service/src/index.js";
import { strToU8, zipSync } from "fflate";

export type BaselineImplementation = "node" | "go";
export type BaselineSuite = "studio" | "runtime" | "theme" | "data";

export interface BaselineSuiteResult {
  readonly implementation: BaselineImplementation;
  readonly suite: BaselineSuite;
  readonly result: Readonly<Record<string, unknown>>;
}

export class BaselineRunnerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BaselineRunnerError";
  }
}

const execFileAsync = promisify(execFile);

const stoppedStatus: RuntimeStatusView = {
  status: "stopped",
  controllerAvailable: true,
  selectedTheme: null,
  appliedTheme: null,
  skinApplied: false,
  packageVersion: null,
  operation: null,
  nextAction: "None",
};

function activeStatus(themeId: string, version: string): RuntimeStatusView {
  return {
    ...stoppedStatus,
    status: "active",
    selectedTheme: { id: themeId, version },
    appliedTheme: { id: themeId, version },
    skinApplied: true,
    packageVersion: "26.707.12708.0",
  };
}

async function runStudioSuite(): Promise<Record<string, unknown>> {
  const token = "a".repeat(64);
  const server = await startThemeStudioServer({
    studioVersion: "0.2.0",
    runtimeStatus: async () => stoppedStatus,
    indexHtml: "<!doctype html><title>OpenChatGPTSkin baseline</title>",
    newToken: () => token,
  });
  try {
    const unauthenticated = await fetch(`${server.origin}/api/bootstrap`);
    const exchange = await fetch(`${server.origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ token }),
    });
    const cookie = exchange.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("Studio baseline session cookie is missing");
    const bootstrap = await fetch(`${server.origin}/api/bootstrap`, {
      headers: { Cookie: cookie },
    });
    const bootstrapBody = await bootstrap.json() as { readonly protocolVersion?: unknown };
    const events = await fetch(`${server.origin}/api/events`, {
      headers: { Cookie: cookie },
    });
    const reader = events.body?.getReader();
    if (!reader) throw new Error("Studio baseline SSE body is missing");
    const first = await reader.read();
    await reader.cancel();
    const eventText = new TextDecoder().decode(first.value);
    const dataLine = eventText.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) throw new Error("Studio baseline SSE event is missing");
    const event = JSON.parse(dataLine.slice("data: ".length)) as { readonly kind?: unknown };

    return {
      protocolVersion: bootstrapBody.protocolVersion,
      sessionStatus: exchange.status,
      bootstrapStatus: bootstrap.status,
      unauthenticatedStatus: unauthenticated.status,
      securityHeaderCount: STUDIO_SECURITY_HEADERS.filter((header) =>
        bootstrap.headers.has(header)
      ).length,
      eventKind: event.kind,
    };
  } finally {
    await server.close();
  }
}

function runtimeController(): RuntimeController {
  const controller = {
    status: async () => stoppedStatus,
    launch: async (id: string, _requestId: string, version = "1.3.0") =>
      activeStatus(id, version),
    switchTheme: async (id: string, _requestId: string, version = "1.3.0") =>
      activeStatus(id, version),
    pause: async () => ({ ...stoppedStatus, status: "paused" as const }),
    resume: async () => activeStatus("mountain-mist", "1.3.0"),
    restore: async () => ({ ...stoppedStatus, status: "restored-awaiting-exit" as const }),
    startExitMonitoring: () => {},
  };
  return controller as unknown as RuntimeController;
}

function runtimeState(): RuntimeStateStore {
  const recentRequests: RecentRequest[] = [];
  return {
    read: async () => ({ recentRequests }),
    appendRecentRequest: async (record: RecentRequest) => {
      if (!recentRequests.some(({ requestId }) => requestId === record.requestId)) {
        recentRequests.push(record);
      }
      return true;
    },
  } as unknown as RuntimeStateStore;
}

function baselineControlPlatform(): "win32" | "darwin" {
  if (process.platform === "win32" || process.platform === "darwin") {
    return process.platform;
  }
  if (process.platform === "linux") {
    // Linux CI exercises the same UID, chmod(0600), dev/inode and stream
    // framing contract through a Unix-domain socket. Native macOS proof remains
    // a separate Gate A requirement and is never inferred from this corpus run.
    return "darwin";
  }
  throw new BaselineRunnerError(
    "NODE_BASELINE_TRANSPORT_UNAVAILABLE",
    `The Node baseline control transport does not support ${process.platform}`,
  );
}

async function runRuntimeSuite(): Promise<Record<string, unknown>> {
  const dispatcher = new RuntimeControlDispatcher(runtimeController(), runtimeState());
  const platform = baselineControlPlatform();
  const identity = platform === "win32"
    ? await new PowerShellWindowsProvider().currentUserSid()
    : (() => {
      const uid = process.getuid?.();
      if (!Number.isInteger(uid) || uid! < 0) {
        throw new BaselineRunnerError(
          "NODE_BASELINE_TRANSPORT_UNAVAILABLE",
          "The Node baseline Unix socket identity is unavailable",
        );
      }
      return `uid:${uid}`;
    })();
  const endpoint = controlEndpointForIdentity(identity, platform);
  const control = await startSecureControlServer({
    platform,
    userIdentity: identity,
    dispatch: (request) => dispatcher.dispatch(request),
  });
  const dispatch = async (value: unknown) => sendControlRequest({
    sid: identity,
    endpoint,
    request: ControlRequestSchema.parse(value),
  });
  const statusRequest: ControlRequest = {
    protocolVersion: 1,
    requestId: "00000000-0000-4000-8000-000000000201",
    command: "status",
    params: {},
  };
  const launchRequest: ControlRequest = {
    protocolVersion: 1,
    requestId: "00000000-0000-4000-8000-000000000202",
    command: "launch",
    params: { themeId: "mountain-mist" },
  };
  try {
    const status = ControlResponseSchema.parse(await dispatch(statusRequest));
    const launched = ControlResponseSchema.parse(await dispatch(launchRequest));
    const replayed = ControlResponseSchema.parse(await dispatch(launchRequest));
    const conflicting = ControlResponseSchema.parse(await dispatch({
      ...launchRequest,
      command: "pause",
      params: {},
    }));
    if (!status.ok || !launched.ok || !replayed.ok || conflicting.ok) {
      throw new Error("Runtime baseline responses have unexpected success states");
    }
    return {
      protocolVersion: status.protocolVersion,
      frameLimitBytes: CONTROL_MAX_FRAME_BYTES,
      transportSecurityVerified: control.securityVerified,
      status: status.result.status,
      launchStatus: launched.result.status,
      replayed: JSON.stringify(replayed) === JSON.stringify(launched),
      conflictingRequestCode: conflicting.error.code,
    };
  } finally {
    await control.close();
  }
}

function legacyTheme(theme: ThemeDocument, version: 1 | 2 | 3): unknown {
  const value = structuredClone(theme) as Record<string, unknown>;
  value.schemaVersion = version;
  delete value.home;
  delete value.composition;
  delete value.interfaceImages;
  const typography = value.typography as Record<string, unknown>;
  for (const key of [
    "displayFamily",
    "displayFontAssetKey",
    "displaySize",
    "displayWeight",
    "displayLineHeight",
    "displayLetterSpacing",
  ]) delete typography[key];
  if (version <= 2) {
    const assets = value.assets as Record<string, unknown>;
    delete assets.profileAvatar;
    delete assets.suggestionIcons;
    delete assets.projectIcons;
  }
  if (version === 1) {
    const colors = value.colors as Record<string, unknown>;
    for (const key of ["textSecondary", "link", "inputText", "placeholder", "codeText"]) {
      delete colors[key];
    }
  }
  return value;
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string"
    ? (error as { readonly code: string }).code
    : error instanceof Error
      ? error.name
      : "UNKNOWN";
}

async function rejectsWithCode(
  operation: () => Promise<unknown>,
  expectedCode: string,
): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch (error) {
    const actual = errorCode(error);
    if (actual !== expectedCode) {
      throw new Error(`Expected ${expectedCode}, received ${actual}`);
    }
    return true;
  }
}

async function runThemeSuite(workspaceRoot: string): Promise<Record<string, unknown>> {
  const themesRoot = join(workspaceRoot, "themes");
  const catalog = await loadThemeCatalog(themesRoot);
  const bundles: ValidatedThemeBundle[] = [];
  for (const entry of catalog.builtins) {
    bundles.push(await loadThemeDirectory(join(themesRoot, ...entry.path.split("/"))));
  }
  let archiveRoundTrips = 0;
  for (const bundle of bundles) {
    const unpacked = await unpackTheme(packTheme(bundle));
    if (unpacked.theme.id !== bundle.theme.id || unpacked.theme.version !== bundle.theme.version) {
      throw new Error(`Theme archive identity changed: ${bundle.theme.id}`);
    }
    archiveRoundTrips += 1;
  }
  const migrationBase = bundles.find(({ theme }) => theme.id === "mountain-mist")?.theme;
  if (!migrationBase) throw new Error("Theme migration baseline is missing mountain-mist");
  const migratedVersions = ([1, 2, 3] as const).map((version) => {
    const parsed = parseThemeDocument(legacyTheme(migrationBase, version));
    if (parsed.schemaVersion !== 4) throw new Error(`Theme v${version} migration failed`);
    return version;
  });
  parseThemeDocument(migrationBase);
  migratedVersions.push(4);

  let archiveNegativeCode = "";
  try {
    await unpackTheme(zipSync({ "../secret.txt": strToU8("secret") }));
  } catch (error) {
    archiveNegativeCode = errorCode(error);
  }
  let futureVersionCode = "";
  try {
    parseThemeDocument({ ...migrationBase, schemaVersion: 99 });
  } catch (error) {
    futureVersionCode = errorCode(error);
  }
  const v4 = bundles.find(({ theme }) => theme.id === "yua-mikami-starlight")?.theme;
  if (!v4) throw new Error("Theme v4 capability baseline is missing");
  return {
    builtins: bundles.map(({ theme }) => theme.id),
    migratedVersions,
    archiveRoundTrips,
    archiveNegativeCode,
    futureVersionCode,
    v4Capabilities: {
      welcomeLocales: Object.keys(v4.home?.welcome.localized ?? {}).sort(),
      displayFont: Boolean(v4.typography.displayFontAssetKey),
      profileAvatar: Boolean(v4.assets.profileAvatar),
      suggestionIcons: Object.keys(v4.assets.suggestionIcons ?? {}).length,
      compositionLayers: v4.composition.layers.length,
    },
  };
}

interface DataCorpus {
  readonly schemaVersion: 1;
  readonly draft: {
    readonly draftId: string;
    readonly revision: number;
    readonly dirty: boolean;
    readonly past: number;
    readonly future: number;
    readonly savedRef: { readonly id: string; readonly version: string };
  };
  readonly personalTheme: { readonly id: string; readonly versions: readonly string[] };
  readonly runtime: {
    readonly sessionId: string;
    readonly status: "restored-awaiting-exit";
    readonly theme: { readonly id: string; readonly version: string };
  };
  readonly trustedCacheSchemaVersion: 1;
  readonly controllerLockSchemaVersion: 1;
  readonly corruptRecordCount: number;
  readonly corruptStoreCount: number;
}

async function runDataSuite(workspaceRoot: string): Promise<Record<string, unknown>> {
  const corpusPath = join(
    workspaceRoot,
    "host", "go", "testdata", "v0.2.0", "data-root", "corpus.json",
  );
  const corpusText = await readFile(corpusPath, "utf8");
  const corpus = JSON.parse(corpusText) as DataCorpus;
  const bundle = await loadThemeDirectory(join(workspaceRoot, "themes", "builtin", "mountain-mist"));
  const timestamp = "2026-07-24T00:00:00.000Z";
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openchatgptskin-data-corpus-"));
  let personalVersions = 0;
  let draftRecord!: ReturnType<typeof DraftRecordSchema.parse>;
  let savedDraftWasClean = false;
  let undoExposedRedo = false;
  let redoConsumedFuture = false;
  let persistedRuntime!: ReturnType<typeof RuntimeSessionStateSchema.parse>;
  let persistedTrusted!: ReturnType<typeof TrustedCodexInstallSchema.parse>;
  let lockRecord!: ReturnType<typeof ControllerLockRecordSchema.parse>;
  let corruptStoresRejected = 0;
  try {
    const paths = createRuntimePaths(temporaryRoot, workspaceRoot);
    let firstId = true;
    const workspace = new ThemeStudioWorkspace({
      paths,
      runtimeStatus: async () => stoppedStatus,
      applyRuntimeTheme: async (ref) => activeStatus(ref.id, ref.version),
      restoreRuntimeTheme: async () => stoppedStatus,
      now: () => timestamp,
      newId: () => {
        if (firstId) {
          firstId = false;
          return corpus.draft.draftId;
        }
        return randomUUID();
      },
    });
    await workspace.initialize();
    const source = (await workspace.listThemes()).themes.find(({ ref }) =>
      ref.id === bundle.theme.id && ref.version === bundle.theme.version
    );
    if (!source) throw new Error("Data compatibility source theme is missing");
    let draft = await workspace.createDraft({
      source: { source: source.source, ref: source.ref },
      themeId: corpus.draft.savedRef.id,
      name: "Baseline dataRoot draft",
    });
    draft = await workspace.updateDraft({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      theme: { ...draft.theme, name: "Baseline dataRoot draft v2" },
    });
    draft = await workspace.updateDraft({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      theme: { ...draft.theme, description: "reviewed baseline draft" },
    });
    const undone = await workspace.undo({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
    });
    undoExposedRedo = undone.redoAvailable;
    const redone = await workspace.redo({
      draftId: undone.draftId,
      expectedRevision: undone.revision,
    });
    redoConsumedFuture = !redone.redoAvailable;
    const saved = await workspace.saveVersion({
      draftId: redone.draftId,
      expectedRevision: redone.revision,
    });
    savedDraftWasClean = !saved.draft.dirty && saved.ref.id === corpus.draft.savedRef.id;
    draft = await workspace.updateDraft({
      draftId: saved.draft.draftId,
      expectedRevision: saved.draft.revision,
      theme: { ...saved.draft.theme, description: "dirty after reviewed save" },
    });
    const draftPath = join(paths.themeStudioDraftDirectory, draft.draftId, "draft.json");
    draftRecord = DraftRecordSchema.parse(JSON.parse(await readFile(draftPath, "utf8")));
    if (draftRecord.revision !== corpus.draft.revision ||
      draftRecord.dirty !== corpus.draft.dirty ||
      draftRecord.past.length !== corpus.draft.past ||
      draftRecord.future.length !== corpus.draft.future ||
      draftRecord.savedRef?.id !== corpus.draft.savedRef.id ||
      draftRecord.savedRef?.version !== corpus.draft.savedRef.version ||
      !savedDraftWasClean || !undoExposedRedo || !redoConsumedFuture) {
      throw new Error("Data compatibility draft lifecycle changed");
    }

    const store = new ThemeStore(paths.themeStoreDirectory);
    for (const version of corpus.personalTheme.versions) {
      const theme = parseThemeDocument({
        ...bundle.theme,
        id: corpus.personalTheme.id,
        version,
      });
      await store.install(validateThemeBundle(theme, bundle.files));
    }
    personalVersions = (await store.list()).filter(({ id }) => id === corpus.personalTheme.id).length;

    const runtime = RuntimeSessionStateSchema.parse({
      schemaVersion: 2,
      sessionId: corpus.runtime.sessionId,
      status: corpus.runtime.status,
      runtime: { pid: process.pid, startedAt: timestamp },
      codex: {
        rootPid: process.pid,
        startedAt: timestamp,
        executablePath: "C:/Program Files/WindowsApps/OpenAI.Codex/app/ChatGPT.exe",
        packageRoot: "C:/Program Files/WindowsApps/OpenAI.Codex",
        packageVersion: "26.707.12708.0",
      },
      cdp: { host: "127.0.0.1", port: 55123 },
      adapter: { id: "baseline", version: 1 },
      selectedTheme: corpus.runtime.theme,
      appliedTheme: null,
      skinApplied: false,
      pendingOperation: null,
      recentRequests: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const stateStore = new RuntimeStateStore(paths.sessionFile);
    await stateStore.write(runtime);
    persistedRuntime = RuntimeSessionStateSchema.parse(await stateStore.read());

    const trusted = TrustedCodexInstallSchema.parse({
      schemaVersion: corpus.trustedCacheSchemaVersion,
      packageRoot: "C:/Program Files/WindowsApps/OpenAI.Codex",
      entryPath: "C:/Program Files/WindowsApps/OpenAI.Codex/app/ChatGPT.exe",
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
      verifiedAt: timestamp,
    });
    const trustedStore = new TrustedInstallStore(paths.installCache);
    await trustedStore.write(trusted);
    persistedTrusted = TrustedCodexInstallSchema.parse(await trustedStore.read());

    const lock = await ControllerLock.acquire(
      paths.controllerLockFile,
      { pid: process.pid, startedAt: timestamp },
      async (pid) => pid === process.pid ? timestamp : null,
    );
    lockRecord = ControllerLockRecordSchema.parse(JSON.parse(
      await readFile(paths.controllerLockFile, "utf8"),
    ));
    await lock.release();

    await writeFile(draftPath, "{}\n", "utf8");
    if (await rejectsWithCode(
      () => workspace.openDraft(draft.draftId),
      "STUDIO_DRAFT_INVALID",
    )) corruptStoresRejected += 1;
    await writeFile(paths.sessionFile, "{}\n", "utf8");
    if (await rejectsWithCode(
      () => stateStore.read(),
      "RUNTIME_SESSION_STALE",
    )) corruptStoresRejected += 1;
    await writeFile(paths.installCache, "{}\n", "utf8");
    if (await trustedStore.read() === null) corruptStoresRejected += 1;
    await writeFile(paths.controllerLockFile, "{}\n", "utf8");
    if (await rejectsWithCode(
      () => ControllerLock.acquire(
        paths.controllerLockFile,
        { pid: process.pid, startedAt: timestamp },
        async () => null,
      ),
      "RUNTIME_SESSION_STALE",
    )) corruptStoresRejected += 1;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const corruptRecordsRejected = [
    DraftRecordSchema.safeParse({ ...draftRecord, schemaVersion: 9 }),
    RuntimeSessionStateSchema.safeParse({ ...persistedRuntime, skinApplied: true }),
    TrustedCodexInstallSchema.safeParse({ ...persistedTrusted, identityName: "Unknown.Product" }),
    ControllerLockRecordSchema.safeParse({ ...lockRecord, startedAt: "invalid" }),
  ].filter(({ success }) => !success).length;
  const sensitiveValuesFound = /(?:[a-z]:[\\/]Users[\\/]|\/Users\/|\/home\/|token|conversation)/i
    .test(corpusText);
  if (corruptRecordsRejected !== corpus.corruptRecordCount) {
    throw new Error("Data compatibility corrupt-record count changed");
  }
  if (corruptStoresRejected !== corpus.corruptStoreCount) {
    throw new Error("Data compatibility corrupt-store count changed");
  }
  return {
    draft: {
      schemaVersion: draftRecord.schemaVersion,
      dirty: draftRecord.dirty,
      revision: draftRecord.revision,
      past: draftRecord.past.length,
      future: draftRecord.future.length,
      savedRef: draftRecord.savedRef,
      savedDraftWasClean,
      undoExposedRedo,
      redoConsumedFuture,
    },
    personalVersions,
    runtimeTerminalStatus: persistedRuntime.status,
    trustedCacheSchemaVersion: persistedTrusted.schemaVersion,
    controllerLockSchemaVersion: lockRecord.schemaVersion,
    corruptRecordsRejected,
    corruptStoresRejected,
    sensitiveValuesFound,
  };
}

async function runGoSuite(
  workspaceRoot: string,
  suite: BaselineSuite,
): Promise<Record<string, unknown>> {
  const executable = process.env.OPENCHATGPTSKIN_GO_HOST ?? join(
    workspaceRoot,
    "host",
    "go",
    "bin",
    process.platform === "win32" ? "OpenChatGPTSkin.exe" : "OpenChatGPTSkin",
  );
  try {
    await access(executable);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BaselineRunnerError(
        "GO_BASELINE_IMPLEMENTATION_UNAVAILABLE",
        "The Go baseline implementation is not available yet",
      );
    }
    throw error;
  }
  const corpusRoot = join(workspaceRoot, "host", "go", "testdata", "v0.2.0");
  const { stdout } = await execFileAsync(executable, [
    "contract-baseline",
    "--suite",
    suite,
    "--corpus-root",
    corpusRoot,
  ], { encoding: "utf8", windowsHide: true });
  const value = JSON.parse(stdout) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BaselineRunnerError(
      "GO_BASELINE_RESULT_INVALID",
      "The Go baseline implementation returned an invalid result",
    );
  }
  return value as Record<string, unknown>;
}

export async function runBaselineSuite(
  workspaceRootInput: string,
  implementation: BaselineImplementation,
  suite: BaselineSuite,
): Promise<BaselineSuiteResult> {
  const workspaceRoot = resolve(workspaceRootInput);
  const result = implementation === "go"
    ? await runGoSuite(workspaceRoot, suite)
    : suite === "studio"
    ? await runStudioSuite()
    : suite === "runtime"
      ? await runRuntimeSuite()
      : suite === "theme"
        ? await runThemeSuite(workspaceRoot)
        : await runDataSuite(workspaceRoot);
  return { implementation, suite, result };
}

export async function runBaselineCorpus(
  workspaceRoot: string,
  implementation: BaselineImplementation,
): Promise<{
  readonly implementation: BaselineImplementation;
  readonly suites: readonly BaselineSuiteResult[];
  readonly review: {
    readonly status: "reviewed";
    readonly knownNodeBugs: readonly string[];
  };
}> {
  const suites: BaselineSuiteResult[] = [];
  for (const suite of ["studio", "runtime", "theme", "data"] as const) {
    suites.push(await runBaselineSuite(workspaceRoot, implementation, suite));
  }
  const result = {
    implementation,
    suites,
    review: { status: "reviewed" as const, knownNodeBugs: [] as readonly string[] },
  };
  if (implementation === "node") {
    const goldenPath = join(
      workspaceRoot,
      "host", "go", "testdata", "v0.2.0", "golden", "node.json",
    );
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as unknown;
    if (JSON.stringify(result) !== JSON.stringify(golden)) {
      throw new BaselineRunnerError(
        "NODE_BASELINE_GOLDEN_MISMATCH",
        "The Node v0.2.0 observable result differs from the reviewed golden result",
      );
    }
  }
  return result;
}

function parseArguments(arguments_: readonly string[]): {
  readonly implementation: BaselineImplementation;
  readonly suite?: BaselineSuite;
} {
  let implementation: BaselineImplementation | undefined;
  let suite: BaselineSuite | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--implementation") {
      const value = arguments_[++index];
      if (value !== "node" && value !== "go") throw new Error("--implementation must be node or go");
      implementation = value;
    } else if (argument === "--suite") {
      const value = arguments_[++index];
      if (value !== "studio" && value !== "runtime" && value !== "theme" && value !== "data") {
        throw new Error("--suite must be studio, runtime, theme, or data");
      }
      suite = value;
    } else {
      throw new Error(`Unknown baseline runner argument: ${argument}`);
    }
  }
  if (!implementation) throw new Error("--implementation is required");
  return suite === undefined ? { implementation } : { implementation, suite };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = options.suite
      ? await runBaselineSuite(process.cwd(), options.implementation, options.suite)
      : await runBaselineCorpus(process.cwd(), options.implementation);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof BaselineRunnerError ? error.code : "BASELINE_RUNNER_FAILED";
    process.stderr.write(`${JSON.stringify({ error: { code, message: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
