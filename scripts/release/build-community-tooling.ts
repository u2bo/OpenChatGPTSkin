import { resolve } from "node:path";
import { buildCommunityTooling } from "./community-tooling.js";
import { requiredReleaseOption } from "./options.js";

try {
  const outputDirectory = resolve(
    requiredReleaseOption(process.argv.slice(2), "--output"),
  );
  const manifest = await buildCommunityTooling({
    workspaceRoot: process.cwd(),
    outputDirectory,
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "COMMUNITY_TOOLING_BUILD_FAILED",
      message: error instanceof Error ? error.message : String(error),
    },
  })}\n`);
  process.exitCode = 1;
}
