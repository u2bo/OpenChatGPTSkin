import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  startThemeStudioDevHost,
  startThemeStudioProductionHost,
  type RunningThemeStudioDevHost,
} from "@open-chatgpt-skin/theme-studio-service";

const running: RunningThemeStudioDevHost[] = [];
const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const stopped = {
  status: "stopped" as const,
  controllerAvailable: false,
  selectedTheme: null,
  appliedTheme: null,
  skinApplied: false,
  packageVersion: null,
  operation: null,
  nextAction: "No managed session.",
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((host) => host.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("Theme Studio development host", () => {
  it("serves UI middleware and API from the same loopback origin", async () => {
    const middleware = vi.fn(async (_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>Vite Theme Studio</title>");
      return true;
    });
    const host = await startThemeStudioDevHost({
      createMiddleware: async () => ({
        handle: middleware,
        close: vi.fn(async () => undefined),
      }),
      runtimeStatus: async () => stopped,
    });
    running.push(host);

    const response = await fetch(host.bootstrapUrl.split("#")[0]!);
    expect(await response.text()).toContain("Vite Theme Studio");
    expect(new URL(host.bootstrapUrl).hostname).toBe("127.0.0.1");
    expect(middleware).toHaveBeenCalledOnce();
  });

  it("serves the real Vite application with nonce-based security headers", async () => {
    const host = await startThemeStudioDevHost({
      runtimeStatus: async () => stopped,
    });
    running.push(host);

    const response = await fetch(host.bootstrapUrl.split("#")[0]!);
    const html = await response.text();
    const contentSecurityPolicy = response.headers.get("content-security-policy");

    expect(response.status).toBe(200);
    expect(html).toContain("OpenChatGPTSkin Theme Studio");
    expect(html).toContain("/@vite/client");
    expect(contentSecurityPolicy).toMatch(
      /script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/,
    );
    expect(contentSecurityPolicy).toContain(
      `connect-src 'self' ${host.origin.replace(/^http:/, "ws:")}`,
    );
    const nonce = contentSecurityPolicy!.match(/'nonce-([^']+)'/)![1]!;
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).toContain("property=\"csp-nonce\"");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("serves a nonce-bound production single-file application without Vite", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-production-host-"));
    temporaryRoots.push(root);
    const indexHtmlPath = join(root, "theme-studio.html");
    await writeFile(
      indexHtmlPath,
      [
        "<!doctype html>",
        "<html><head>",
        '<meta property="csp-nonce" nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__">',
        '<style nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__">body{margin:0}</style>',
        "</head><body><div id=\"root\"></div>",
        '<script type="module" nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__">window.__studio=true</script>',
        "</body></html>",
      ].join(""),
      "utf8",
    );

    const host = await startThemeStudioProductionHost({
      indexHtmlPath,
      runtimeStatus: async () => stopped,
    });
    running.push(host);

    const response = await fetch(host.bootstrapUrl.split("#")[0]!);
    const html = await response.text();
    const contentSecurityPolicy = response.headers.get("content-security-policy")!;
    const nonce = contentSecurityPolicy.match(/'nonce-([^']+)'/)![1]!;

    expect(response.status).toBe(200);
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).not.toContain("__OPEN_CHATGPT_SKIN_CSP_NONCE__");
    expect(html).not.toContain("/@vite/client");
    const directives = new Map(contentSecurityPolicy.split(";").map((value) => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, sources];
    }));
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("style-src")).not.toContain("'unsafe-inline'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("reports a production startup failure and writes a sanitized diagnostic log", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-production-failure-"));
    temporaryRoots.push(root);
    const installRoot = join(root, "install");
    const localAppData = join(root, "local-app-data");
    await mkdir(installRoot);
    const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    let stderr = "";

    try {
      await execFileAsync(process.execPath, [
        tsxCli,
        join(process.cwd(), "runtime", "theme-studio-service", "src", "cli.ts"),
        "--no-open",
      ], {
        env: {
          ...process.env,
          LOCALAPPDATA: localAppData,
          OPEN_CHATGPT_SKIN_INSTALL_ROOT: installRoot,
          OPEN_CHATGPT_SKIN_VERSION: "0.1.0-alpha.1",
        },
      });
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? "");
    }

    const failure = JSON.parse(stderr.trim()) as {
      error: {
        code: string;
        message: string;
        nextAction: string;
        log: string;
      };
    };
    expect(failure.error).toMatchObject({
      code: "INTERNAL",
      message: "Theme Studio failed to start.",
      log: "%LOCALAPPDATA%\\OpenChatGPTSkin\\runtime\\logs\\theme-studio.jsonl",
    });
    expect(failure.error.nextAction).toContain("startup log");

    const log = await readFile(join(
      localAppData,
      "OpenChatGPTSkin",
      "runtime",
      "logs",
      "theme-studio.jsonl",
    ), "utf8");
    expect(log).toContain('"event":"studio-startup-error"');
    expect(log).toContain('"errorCode":"INTERNAL"');
    expect(log).not.toContain(root);
  });
});
