import {
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildMacAppBundle } from "./macos-app.js";
import {
  buildMacDmg,
  generateMacIcon,
  type MacDmgArtifact,
} from "./macos-dmg.js";
import { requiredReleaseOption } from "./options.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const releaseRoot = resolve(requiredReleaseOption(args, "--release-root"));
  const output = resolve(requiredReleaseOption(args, "--output"));
  const iconSource = resolve(requiredReleaseOption(args, "--icon-source"));
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(
    join(tmpdir(), "open-chatgpt-skin-macos-"),
  );
  let artifact: MacDmgArtifact | undefined;
  let failure: unknown;
  try {
    const iconPath = join(temporary, "AppIcon.icns");
    await generateMacIcon(iconSource, iconPath);
    const app = await buildMacAppBundle({
      releaseRoot,
      outputDirectory: temporary,
      iconPath,
    });
    artifact = await buildMacDmg({
      appPath: app.appPath,
      outputDirectory: output,
      version: app.version,
      arch: app.arch,
    });
  } catch (error) {
    failure = error;
  }
  try {
    await rm(temporary, { recursive: true, force: true });
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "macOS build cleanup failed")
      : error;
  }
  if (failure) throw failure;
  if (!artifact) throw new Error("macOS build produced no artifact");
  const { name, bytes, sha256 } = artifact;
  process.stdout.write(`${JSON.stringify({
    artifact: { name, bytes, sha256 },
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "MACOS_DISTRIBUTION_FAILED",
      message: "The macOS distribution could not be built.",
      nextAction: "Review the macOS build diagnostics and retry.",
      errorType: error instanceof Error ? error.name : "UnknownError",
    },
  })}\n`);
  process.exitCode = 1;
});
