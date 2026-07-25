import { resolve } from "node:path";
import { buildGoSpikePackages } from "./go-spike.js";
import { releaseOption } from "./options.js";

try {
  const args = process.argv.slice(2);
  const output = resolve(releaseOption(args, "--output") ?? "artifacts/go-spike");
  const report = await buildGoSpikePackages({
    workspaceRoot: process.cwd(),
    outputDirectory: output,
    nativeInstallers: !args.includes("--portable-only"),
    nativeArtifactsOnly: args.includes("--native-only"),
    onProgress: (message) => process.stderr.write(`[go-package] ${message}\n`),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: "GO_SPIKE_PACKAGE_FAILED", message: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`);
  process.exitCode = 1;
}
