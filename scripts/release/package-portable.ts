import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { verifyReleasePayload } from "./acceptance.js";
import { readReleaseManifest } from "./payload.js";
import { runReleaseCommand } from "./release-command.js";

export interface PortablePackageResult {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

async function ensureMissing(path: string): Promise<void> {
  try {
    await access(path);
    throw new Error(`Release artifact already exists: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export async function packagePortableRelease(
  releaseRootInput: string,
  outputDirectoryInput: string,
): Promise<PortablePackageResult> {
  const releaseRoot = resolve(releaseRootInput);
  const outputDirectory = resolve(outputDirectoryInput);
  if (basename(releaseRoot) !== "OpenChatGPTSkin") {
    throw new Error("Release staging directory must be named OpenChatGPTSkin");
  }
  await verifyReleasePayload(releaseRoot);
  const manifest = await readReleaseManifest(releaseRoot);
  const suffix = manifest.target.platform === "win32" ? ".zip" : ".tar.gz";
  const name = `OpenChatGPTSkin_${manifest.version}_${
    manifest.target.platform === "win32" ? "windows" : "darwin"
  }_${manifest.target.arch}${suffix}`;
  await mkdir(outputDirectory, { recursive: true });
  const output = join(outputDirectory, name);
  await ensureMissing(output);
  const parent = dirname(releaseRoot);
  const directory = basename(releaseRoot);
  if (manifest.target.platform === "win32") {
    await runReleaseCommand(
      "7z",
      ["a", "-tzip", "-mx=9", output, directory],
      { cwd: parent },
    );
  } else {
    await runReleaseCommand(
      "tar",
      ["-czf", output, "-C", parent, directory],
    );
  }
  const bytes = await readFile(output);
  return {
    path: output,
    name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function writeReleaseChecksums(
  outputDirectoryInput: string,
): Promise<string> {
  const outputDirectory = resolve(outputDirectoryInput);
  const files = (await readdir(outputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() &&
      (entry.name.endsWith(".zip") || entry.name.endsWith(".tar.gz") || entry.name.endsWith(".exe")))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error("No Release artifacts are available for checksums");
  const lines: string[] = [];
  for (const file of files) {
    const path = join(outputDirectory, file);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Release artifact is not a file: ${file}`);
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    lines.push(`${digest}  ${file}`);
  }
  const checksums = join(outputDirectory, "checksums.txt");
  await writeFile(checksums, `${lines.join("\n")}\n`, "utf8");
  return checksums;
}
