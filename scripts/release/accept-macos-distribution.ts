import { resolve } from "node:path";
import {
  acceptMacDmg,
  MacDmgCleanupError,
} from "./macos-acceptance.js";
import {
  releaseOption,
  requiredReleaseOption,
} from "./options.js";
import { writeReleaseReport } from "./report.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const report = await acceptMacDmg(
    resolve(requiredReleaseOption(args, "--dmg")),
  );
  await writeReleaseReport(releaseOption(args, "--report"), report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch(async (error: unknown) => {
  const code = error instanceof MacDmgCleanupError
    ? "MACOS_DMG_CLEANUP_FAILED"
    : "MACOS_DMG_ACCEPTANCE_FAILED";
  const publicError = {
    code,
    message: "The macOS distribution did not pass acceptance.",
    nextAction: "Review the redacted acceptance diagnostics and retry.",
  };
  try {
    await writeReleaseReport(
      releaseOption(process.argv.slice(2), "--report"),
      { scenario: "macos-dmg", error: { code } },
    );
  } catch {
    process.stderr.write(`${JSON.stringify({
      error: {
        code: "MACOS_DMG_REPORT_FAILED",
        message: "The macOS acceptance report could not be written.",
      },
    })}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${JSON.stringify({ error: publicError })}\n`);
  process.exitCode = 1;
});
