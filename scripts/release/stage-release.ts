import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { releaseOption, requiredReleaseOption } from "./options.js";
import { stageReleasePayload } from "./payload.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspaceRoot = resolve(releaseOption(args, "--workspace") ?? ".");
  const rootPackage = JSON.parse(
    await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
  ) as { version?: string };
  const version = releaseOption(args, "--version") ?? rootPackage.version;
  if (!version) throw new Error("Root package version is missing");
  const platform = (releaseOption(args, "--platform") ?? process.platform) as
    "win32" | "darwin";
  const arch = (releaseOption(args, "--arch") ?? process.arch) as "x64" | "arm64";
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`Unsupported release platform: ${platform}`);
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported release architecture: ${arch}`);
  }

  const manifest = await stageReleasePayload({
    workspaceRoot,
    releaseRoot: resolve(requiredReleaseOption(args, "--output")),
    version,
    platform,
    arch,
    nodeVersion: releaseOption(args, "--node-version") ?? process.versions.node,
    buildCommit: requiredReleaseOption(args, "--build-commit"),
    nodeExecutablePath: resolve(releaseOption(args, "--node-executable") ?? process.execPath),
    nodeLicensePath: resolve(requiredReleaseOption(args, "--node-license")),
  });
  process.stdout.write(`${JSON.stringify({
    product: manifest.product,
    version: manifest.version,
    target: manifest.target,
    files: Object.keys(manifest.files).length,
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "RELEASE_STAGE_FAILED",
      message: error instanceof Error ? error.message : "Release staging failed",
    },
  })}\n`);
  process.exitCode = 1;
});
