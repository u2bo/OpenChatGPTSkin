import { spawn } from "node:child_process";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  join,
  relative,
  resolve,
} from "node:path";
import { createInterface } from "node:readline";
import {
  acceptReleasePayload,
  type ReleaseAcceptanceReport,
} from "./acceptance.js";
import { macDmgArtifactName } from "./artifact-names.js";
import { verifyMacAppBundleLayout } from "./macos-app.js";
import {
  assertMacBinaryArchitecture,
  MAC_APPLICATIONS_LINK_NAME,
  MAC_FIRST_LAUNCH_NOTICE,
  MAC_FIRST_LAUNCH_NOTICE_NAME,
} from "./macos-dmg.js";
import { readReleaseManifest } from "./payload.js";
import { runReleaseCommand } from "./release-command.js";

const LAUNCHER_START_TIMEOUT_MS = 15_000;
const LAUNCHER_STOP_TIMEOUT_MS = 5_000;

export class MacDmgCleanupError extends Error {
  constructor(cause: unknown) {
    super("macOS DMG resources could not be cleaned up safely", { cause });
    this.name = "MacDmgCleanupError";
  }
}

async function collectNativeModules(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".node")) files.push(path);
    }
  }
  await walk(root);
  return files.sort();
}

async function assertUnsigned(appPath: string): Promise<void> {
  try {
    await access(join(appPath, "Contents", "_CodeSignature"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    "Unsigned macOS preview unexpectedly contains a bundle signature",
  );
}

async function smokeLauncher(
  launcher: string,
  home: string,
): Promise<void> {
  await mkdir(home, { recursive: true });
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete environment.NODE_PATH;
  delete environment.NODE_OPTIONS;
  await new Promise<void>((resolveSmoke, rejectSmoke) => {
    const child = spawn(launcher, ["--no-open"], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    let ready = false;
    let settled = false;
    let stopRequested = false;
    let failure: Error | undefined;
    let startTimer: NodeJS.Timeout | undefined;
    let forceTimer: NodeJS.Timeout | undefined;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (startTimer) clearTimeout(startTimer);
      if (forceTimer) clearTimeout(forceTimer);
      lines.close();
      if (error) rejectSmoke(error);
      else resolveSmoke();
    };

    const requestStop = (error?: Error): void => {
      if (error && !failure) failure = error;
      if (stopRequested) return;
      stopRequested = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, LAUNCHER_STOP_TIMEOUT_MS);
    };

    startTimer = setTimeout(() => {
      requestStop(new Error("macOS app launcher did not become ready"));
    }, LAUNCHER_START_TIMEOUT_MS);

    lines.once("line", (line) => {
      try {
        const startup = JSON.parse(line) as { readonly url?: string };
        if (!startup.url?.startsWith("http://127.0.0.1:")) {
          throw new Error(
            "macOS app launcher returned an invalid startup URL",
          );
        }
        ready = true;
        requestStop();
      } catch (error) {
        requestStop(error instanceof Error
          ? error
          : new Error("macOS app launcher output is invalid"));
      }
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (failure) {
        finish(failure);
      } else if (!ready) {
        finish(new Error(
          `macOS app launcher exited before readiness with code ${String(code)}`,
        ));
      } else if (code !== 0) {
        finish(new Error(
          `macOS app launcher exited with code ${String(code)}`,
        ));
      } else {
        finish();
      }
    });
  });
}

export interface MacDmgAcceptanceReport {
  readonly scenario: "macos-dmg";
  readonly version: string;
  readonly target: {
    readonly platform: "darwin";
    readonly arch: "x64" | "arm64";
  };
  readonly durationMs: number;
  readonly appBundleVerified: true;
  readonly installerLayoutVerified: true;
  readonly launcherVerified: true;
  readonly unsignedPreviewVerified: true;
  readonly userDataIsolationVerified: true;
  readonly nativeBinariesVerified: number;
  readonly payloadAcceptance: ReleaseAcceptanceReport;
}

export async function acceptMacDmg(
  dmgPathInput: string,
): Promise<MacDmgAcceptanceReport> {
  if (process.platform !== "darwin") {
    throw new Error("macOS DMG acceptance requires Darwin");
  }
  const startedAt = Date.now();
  const dmgPath = resolve(dmgPathInput);
  await runReleaseCommand(
    "/usr/bin/hdiutil",
    ["verify", dmgPath],
    { captureOutput: true },
  );
  const temporary = await mkdtemp(
    join(tmpdir(), "open-chatgpt-skin-dmg-accept-"),
  );
  const mountPoint = join(temporary, "mount");
  await mkdir(mountPoint);
  let mounted = false;
  let report: MacDmgAcceptanceReport | undefined;
  let failure: unknown;
  try {
    await runReleaseCommand(
      "/usr/bin/hdiutil",
      [
        "attach",
        "-readonly",
        "-nobrowse",
        "-noautoopen",
        "-mountpoint",
        mountPoint,
        dmgPath,
      ],
      { captureOutput: true },
    );
    mounted = true;
    const applicationsLink = join(
      mountPoint,
      MAC_APPLICATIONS_LINK_NAME,
    );
    if (!(await lstat(applicationsLink)).isSymbolicLink() ||
      await readlink(applicationsLink) !== "/Applications") {
      throw new Error("macOS DMG Applications link is invalid");
    }
    if (await readFile(
      join(mountPoint, MAC_FIRST_LAUNCH_NOTICE_NAME),
      "utf8",
    ) !== MAC_FIRST_LAUNCH_NOTICE) {
      throw new Error("macOS DMG first-launch notice is invalid");
    }
    const mountedAppPath = join(mountPoint, "OpenChatGPTSkin.app");
    const mountedBundle = await verifyMacAppBundleLayout(mountedAppPath);
    if (basename(dmgPath) !== macDmgArtifactName(
      mountedBundle.version,
      mountedBundle.arch,
    )) {
      throw new Error("macOS DMG filename does not match the app bundle");
    }
    const installedAppPath = join(
      temporary,
      "installed",
      "OpenChatGPTSkin.app",
    );
    await mkdir(join(temporary, "installed"));
    await cp(mountedAppPath, installedAppPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    const bundle = await verifyMacAppBundleLayout(installedAppPath);
    if (bundle.version !== mountedBundle.version ||
      bundle.arch !== mountedBundle.arch) {
      throw new Error("Installed macOS app does not match the DMG");
    }
    await runReleaseCommand(
      "/usr/bin/plutil",
      ["-lint", join(installedAppPath, "Contents", "Info.plist")],
      { captureOutput: true },
    );
    await assertUnsigned(installedAppPath);

    const payloadRoot = join(
      installedAppPath,
      "Contents",
      "Resources",
      "payload",
    );
    const manifest = await readReleaseManifest(payloadRoot);
    const nativeModules = await collectNativeModules(
      join(payloadRoot, "node_modules"),
    );
    if (nativeModules.length === 0) {
      throw new Error("macOS payload contains no native modules");
    }
    const binaries = [
      join(payloadRoot, "runtime", "node"),
      ...nativeModules,
    ];
    for (const binary of binaries) {
      const result = await runReleaseCommand(
        "/usr/bin/file",
        ["-b", binary],
        { captureOutput: true },
      );
      assertMacBinaryArchitecture(
        result.stdout,
        manifest.target.arch,
        relative(payloadRoot, binary).split("\\").join("/"),
      );
    }

    const launcherHome = join(temporary, "launcher-home");
    await smokeLauncher(
      join(installedAppPath, "Contents", "MacOS", "OpenChatGPTSkin"),
      launcherHome,
    );
    const userDataRoot = join(
      launcherHome,
      "Library",
      "Application Support",
      "OpenChatGPTSkin",
    );
    await access(userDataRoot);
    const userDataMarker = join(
      userDataRoot,
      "acceptance-user-data.marker",
    );
    await writeFile(userDataMarker, "preserve\n", "utf8");
    const payloadAcceptance = await acceptReleasePayload(
      payloadRoot,
      "macos-app-bundle",
    );
    await rm(installedAppPath, { recursive: true, force: false });
    await access(userDataMarker);
    report = {
      scenario: "macos-dmg",
      version: bundle.version,
      target: { platform: "darwin", arch: bundle.arch },
      durationMs: Date.now() - startedAt,
      appBundleVerified: true,
      installerLayoutVerified: true,
      launcherVerified: true,
      unsignedPreviewVerified: true,
      userDataIsolationVerified: true,
      nativeBinariesVerified: binaries.length,
      payloadAcceptance,
    };
  } catch (error) {
    failure = error;
  }

  if (mounted) {
    try {
      await runReleaseCommand(
        "/usr/bin/hdiutil",
        ["detach", mountPoint],
        { captureOutput: true },
      );
      mounted = false;
    } catch (error) {
      failure = new MacDmgCleanupError(
        failure ? new AggregateError([failure, error]) : error,
      );
    }
  }
  if (!mounted) {
    try {
      await rm(temporary, { recursive: true, force: true });
    } catch (error) {
      failure = new MacDmgCleanupError(
        failure ? new AggregateError([failure, error]) : error,
      );
    }
  }
  if (failure) throw failure;
  if (!report) throw new Error("macOS DMG acceptance produced no report");
  return report;
}
