import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(".");
const viteOrigin = "http://127.0.0.1:5173";
const buildRoot = await mkdtemp(join(tmpdir(), "openchatgptskin-dev-"));
const executable = join(buildRoot, process.platform === "win32" ? "OpenChatGPTSkin.exe" : "OpenChatGPTSkin");
const children = new Set<ChildProcess>();
let stopping = false;

function stop(exitCode: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  void rm(buildRoot, { recursive: true, force: true }).finally(() => {
    process.exitCode = exitCode;
  });
}

async function waitForVite(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(viteOrigin, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Vite owns readiness; connection refusal is expected during startup.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Vite did not become ready within 30 seconds");
}

try {
  await execFileAsync("go", [
    "-C", "host/go", "build", "-buildvcs=false", "-tags", "nodynamic",
    "-o", executable, "./cmd/openchatgptskin",
  ], { cwd: workspaceRoot, windowsHide: true });

  const vite = spawn(process.platform === "win32" ? "npm.cmd" : "npm", [
    "run", "dev", "-w", "@open-chatgpt-skin/theme-studio", "--",
    "--host", "127.0.0.1", "--port", "5173", "--strictPort",
  ], { cwd: workspaceRoot, stdio: "inherit", windowsHide: true });
  children.add(vite);
  vite.once("exit", (code) => stop(code ?? 1));
  await waitForVite();

  const host = spawn(executable, ["studio", "--dev", "--vite-origin", viteOrigin, "--no-open"], {
    cwd: workspaceRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(host);
  host.once("exit", (code) => stop(code ?? 1));
  process.once("SIGINT", () => stop(130));
  process.once("SIGTERM", () => stop(143));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  stop(1);
}
