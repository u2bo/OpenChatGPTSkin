import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
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
import { assertMacBinaryArchitecture } from "./macos-dmg.js";
import { readReleaseManifest } from "./payload.js";
import { runReleaseCommand } from "./release-command.js";

const LAUNCHER_START_TIMEOUT_MS = 15_000;

export class MacDmgCleanupError extends Error {
  constructor(cause: unknown) {
    super("macOS DMG could not be detached safely", { cause });
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
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("macOS app launcher did not become ready"));
    }, LAUNCHER_START_TIMEOUT_MS);

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      if (error) rejectSmoke(error);
      else resolveSmoke();
    };

    lines.once("line", (line) => {
      try {
        const startup = JSON.parse(line) as { readonly url?: string };
        if (!startup.url?.startsWith("http://127.0.0.1:")) {
          throw new Error(
            "macOS app launcher returned an invalid startup URL",
          );
        }
        ready = true;
        child.kill("SIGTERM");
      } catch (error) {
        child.kill("SIGTERM");
        finish(error instanceof Error
          ? error
          : new Error("macOS app launcher output is invalid"));
      }
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (!ready) {
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
  readonly launcherVerified: true;
  readonly unsignedPreviewVerified: true;
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
    const appPath = join(mountPoint, "OpenChatGPTSkin.app");
    const bundle = await verifyMacAppBundleLayout(appPath);
    if (basename(dmgPath) !== macDmgArtifactName(
      bundle.version,
      bundle.arch,
    )) {
      throw new Error("macOS DMG filename does not match the app bundle");
    }
    await runReleaseCommand(
      "/usr/bin/plutil",
      ["-lint", join(appPath, "Contents", "Info.plist")],
      { captureOutput: true },
    );
    await assertUnsigned(appPath);

    const payloadRoot = join(
      appPath,
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

    await smokeLauncher(
      join(appPath, "Contents", "MacOS", "OpenChatGPTSkin"),
      join(temporary, "launcher-home"),
    );
    const payloadAcceptance = await acceptReleasePayload(
      payloadRoot,
      "macos-app-bundle",
    );
    report = {
      scenario: "macos-dmg",
      version: bundle.version,
      target: { platform: "darwin", arch: bundle.arch },
      durationMs: Date.now() - startedAt,
      appBundleVerified: true,
      launcherVerified: true,
      unsignedPreviewVerified: true,
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
