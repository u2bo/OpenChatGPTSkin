export interface ProcessIdentity {
  readonly pid: number;
  readonly parentPid: number;
  readonly startedAt: string;
  readonly executablePath: string;
}

export interface InstallInspection {
  readonly packageRoot: string;
  readonly entryPath: string;
  readonly identityName: string;
  readonly packageVersion: string;
  readonly packagePublisher: string;
  readonly appId: string;
  readonly entryRelativePath: string;
  readonly entryPoint: string;
  readonly packageSignatureStatus: string;
  readonly packageSignerCommonName: string;
  readonly catalogSignatureStatus: string;
  readonly catalogSignerCommonName: string;
  readonly entryBlockMapValid: boolean;
  readonly resourceSignatureStatus: string;
  readonly resourceSignerCommonName: string;
}

export interface PortInspection {
  readonly host: string;
  readonly port: number;
  readonly owningPid: number;
  readonly ancestors: readonly number[];
}

export interface ManagedWindowInspection {
  readonly rootExists: boolean;
  /** Number of visible windows when the platform can observe them without broad consent. */
  readonly visibleWindowCount: number;
  /** Provider-specific activation signal; CDP ownership is verified separately. */
  readonly activationReady: boolean;
}

export type DesktopRuntimePlatform = "win32" | "darwin";

export interface DesktopRuntimeProvider {
  readonly platform?: DesktopRuntimePlatform;
  listCodexRoots(): Promise<readonly ProcessIdentity[]>;
  currentUserPackageRoots(): Promise<readonly string[]>;
  inspectInstall(packageRoot: string): Promise<InstallInspection>;
  inspectPort(port: number): Promise<PortInspection | null>;
  inspectProcessStartedAt(pid: number): Promise<string | null>;
  inspectRemoteDebuggingArguments(rootPid: number, startedAt: string): Promise<{
    readonly hasRemoteDebuggingAddress: boolean;
    readonly hasRemoteDebuggingPort: boolean;
  }>;
  measureProcessCpuPercent(rootPid: number, startedAt: string, sampleMs: number): Promise<number>;
  activateCodexApplication(): Promise<void>;
  inspectManagedWindows(
    rootPid: number,
    startedAt: string,
  ): Promise<ManagedWindowInspection>;
  launch(executablePath: string, args: readonly string[]): Promise<ProcessIdentity>;
  waitForExit(rootPid: number, startedAt: string, timeoutMs: number): Promise<boolean>;
  currentUserSid(): Promise<string>;
  secureDirectory(path: string): Promise<void>;
}

/** @deprecated Use DesktopRuntimeProvider for platform-neutral Runtime code. */
export type WindowsRuntimeProvider = DesktopRuntimeProvider;

export interface VerifiedCodexInstall extends InstallInspection {}

export interface DiscoveryResult {
  readonly install: VerifiedCodexInstall;
  readonly source: "running" | "appx" | "application" | "cache";
  readonly runningRoot: ProcessIdentity | null;
}
