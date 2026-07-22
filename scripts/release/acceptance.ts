import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { Script } from "node:vm";
import { parseHTML } from "linkedom";
import {
  readReleaseManifest,
  type ReleaseManifest,
} from "./payload.js";

export interface ReleasePayloadVerification {
  readonly version: string;
  readonly target: ReleaseManifest["target"];
  readonly filesVerified: number;
  readonly bytesVerified: number;
}

export const RELEASE_ACCEPTANCE_SCENARIOS = [
  "staged-payload",
  "portable-archive",
  "installed-payload",
  "macos-app-bundle",
] as const;

export type ReleaseAcceptanceScenario =
  typeof RELEASE_ACCEPTANCE_SCENARIOS[number];

const INSTALLED_PAYLOAD_FILES = new Set([
  "unins000.dat",
  "unins000.exe",
]);

export interface ReleaseAcceptanceReport extends ReleasePayloadVerification {
  readonly scenario: ReleaseAcceptanceScenario;
  readonly durationMs: number;
  readonly steps: {
    readonly manifest: "passed";
    readonly nodeRuntime: "passed";
    readonly productionUi: "passed";
    readonly session: "passed";
    readonly runtimeStatus: "passed";
    readonly themes: "passed";
    readonly imageProcessing: "passed";
    readonly themeExport: "passed";
    readonly gracefulExit: "passed";
  };
  readonly uiVerified: true;
  readonly themesVerified: number;
  readonly imageProcessingVerified: true;
  readonly exportBytes: number;
  readonly gracefulExitVerified: true;
}

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

interface HttpInput {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
}

const START_TIMEOUT_MS = 15_000;
const EXIT_TIMEOUT_MS = 5_000;
const NODE_VERSION_TIMEOUT_MS = 5_000;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function isolatedChildEnvironment(
  nodeExecutable: string,
  releaseRoot: string,
  dataRoot: string,
  manifest: ReleaseManifest,
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => {
    const upper = key.toUpperCase();
    return upper !== "PATH" && !upper.startsWith("NODE_");
  }));
  return {
    ...inherited,
    PATH: dirname(nodeExecutable),
    OPEN_CHATGPT_SKIN_INSTALL_ROOT: releaseRoot,
    OPEN_CHATGPT_SKIN_VERSION: manifest.version,
    ...(process.platform === "win32"
      ? { LOCALAPPDATA: dataRoot }
      : { HOME: dataRoot }),
  };
}

function verifyBundledNodeRuntime(
  executable: string,
  environment: NodeJS.ProcessEnv,
  expectedVersion: string,
): Promise<void> {
  return new Promise<void>((resolveVersion, rejectVersion) => {
    const child = spawn(executable, ["--version"], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => rejectVersion(new Error("Bundled Node Runtime version probe timed out")));
    }, NODE_VERSION_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-1_024);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-1_024);
    });
    child.once("error", (error) => settle(() => rejectVersion(error)));
    child.once("exit", (code) => settle(() => {
      const actual = stdout.trim();
      if (code !== 0) {
        rejectVersion(new Error(
          `Bundled Node Runtime version probe exited with code ${String(code)}: ${stderr.trim()}`,
        ));
      } else if (actual !== `v${expectedVersion}`) {
        rejectVersion(new Error(
          `Bundled Node Runtime version mismatch: expected v${expectedVersion}, received ${actual || "empty"}`,
        ));
      } else {
        resolveVersion();
      }
    }));
  });
}

async function payloadFiles(
  root: string,
  current: string = root,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Release payload contains a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...await payloadFiles(root, path));
    } else if (entry.isFile()) {
      files.push(portablePath(relative(root, path)));
    }
  }
  return files.sort();
}

export async function verifyReleasePayload(
  releaseRoot: string,
  scenario: ReleaseAcceptanceScenario = "staged-payload",
): Promise<ReleasePayloadVerification> {
  const manifest = await readReleaseManifest(releaseRoot);
  const listed = Object.keys(manifest.files).sort();
  const actual = (await payloadFiles(releaseRoot))
    .filter((path) => path !== "release-manifest.json" &&
      !(scenario === "installed-payload" && INSTALLED_PAYLOAD_FILES.has(path)));
  if (JSON.stringify(listed) !== JSON.stringify(actual)) {
    throw new Error("Release manifest file list does not match the payload");
  }

  let bytesVerified = 0;
  for (const path of listed) {
    if (/source\.png$/i.test(path) ||
      /^docs\/superpowers\/|^docs\/assets\/design-qa\/|^node_modules\/vite\/|\.map$|\.d\.(?:c|m)?ts$|\.tsbuildinfo$/.test(path)) {
      throw new Error(`Release payload contains a forbidden file: ${path}`);
    }
    const bytes = await readFile(join(releaseRoot, ...path.split("/")));
    const expected = manifest.files[path]!;
    if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error(`Release payload checksum mismatch: ${path}`);
    }
    bytesVerified += bytes.length;
  }
  return {
    version: manifest.version,
    target: manifest.target,
    filesVerified: listed.length,
    bytesVerified,
  };
}

