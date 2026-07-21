import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startThemeStudioDevHost,
  type RunningThemeStudioDevHost,
} from "@open-chatgpt-skin/theme-studio-service";

const running: RunningThemeStudioDevHost[] = [];
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
});
