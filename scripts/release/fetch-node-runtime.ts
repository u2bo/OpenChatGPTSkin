import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { requiredReleaseOption } from "./options.js";

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Node Runtime download failed with HTTP ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const version = requiredReleaseOption(args, "--version");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Node Runtime version is invalid: ${version}`);
  }
  const platform = requiredReleaseOption(args, "--platform");
  const arch = requiredReleaseOption(args, "--arch");
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`Node Runtime platform is unsupported: ${platform}`);
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Node Runtime architecture is unsupported: ${arch}`);
  }
  const nodePlatform = platform === "win32" ? "win" : "darwin";
  const extension = platform === "win32" ? "zip" : "tar.gz";
  const archiveName = `node-v${version}-${nodePlatform}-${arch}.${extension}`;
  const rootDirectory = `node-v${version}-${nodePlatform}-${arch}`;
  const baseUrl = `https://nodejs.org/dist/v${version}`;
  const [checksums, archive] = await Promise.all([
    download(`${baseUrl}/SHASUMS256.txt`),
    download(`${baseUrl}/${archiveName}`),
  ]);
  const checksumLine = checksums.toString("utf8")
    .split(/\r?\n/)
    .find((line) => line.endsWith(`  ${archiveName}`));
  if (!checksumLine) {
    throw new Error(`Official Node Runtime checksum is missing: ${archiveName}`);
  }
  const expected = checksumLine.split(/\s+/, 1)[0]!;
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) {
    throw new Error(`Official Node Runtime checksum mismatch: ${archiveName}`);
  }
  const output = resolve(requiredReleaseOption(args, "--output"));
  await mkdir(output, { recursive: true });
  const archivePath = join(output, archiveName);
  await writeFile(archivePath, archive);
  process.stdout.write(`${JSON.stringify({
    archivePath,
    archiveName,
    rootDirectory,
    sha256: actual,
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "NODE_RUNTIME_FETCH_FAILED",
      message: error instanceof Error ? error.message : "Node Runtime download failed",
    },
  })}\n`);
  process.exitCode = 1;
});
