import { resolve } from "node:path";
import {
  acceptReleasePayload,
  RELEASE_ACCEPTANCE_SCENARIOS,
  type ReleaseAcceptanceScenario,
} from "./acceptance.js";
import { releaseOption, requiredReleaseOption } from "./options.js";
import { writeReleaseReport } from "./report.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenario = releaseOption(args, "--scenario") ?? "staged-payload";
  if (!RELEASE_ACCEPTANCE_SCENARIOS.includes(
    scenario as ReleaseAcceptanceScenario,
  )) {
    throw new Error(`Release acceptance scenario is invalid: ${scenario}`);
  }
  const report = await acceptReleasePayload(
    resolve(requiredReleaseOption(args, "--release-root")),
    scenario as ReleaseAcceptanceScenario,
  );
  await writeReleaseReport(releaseOption(args, "--report"), report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch(async (error: unknown) => {
  const args = process.argv.slice(2);
  await writeReleaseReport(releaseOption(args, "--report"), {
    scenario: releaseOption(args, "--scenario") ?? "staged-payload",
    error: { code: "RELEASE_ACCEPTANCE_FAILED" },
  });
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "RELEASE_ACCEPTANCE_FAILED",
      message: error instanceof Error ? error.message : "Release acceptance failed",
    },
  })}\n`);
  process.exitCode = 1;
});
