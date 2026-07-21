import { resolve } from "node:path";
import {
  packagePortableRelease,
  writeReleaseChecksums,
} from "./package-portable.js";
import { requiredReleaseOption } from "./options.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputDirectory = resolve(requiredReleaseOption(args, "--output"));
  const artifact = await packagePortableRelease(
    resolve(requiredReleaseOption(args, "--release-root")),
    outputDirectory,
  );
  const checksums = await writeReleaseChecksums(outputDirectory);
  process.stdout.write(`${JSON.stringify({ artifact, checksums })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "RELEASE_PACKAGE_FAILED",
      message: error instanceof Error ? error.message : "Release packaging failed",
    },
  })}\n`);
  process.exitCode = 1;
});
