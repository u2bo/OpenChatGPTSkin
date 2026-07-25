import { resolve } from "node:path";
import { acceptGoReleasePackages, mergeGoReleasePackages } from "./go-release.js";
import { releaseOption } from "./options.js";

try {
  const args = process.argv.slice(2);
  const inputs = args.flatMap((argument, index) =>
    argument === "--input" && args[index + 1] ? [resolve(args[index + 1]!)] : []
  );
  const output = resolve(releaseOption(args, "--output") ?? "artifacts/release-combined");
  const report = await mergeGoReleasePackages(inputs, output);
  const acceptance = await acceptGoReleasePackages(output, true);
  process.stdout.write(`${JSON.stringify({ report, acceptance }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: "GO_RELEASE_MERGE_FAILED", message: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`);
  process.exitCode = 1;
}