function httpRequest(url: string, input: HttpInput = {}): Promise<HttpResult> {
  return new Promise<HttpResult>((resolveRequest, rejectRequest) => {
    const outgoing = request(url, {
      method: input.method ?? "GET",
      headers: {
        ...(input.body ? { "Content-Length": String(input.body.length) } : {}),
        ...input.headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.once("end", () => resolveRequest({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    outgoing.once("error", rejectRequest);
    if (input.body) outgoing.write(input.body);
    outgoing.end();
  });
}

function jsonBody<T>(result: HttpResult): T {
  return JSON.parse(result.body.toString("utf8")) as T;
}

function waitForBootstrapUrl(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolveUrl, rejectUrl) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      rejectUrl(new Error(`Release process did not become ready: ${stderr.slice(-2_000)}`));
    }, START_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      while (stdout.includes("\n")) {
        const newline = stdout.indexOf("\n");
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as { url?: unknown };
          if (typeof parsed.url === "string") {
            cleanup();
            resolveUrl(parsed.url);
            return;
          }
        } catch {
          // Preserve non-JSON output for the timeout diagnostic.
        }
      }
    };
    const onStderr = (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000);
    };
    const onError = (error: Error) => {
      cleanup();
      rejectUrl(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      rejectUrl(new Error(
        `Release process exited before startup with code ${String(code)}: ${stderr.slice(-2_000)}`,
      ));
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function stopGracefully(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null) return true;
  const exited = new Promise<boolean>((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), EXIT_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
  child.kill("SIGTERM");
  const graceful = await exited;
  if (!graceful && child.exitCode === null) child.kill("SIGKILL");
  return graceful;
}

function expectStatus(result: HttpResult, expected: number, step: string): void {
  if (result.status !== expected) {
    throw new Error(
      `${step} returned HTTP ${result.status}: ${result.body.toString("utf8").slice(0, 1_000)}`,
    );
  }
}

export async function acceptReleasePayload(
  releaseRoot: string,
  scenario: ReleaseAcceptanceScenario = "staged-payload",
): Promise<ReleaseAcceptanceReport> {
  const startedAt = Date.now();
  const verification = await verifyReleasePayload(releaseRoot, scenario);
  const manifest = await readReleaseManifest(releaseRoot);
  if (manifest.target.platform !== process.platform || manifest.target.arch !== process.arch) {
    throw new Error(
      `Release target ${manifest.target.platform}/${manifest.target.arch} cannot run on ${process.platform}/${process.arch}`,
    );
  }
  const dataRoot = await mkdtemp(join(tmpdir(), "open-chatgpt-skin-release-acceptance-"));
  const nodeExecutable = join(
    releaseRoot,
    "runtime",
    manifest.target.platform === "win32" ? "node.exe" : "node",
  );
  const serviceCli = join(
    releaseRoot,
    "node_modules",
    "@open-chatgpt-skin",
    "theme-studio-service",
    "dist",
    "cli.js",
  );
  const acceptanceImage = await readFile(join(
    releaseRoot,
    "themes",
    "builtin",
    "mountain-mist",
    "assets",
    "background.webp",
  ));
  const childEnvironment = isolatedChildEnvironment(
    nodeExecutable,
    releaseRoot,
    dataRoot,
    manifest,
  );
  await verifyBundledNodeRuntime(
    nodeExecutable,
    childEnvironment,
    manifest.runtime.nodeVersion,
  );
  const child = spawn(nodeExecutable, [serviceCli, "--no-open"], {
    cwd: releaseRoot,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let gracefulExitVerified = false;
  try {
    const bootstrapUrl = await waitForBootstrapUrl(child);
    const parsedUrl = new URL(bootstrapUrl);
    if (parsedUrl.hostname !== "127.0.0.1") {
      throw new Error(`Release Host is not loopback-only: ${parsedUrl.hostname}`);
    }
    const token = new URLSearchParams(parsedUrl.hash.slice(1)).get("bootstrap");
    if (!token) throw new Error("Release bootstrap token is missing");
    parsedUrl.hash = "";
    const origin = parsedUrl.origin;

    const page = await httpRequest(parsedUrl.href);
    expectStatus(page, 200, "Production UI");
    const html = page.body.toString("utf8");
    if (html.includes("/@vite/client") ||
      html.includes("__OPEN_CHATGPT_SKIN_CSP_NONCE__")) {
      throw new Error("Production UI contains development or unresolved nonce markers");
    }
    const csp = String(page.headers["content-security-policy"] ?? "");
    if (!csp.includes("script-src 'self' 'nonce-") ||
      !csp.includes("style-src 'self' 'nonce-") ||
      csp.match(/(?:script-src|style-src) [^;]*'unsafe-inline'/)) {
      throw new Error("Production UI CSP is not nonce-bound");
    }
    const scriptNonce = csp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
    const styleNonce = csp.match(/style-src[^;]*'nonce-([^']+)'/)?.[1];
    const { document } = parseHTML(html);
    const declaredNonce = document.querySelector('meta[property="csp-nonce"]')
      ?.getAttribute("nonce");
    const inlineAssets = [...document.querySelectorAll("script, style")];
    if (!scriptNonce || scriptNonce !== styleNonce || scriptNonce !== declaredNonce ||
      inlineAssets.length === 0 ||
      inlineAssets.some((element) => element.getAttribute("nonce") !== scriptNonce)) {
      throw new Error("Production UI inline assets are not nonce-bound");
    }
    for (const script of document.querySelectorAll("script")) {
      try {
        new Script(script.textContent, { filename: "theme-studio-inline.js" });
      } catch (error) {
        throw new Error(
          `Production UI inline script is not syntactically valid: ${String(error)}`,
        );
      }
    }
    if (String(page.headers["referrer-policy"] ?? "") !== "no-referrer" ||
      String(page.headers["x-frame-options"] ?? "") !== "DENY") {
      throw new Error("Production UI security headers are invalid");
    }

    const exchange = await httpRequest(`${origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: Buffer.from(JSON.stringify({ token })),
    });
    expectStatus(exchange, 204, "Session exchange");
    const setCookie = exchange.headers["set-cookie"]?.[0];
    const cookie = setCookie?.split(";", 1)[0];
    if (!cookie) throw new Error("Session exchange did not return a cookie");
    const authenticatedHeaders = { Cookie: cookie };
    const mutationHeaders = {
      ...authenticatedHeaders,
      Origin: origin,
      "Content-Type": "application/json",
    };

    const bootstrap = await httpRequest(`${origin}/api/bootstrap`, {
      headers: authenticatedHeaders,
    });
    expectStatus(bootstrap, 200, "Bootstrap");
    const bootstrapBody = jsonBody<{
      studioVersion?: string;
      runtime?: { status?: string };
    }>(bootstrap);
    if (bootstrapBody.studioVersion !== manifest.version ||
      bootstrapBody.runtime?.status !== "stopped") {
      throw new Error("Bootstrap version or initial Runtime status is invalid");
    }

    const themesResult = await httpRequest(`${origin}/api/themes`, {
      headers: authenticatedHeaders,
    });
    expectStatus(themesResult, 200, "Theme catalog");
    const themes = jsonBody<{
      themes: { source: string; ref: { id: string; version: string } }[];
    }>(themesResult).themes;
    if (themes.length !== manifest.themes.length ||
      manifest.themes.some((id) => !themes.some((theme) => theme.ref.id === id))) {
      throw new Error("Theme catalog does not match the Release manifest");
    }
    const source = themes.find((theme) => theme.ref.id === "mountain-mist")!;
    const created = await httpRequest(`${origin}/api/drafts`, {
      method: "POST",
      headers: mutationHeaders,
      body: Buffer.from(JSON.stringify({ source: { source: source.source, ref: source.ref } })),
    });
    expectStatus(created, 201, "Draft creation");
    const draft = jsonBody<{ draftId: string; revision: number }>(created);

    const upload = await httpRequest(
      `${origin}/api/drafts/${encodeURIComponent(draft.draftId)}/assets?revision=${draft.revision}&slot=background`,
      {
        method: "POST",
        headers: {
          ...authenticatedHeaders,
          Origin: origin,
          "Content-Type": "image/webp",
          "X-File-Name": "acceptance.webp",
        },
        body: acceptanceImage,
      },
    );
    expectStatus(upload, 200, "Image processing");
    const uploaded = jsonBody<{ revision: number }>(upload);

    const saved = await httpRequest(
      `${origin}/api/drafts/${encodeURIComponent(draft.draftId)}/save`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: Buffer.from(JSON.stringify({ expectedRevision: uploaded.revision })),
      },
    );
    expectStatus(saved, 200, "Theme save");
    const ref = jsonBody<{ ref: { id: string; version: string } }>(saved).ref;
    const exported = await httpRequest(
      `${origin}/api/export?id=${encodeURIComponent(ref.id)}&version=${encodeURIComponent(ref.version)}`,
      { headers: authenticatedHeaders },
    );
    expectStatus(exported, 200, "Theme export");
    if (exported.body.length === 0) throw new Error("Theme export is empty");

    gracefulExitVerified = await stopGracefully(child);
    if (!gracefulExitVerified) {
      throw new Error("Release process did not exit gracefully after SIGTERM");
    }
    return {
      ...verification,
      scenario,
      durationMs: Date.now() - startedAt,
      steps: {
        manifest: "passed",
        nodeRuntime: "passed",
        productionUi: "passed",
        session: "passed",
        runtimeStatus: "passed",
        themes: "passed",
        imageProcessing: "passed",
        themeExport: "passed",
        gracefulExit: "passed",
      },
      uiVerified: true,
      themesVerified: themes.length,
      imageProcessingVerified: true,
      exportBytes: exported.body.length,
      gracefulExitVerified: true,
    };
  } finally {
    if (!gracefulExitVerified) await stopGracefully(child);
    await rm(dataRoot, { recursive: true, force: true });
  }
}
