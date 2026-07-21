import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  join,
  resolve,
} from "node:path";
import sharp from "sharp";
import { macDmgArtifactName } from "./artifact-names.js";
import { verifyMacAppBundleLayout } from "./macos-app.js";
import type { ReleaseArch } from "./payload.js";
import { runReleaseCommand } from "./release-command.js";

const MAC_ICON_ENTRIES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
] as const;

export function macIconEntries(): typeof MAC_ICON_ENTRIES {
  return MAC_ICON_ENTRIES;
}

export function assertMacBinaryArchitecture(
  description: string,
  arch: ReleaseArch,
  label: string,
): void {
  const expected = arch === "arm64" ? "arm64" : "x86_64";
  const other = arch === "arm64" ? "x86_64" : "arm64";
  if (!description.includes(expected) || description.includes(other)) {
    throw new Error(`${label} does not target ${arch}`);
  }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Release artifact already exists: ${path}`);
}

async function removeFailedOutput(
  path: string,
  failure: unknown,
  message: string,
): Promise<never> {
  try {
    await rm(path, { force: true });
  } catch (cleanupError) {
    throw new AggregateError([failure, cleanupError], message);
  }
  throw failure;
}

export async function generateMacIcon(
  svgPathInput: string,
  icnsPathInput: string,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("macOS icon generation requires Darwin");
  }
  const svgPath = resolve(svgPathInput);
  const icnsPath = resolve(icnsPathInput);
  await access(svgPath);
  await assertMissing(icnsPath);
  const iconset = `${icnsPath}.iconset`;
  await mkdir(iconset, { recursive: false });
  let failure: unknown;
  try {
    const source = await readFile(svgPath);
    for (const [name, size] of macIconEntries()) {
      await sharp(source)
        .resize(size, size)
        .png()
        .toFile(join(iconset, name));
    }
    await runReleaseCommand(
      "/usr/bin/iconutil",
      ["-c", "icns", iconset, "-o", icnsPath],
      { captureOutput: true },
    );
    await access(icnsPath);
  } catch (error) {
    failure = error;
  }
  try {
    await rm(iconset, { recursive: true, force: true });
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "macOS icon cleanup failed")
      : error;
  }
  if (failure) {
    return await removeFailedOutput(
      icnsPath,
      failure,
      "macOS icon generation and cleanup failed",
    );
  }
}

export interface MacDmgArtifact {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export async function buildMacDmg(options: {
  readonly appPath: string;
  readonly outputDirectory: string;
  readonly version: string;
  readonly arch: ReleaseArch;
}): Promise<MacDmgArtifact> {
  if (process.platform !== "darwin") {
    throw new Error("DMG packaging requires Darwin");
  }
  const appPath = resolve(options.appPath);
  if (basename(appPath) !== "OpenChatGPTSkin.app") {
    throw new Error("DMG input app must be named OpenChatGPTSkin.app");
  }
  const bundle = await verifyMacAppBundleLayout(appPath);
  if (bundle.version !== options.version || bundle.arch !== options.arch) {
    throw new Error("DMG target does not match the app bundle");
  }
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const name = macDmgArtifactName(options.version, options.arch);
  const output = join(outputDirectory, name);
  await assertMissing(output);

  const source = await mkdtemp(
    join(tmpdir(), "open-chatgpt-skin-dmg-"),
  );
  let artifact: MacDmgArtifact | undefined;
  let failure: unknown;
  try {
    await cp(appPath, join(source, "OpenChatGPTSkin.app"), {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    await symlink("/Applications", join(source, "Applications"));
    await writeFile(
      join(source, "首次打开说明 - First Launch.txt"),
      [
        "未签名开发者预览：校验 SHA-256 后，将应用拖入 Applications，再右键选择“打开”。",
        "Unsigned developer preview: verify SHA-256, drag the app to Applications, then Control-click and choose Open.",
        "",
      ].join("\n"),
      "utf8",
    );
    await runReleaseCommand(
      "/usr/bin/hdiutil",
      [
        "create",
        "-volname",
        "OpenChatGPTSkin",
        "-srcfolder",
        source,
        "-format",
        "UDZO",
        output,
      ],
      { captureOutput: true },
    );
    await runReleaseCommand(
      "/usr/bin/hdiutil",
      ["verify", output],
      { captureOutput: true },
    );
    const bytes = await readFile(output);
    artifact = {
      path: output,
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    failure = error;
  }
  try {
    await rm(source, { recursive: true, force: true });
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "DMG staging cleanup failed")
      : error;
  }
  if (failure) {
    return await removeFailedOutput(
      output,
      failure,
      "DMG packaging and cleanup failed",
    );
  }
  if (!artifact) throw new Error("DMG packaging produced no artifact");
  return artifact;
}
