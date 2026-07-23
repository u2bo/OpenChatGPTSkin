import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StudioEventSchema } from "@open-chatgpt-skin/theme-studio-core";
import {
  startThemeStudioServer,
  ThemeStudioWorkspace,
  type RunningThemeStudioServer,
} from "@open-chatgpt-skin/theme-studio-service";
import { createRuntimePaths } from "@open-chatgpt-skin/windows-runtime";

const running: RunningThemeStudioServer[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

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

function tokenFrom(url: string): string {
  return new URLSearchParams(new URL(url).hash.slice(1)).get("bootstrap")!;
}

async function createServer(): Promise<RunningThemeStudioServer> {
  const server = await startThemeStudioServer({
    studioVersion: "0.1.0",
    runtimeStatus: async () => stopped,
    indexHtml: "<!doctype html><title>Theme Studio</title>",
  });
  running.push(server);
  return server;
}

describe("Theme Studio loopback service", () => {
  it("exchanges once and returns authenticated bootstrap", async () => {
    const server = await createServer();
    const token = tokenFrom(server.bootstrapUrl);
    const exchange = await fetch(`${server.origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ token }),
    });

    expect(exchange.status).toBe(204);
    const setCookie = exchange.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const cookie = setCookie.split(";")[0]!;

    const bootstrap = await fetch(`${server.origin}/api/bootstrap`, {
      headers: { Cookie: cookie },
    });
    await expect(bootstrap.json()).resolves.toMatchObject({
      protocolVersion: 2,
      capabilities: ["studio-shell"],
      runtime: { status: "stopped" },
    });
    expect((await fetch(`${server.origin}/api/bootstrap`)).status).toBe(401);
    expect((await fetch(`${server.origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ token }),
    })).status).toBe(401);
  });

  it("rejects cross-origin, malformed, and oversized exchanges", async () => {
    const server = await createServer();
    const endpoint = `${server.origin}/api/session`;

    expect((await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.invalid" },
      body: JSON.stringify({ token: tokenFrom(server.bootstrapUrl) }),
    })).status).toBe(403);
    expect((await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: "{",
    })).status).toBe(400);
    expect((await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ token: "a".repeat(17 * 1024) }),
    })).status).toBe(413);
  });

  it("streams authenticated Runtime status events", async () => {
    const server = await createServer();
    const exchange = await fetch(`${server.origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ token: tokenFrom(server.bootstrapUrl) }),
    });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const controller = new AbortController();
    const response = await fetch(`${server.origin}/api/events`, {
      headers: { Cookie: cookie },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";

    while (!text.includes("\n\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE ended before its first frame");
      text += decoder.decode(chunk.value, { stream: true });
    }

    const data = text
      .split("\n")
      .find((line) => line.startsWith("data: "))!
      .slice(6);
    expect(StudioEventSchema.parse(JSON.parse(data))).toMatchObject({
      kind: "runtime-status",
      runtime: { status: "stopped" },
    });

    await reader.cancel();
    controller.abort();
  });

  it("serves the authenticated theme draft, version save, and export closure", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-studio-http-"));
    temporaryRoots.push(root);
    const workspace = new ThemeStudioWorkspace({
      paths: createRuntimePaths(root, resolve(".")),
      runtimeStatus: async () => stopped,
      applyRuntimeTheme: async (ref) => ({
        ...stopped,
        status: "active",
        controllerAvailable: true,
        selectedTheme: ref,
        appliedTheme: ref,
        skinApplied: true,
      }),
      restoreRuntimeTheme: async () => stopped,
    });
    await workspace.initialize();
    const server = await startThemeStudioServer({
      studioVersion: "0.1.0",
      runtimeStatus: async () => stopped,
      workspace,
      indexHtml: "<!doctype html><title>Theme Studio</title>",
    });
    running.push(server);

    const exchange = await fetch(`${server.origin}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ token: tokenFrom(server.bootstrapUrl) }),
    });
    const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { Cookie: cookie, Origin: server.origin, "Content-Type": "application/json" };

    const themesResponse = await fetch(`${server.origin}/api/themes`, {
      headers: { Cookie: cookie },
    });
    const themes = await themesResponse.json() as {
      themes: { ref: { id: string; version: string }; source: string }[];
    };
    const source = themes.themes.find((theme) => theme.ref.id === "mountain-mist")!;
    expect(themes.themes).toHaveLength(5);

    const directlyApplied = await fetch(`${server.origin}/api/themes/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify(source.ref),
    });
    expect(directlyApplied.status).toBe(200);
    await expect(directlyApplied.json()).resolves.toMatchObject({
      status: "active",
      appliedTheme: source.ref,
    });

    const create = await fetch(`${server.origin}/api/drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: { source: source.source, ref: source.ref } }),
    });
    expect(create.status).toBe(201);
    const draft = await create.json() as { draftId: string; revision: number };
    const save = await fetch(`${server.origin}/api/drafts/${draft.draftId}/save`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: draft.revision }),
    });
    expect(save.status).toBe(200);
    const saved = await save.json() as {
      ref: { id: string; version: string };
    };

    const exported = await fetch(
      `${server.origin}/api/export?id=${saved.ref.id}&version=${saved.ref.version}`,
      { headers: { Cookie: cookie } },
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe(
      "application/vnd.open-chatgpt-skin+zip",
    );
    expect((await exported.arrayBuffer()).byteLength).toBeGreaterThan(100);

    const restored = await fetch(`${server.origin}/api/runtime/restore`, {
      method: "POST",
      headers,
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({ status: "stopped" });
  });
});
