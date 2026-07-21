import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { verifyReleasePayload } from "./acceptance.js";
import {
  renderMacInfoPlist,
  renderMacLauncher,
} from "./macos-metadata.js";
import {
  readReleaseManifest,
  type ReleaseArch,
} from "./payload.js";

export interface MacAppBundleResult {
  readonly appPath: string;
  readonly payloadRoot: string;
  readonly version: string;
  readonly arch: ReleaseArch;
}

function isWithin(parent: string, child: string): boolean {
  const nested = relative(parent, child);
  return nested === "" ||
    (!isAbsolute(nested) && nested !== ".." && !nested.startsWith("../") &&
      !nested.startsWith("..\\"));
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`macOS app output already exists: ${path}`);
}

export async function buildMacAppBundle(options: {
  readonly releaseRoot: string;
  readonly outputDirectory: string;
  readonly iconPath: string;
}): Promise<MacAppBundleResult> {
  const releaseRoot = resolve(options.releaseRoot);
  const outputDirectory = resolve(options.outputDirectory);
  const iconPath = resolve(options.iconPath);
  if (basename(releaseRoot) !== "OpenChatGPTSkin") {
    throw new Error(
      "macOS app payload directory must be named OpenChatGPTSkin",
    );
  }
  await verifyReleasePayload(releaseRoot);
  const manifest = await readReleaseManifest(releaseRoot);
  if (manifest.target.platform !== "darwin") {
    throw new Error("macOS app payload must target darwin");
  }
  await access(iconPath);

  const appPath = join(outputDirectory, "OpenChatGPTSkin.app");
  if (isWithin(releaseRoot, appPath)) {
    throw new Error("macOS app output must be outside the release payload");
  }
  await assertMissing(appPath);
  await mkdir(outputDirectory, { recursive: true });
  const contents = join(appPath, "Contents");
  const payloadRoot = join(contents, "Resources", "payload");
  try {
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await mkdir(join(contents, "Resources"), { recursive: true });
    await cp(releaseRoot, payloadRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    await copyFile(iconPath, join(contents, "Resources", "AppIcon.icns"));
    await writeFile(
      join(contents, "Info.plist"),
      renderMacInfoPlist({
        productVersion: manifest.version,
        arch: manifest.target.arch,
      }),
      "utf8",
    );
    const launcher = join(contents, "MacOS", "OpenChatGPTSkin");
    await writeFile(
      launcher,
      renderMacLauncher(manifest.version),
      "utf8",
    );
    await chmod(launcher, 0o755);
    await verifyMacAppBundleLayout(appPath);
  } catch (error) {
    await rm(appPath, { recursive: true, force: true });
    throw error;
  }
  return {
    appPath,
    payloadRoot,
    version: manifest.version,
    arch: manifest.target.arch,
  };
}

export async function verifyMacAppBundleLayout(
  appPathInput: string,
): Promise<{ readonly version: string; readonly arch: ReleaseArch }> {
  const appPath = resolve(appPathInput);
  if (basename(appPath) !== "OpenChatGPTSkin.app") {
    throw new Error("macOS app bundle name is invalid");
  }
  const contents = join(appPath, "Contents");
  const payloadRoot = join(contents, "Resources", "payload");
  await verifyReleasePayload(payloadRoot);
  const manifest = await readReleaseManifest(payloadRoot);
  if (manifest.target.platform !== "darwin") {
    throw new Error("macOS app bundle contains a non-Darwin payload");
  }
  const launcherPath = join(contents, "MacOS", "OpenChatGPTSkin");
  const launcher = await stat(launcherPath);
  if (process.platform !== "win32" && (launcher.mode & 0o111) === 0) {
    throw new Error("macOS app launcher is not executable");
  }
  const expectedLauncher = renderMacLauncher(manifest.version);
  if (await readFile(launcherPath, "utf8") !== expectedLauncher) {
    throw new Error("macOS app launcher does not match the payload");
  }
  const expectedPlist = renderMacInfoPlist({
    productVersion: manifest.version,
    arch: manifest.target.arch,
  });
  const actualPlist = await readFile(
    join(contents, "Info.plist"),
    "utf8",
  );
  if (actualPlist !== expectedPlist) {
    throw new Error("macOS app Info.plist does not match the payload");
  }
  await access(join(contents, "Resources", "AppIcon.icns"));
  return { version: manifest.version, arch: manifest.target.arch };
}
