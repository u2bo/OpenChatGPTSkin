import { resolve } from "node:path";
import { buildGoReleasePackages } from "./go-release.js";
import { releaseOption } from "./options.js";

try {
  const args = process.argv.slice(2);
  const output = resolve(releaseOption(args, "--output") ?? "artifacts/release");
  const report = await buildGoReleasePackages({
    workspaceRoot: process.cwd(),
    outputDirectory: output,
    nativeInstallers: !args.includes("--portable-only"),
    nativeArtifactsOnly: args.includes("--native-only"),
    onProgress: (message) => process.stderr.write(`[release] ${message}\n`),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: "GO_RELEASE_BUILD_FAILED", message: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`);
  process.exitCode = 1;
}
