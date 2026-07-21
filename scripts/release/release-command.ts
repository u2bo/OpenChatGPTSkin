import { spawn } from "node:child_process";

export interface ReleaseCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export async function runReleaseCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly captureOutput?: boolean;
  } = {},
): Promise<ReleaseCommandResult> {
  const captureOutput = options.captureOutput ?? false;
  return await new Promise<ReleaseCommandResult>((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) {
        resolveRun(result);
        return;
      }
      const detail = result.stderr.trim();
      rejectRun(new Error(
        `${command} exited with code ${String(code)}${detail ? `: ${detail}` : ""}`,
      ));
    });
  });
}
