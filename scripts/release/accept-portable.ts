import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { acceptReleasePayload } from "./acceptance.js";
import { releaseOption, requiredReleaseOption } from "./options.js";
import { writeReleaseReport } from "./report.js";

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const archive = resolve(requiredReleaseOption(args, "--archive"));
  const extractionRoot = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-archive-"));
  try {
    if (basename(archive).endsWith(".zip")) {
      await run("7z", ["x", "-y", `-o${extractionRoot}`, archive]);
    } else if (basename(archive).endsWith(".tar.gz")) {
      await run("tar", ["-xzf", archive, "-C", extractionRoot]);
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
