import { resolve } from "node:path";
import { acceptGoReleasePackages } from "./go-release.js";
import { releaseOption } from "./options.js";

try {
  const args = process.argv.slice(2);
  const output = resolve(releaseOption(args, "--output") ?? "artifacts/release");
  const result = await acceptGoReleasePackages(output, args.includes("--require-all-native"));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: "GO_RELEASE_ACCEPTANCE_FAILED", message: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`);
  process.exitCode = 1;
}
