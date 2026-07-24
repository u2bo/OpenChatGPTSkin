import { resolve } from "node:path";
import { acceptGoSpikePackages, mergeGoSpikePackages } from "./go-spike.js";
import { releaseOption } from "./options.js";

try {
  const args = process.argv.slice(2);
  const inputs = args.flatMap((argument, index) =>
    argument === "--input" && args[index + 1] ? [resolve(args[index + 1]!)] : []
  );
  const output = resolve(releaseOption(args, "--output") ?? "artifacts/go-spike-combined");
  const report = await mergeGoSpikePackages(inputs, output);
  const acceptance = await acceptGoSpikePackages(output, true);
  process.stdout.write(`${JSON.stringify({ report, acceptance }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: "GO_SPIKE_MERGE_FAILED", message: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`);
  process.exitCode = 1;
}
