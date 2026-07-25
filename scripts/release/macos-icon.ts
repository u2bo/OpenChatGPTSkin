import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const MAC_ICON_ENTRIES = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
] as const;

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`macOS icon output already exists: ${path}`);
}

export async function generateMacIcon(svgPathInput: string, icnsPathInput: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("macOS icon generation requires Darwin");
  const svgPath = resolve(svgPathInput);
  const icnsPath = resolve(icnsPathInput);
  const iconset = `${icnsPath}.iconset`;
  await access(svgPath);
  await assertMissing(icnsPath);
  await mkdir(iconset);
  let failure: unknown;
  try {
    const source = await readFile(svgPath);
    for (const [name, size] of MAC_ICON_ENTRIES) {
      await sharp(source).resize(size, size).png().toFile(join(iconset, name));
    }
    await execFileAsync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", icnsPath]);
    await access(icnsPath);
  } catch (error) {
    failure = error;
  }
  try {
    await rm(iconset, { recursive: true, force: true });
    if (failure) await rm(icnsPath, { force: true });
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError([failure, cleanupError], "macOS icon generation and cleanup failed")
      : cleanupError;
  }
  if (failure) throw failure;
}
