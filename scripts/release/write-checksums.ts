import { resolve } from "node:path";
import { requiredReleaseOption } from "./options.js";
import { writeReleaseChecksums } from "./package-portable.js";

const args = process.argv.slice(2);
const output = requiredReleaseOption(args, "--output");

writeReleaseChecksums(resolve(output))
  .then((path) => process.stdout.write(`${JSON.stringify({ checksums: path })}\n`))
  .catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      error: {
        code: "RELEASE_CHECKSUM_FAILED",
        message: error instanceof Error ? error.message : "Release checksum generation failed",
      },
    })}\n`);
    process.exitCode = 1;
  });
