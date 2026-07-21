import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { acceptReleasePayload } from "./acceptance.js";
import { releaseOption, requiredReleaseOption } from "./options.js";
import { writeReleaseReport } from "./report.js";
import { runReleaseCommand } from "./release-command.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const archive = resolve(requiredReleaseOption(args, "--archive"));
  const extractionRoot = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-archive-"));
  try {
    if (basename(archive).endsWith(".zip")) {
      await runReleaseCommand(
        "7z",
        ["x", "-y", `-o${extractionRoot}`, archive],
      );
    } else if (basename(archive).endsWith(".tar.gz")) {
      await runReleaseCommand(
        "tar",
        ["-xzf", archive, "-C", extractionRoot],
      );
    } else {
      throw new Error(`Unsupported Release archive: ${basename(archive)}`);
    }
    const report = await acceptReleasePayload(
      join(extractionRoot, "OpenChatGPTSkin"),
      "portable-archive",
    );
    const archiveReport = { archive: basename(archive), ...report };
    await writeReleaseReport(releaseOption(args, "--report"), archiveReport);
    process.stdout.write(`${JSON.stringify(archiveReport)}\n`);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

void main().catch(async (error: unknown) => {
  await writeReleaseReport(
    releaseOption(process.argv.slice(2), "--report"),
    {
      scenario: "portable-archive",
      error: { code: "RELEASE_ARCHIVE_ACCEPTANCE_FAILED" },
    },
  );
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "RELEASE_ARCHIVE_ACCEPTANCE_FAILED",
      message: error instanceof Error ? error.message : "Release archive acceptance failed",
    },
  })}\n`);
  process.exitCode = 1;
});
