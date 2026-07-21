import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface CommandRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly shell: false;
  readonly env?: Readonly<Record<string, string>>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

export const nodeCommandRunner: CommandRunner = {
  run: (request) => new Promise((resolve, reject) => {
    const child = spawn(request.executable, [...request.args], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      ...(request.env ? { env: { ...process.env, ...request.env } } : {}),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const append = (target: "stdout" | "stderr", chunk: string) => {
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES || Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        fail(new Error("command output exceeds 1 MB"));
      }
    };
    const timer = setTimeout(() => fail(new Error("command timed out")), request.timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => append("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => append("stderr", chunk));
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.stdin.end(request.stdin);
  }),
};
