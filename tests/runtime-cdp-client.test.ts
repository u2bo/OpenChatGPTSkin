import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import {
  CdpConnection,
  discoverBrowserWebSocket,
  discoverCdpTargets,
  selectCodexTarget,
  waitForCompatibleCodexTarget,
  waitForCodexTarget,
} from "@open-chatgpt-skin/cdp-adapter";

interface FakeTarget {
  readonly id: string;
  readonly type: string;
  readonly url: string;
}

interface FakeCdpOptions {
  readonly targets?: readonly FakeTarget[];
  readonly incompatibleTargetIds?: readonly string[];
  readonly websocketHost?: string;
  readonly redirectList?: boolean;
  readonly emptyTargetReads?: number;
}

interface FakeCdpFixture {
  readonly port: number;
  emit(method: string, params: unknown): void;
  emitRaw(value: string): void;
  disconnectClients(): void;
  close(): Promise<void>;
}

const fixtures: FakeCdpFixture[] = [];

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

async function startFakeCdp(options: FakeCdpOptions = {}): Promise<FakeCdpFixture> {
  const websocketServer = new WebSocketServer({ noServer: true });
  let targetReads = 0;
  websocketServer.on("connection", (websocket, request) => {
    const targetId = request.url?.split("/").at(-1);
    const target = (options.targets ?? [{
      id: "codex",
      type: "page",
      url: "https://chatgpt.com/codex",
    }]).find((candidate) => candidate.id === targetId);
    websocket.on("message", (data) => {
      const request = JSON.parse(data.toString()) as {
        readonly id: number;
        readonly method: string;
        readonly params?: Readonly<Record<string, unknown>>;
      };
      if (request.method === "Test.echo") {
        const value = request.params?.value;
        const delay = value === "slow" ? 20 : 0;
        setTimeout(() => websocket.send(JSON.stringify({
          id: request.id,
          result: { value },
        })), delay);
        return;
      }
      if (request.method === "Test.hold") return;
      if (request.method === "Runtime.evaluate") {
        const expression = request.params?.expression;
        const incompatible = targetId !== undefined &&
          (options.incompatibleTargetIds ?? []).includes(targetId);
        const value = expression === "window.location.href"
          ? target?.url
          : typeof expression === "string" && expression.includes("const visible")
            ? {
              main: true,
              navigation: !incompatible,
              composer: !incompatible,
            }
            : 4;
        websocket.send(JSON.stringify({
          id: request.id,
          result: { result: { value } },
        }));
        return;
      }
      websocket.send(JSON.stringify({ id: request.id, result: {} }));
    });
  });
  const server = createServer((request, response) => {
    const address = server.address() as AddressInfo;
    const websocketHost = options.websocketHost ?? "127.0.0.1";
    if (request.url === "/json/list" && options.redirectList) {
      response.writeHead(302, { location: "/json/list-redirected" });
      response.end();
      return;
    }
    if (request.url === "/json/version") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        webSocketDebuggerUrl: `ws://${websocketHost}:${address.port}/devtools/browser/test`,
      }));
      return;
    }
    if (request.url === "/json/list") {
      targetReads += 1;
      response.setHeader("content-type", "application/json");
      const targets = targetReads <= (options.emptyTargetReads ?? 0)
        ? []
        : (options.targets ?? [{
        id: "codex",
        type: "page",
        url: "https://chatgpt.com/codex",
      }]);
      response.end(JSON.stringify(targets.map((target) => ({
        ...target,
        title: "Codex",
        webSocketDebuggerUrl: `ws://${websocketHost}:${address.port}/devtools/page/${target.id}`,
      }))));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake CDP did not bind TCP");
  const fixture: FakeCdpFixture = {
    port: address.port,
    emit(method, params) {
      for (const client of websocketServer.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ method, params }));
        }
      }
    },
    emitRaw(value) {
      for (const client of websocketServer.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(value);
      }
    },
    disconnectClients() {
      for (const client of websocketServer.clients) client.terminate();
    },
    async close() {
      for (const client of websocketServer.clients) client.terminate();
      websocketServer.close();
      await closeServer(server);
    },
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("bounded CDP discovery", () => {
  it("accepts only same-port loopback target WebSocket URLs", async () => {
    const fixture = await startFakeCdp({
      targets: [{ id: "codex", type: "page", url: "https://chatgpt.com/codex" }],
    });

    const targets = await discoverCdpTargets({ host: "127.0.0.1", port: fixture.port });

    expect(selectCodexTarget(targets).id).toBe("codex");
  });

  it("rejects non-loopback WebSocket endpoints", async () => {
    const fixture = await startFakeCdp({ websocketHost: "192.168.1.10" });

    await expect(discoverCdpTargets({ host: "127.0.0.1", port: fixture.port }))
      .rejects.toMatchObject({ code: "CDP_ENDPOINT_UNSAFE" });
  });

  it("rejects redirected discovery responses", async () => {
    const fixture = await startFakeCdp({ redirectList: true });

    await expect(discoverCdpTargets({ host: "127.0.0.1", port: fixture.port }))
      .rejects.toMatchObject({ code: "CDP_ENDPOINT_UNSAFE" });
  });

  it("discovers only a same-port loopback browser WebSocket", async () => {
    const fixture = await startFakeCdp();

    await expect(discoverBrowserWebSocket({ host: "127.0.0.1", port: fixture.port }))
      .resolves.toBe(`ws://127.0.0.1:${fixture.port}/devtools/browser/test`);
  });

  it("waits for the allowed page target after the port becomes ready", async () => {
    const fixture = await startFakeCdp({ emptyTargetReads: 2 });

    const target = await waitForCodexTarget(
      { host: "127.0.0.1", port: fixture.port },
      { timeoutMs: 500, intervalMs: 5 },
    );

    expect(target.id).toBe("codex");
  });

  it("selects the only DOM-compatible app target instead of guessing by URL", async () => {
    const fixture = await startFakeCdp({
      targets: [
        { id: "background", type: "page", url: "app://-/index.html?background=1" },
        { id: "codex", type: "page", url: "app://-/index.html" },
      ],
      incompatibleTargetIds: ["background"],
    });

    const target = await waitForCompatibleCodexTarget(
      { host: "127.0.0.1", port: fixture.port },
      { timeoutMs: 500, intervalMs: 5 },
    );

    expect(target.id).toBe("codex");
  });

  it("prefers the canonical app renderer over compatible quick-chat and avatar renderers", async () => {
    const fixture = await startFakeCdp({
      targets: [
        { id: "quick-chat", type: "page", url: "app://-/index.html?initialRoute=%2Fchatgpt%2Fquick-chat-prewarm" },
        { id: "codex", type: "page", url: "app://-/index.html" },
        { id: "avatar", type: "page", url: "app://-/index.html?initialRoute=%2Favatar-overlay" },
      ],
    });

    const target = await waitForCompatibleCodexTarget(
      { host: "127.0.0.1", port: fixture.port },
      { timeoutMs: 500, intervalMs: 5 },
    );

    expect(target.id).toBe("codex");
  });

  it("rejects when more than one app target has Codex DOM capabilities", async () => {
    const fixture = await startFakeCdp({
      targets: [
        { id: "first", type: "page", url: "app://-/index.html?one=1" },
        { id: "second", type: "page", url: "app://-/index.html?two=1" },
      ],
    });

    await expect(waitForCompatibleCodexTarget(
      { host: "127.0.0.1", port: fixture.port },
      { timeoutMs: 500, intervalMs: 5 },
    )).rejects.toMatchObject({ code: "CDP_TARGET_AMBIGUOUS" });
  });
});

describe("CdpConnection", () => {
  it("correlates out-of-order responses and evaluates by value", async () => {
    const fixture = await startFakeCdp();
    const endpoint = { host: "127.0.0.1" as const, port: fixture.port };
    const connection = await CdpConnection.connect(
      await discoverBrowserWebSocket(endpoint),
      endpoint,
    );

    const [slow, fast, evaluated] = await Promise.all([
      connection.send<{ readonly value: string }>("Test.echo", { value: "slow" }),
      connection.send<{ readonly value: string }>("Test.echo", { value: "fast" }),
      connection.evaluate<number>("2 + 2"),
    ]);

    expect(slow.value).toBe("slow");
    expect(fast.value).toBe("fast");
    expect(evaluated).toBe(4);
    connection.close();
  });

  it("delivers protocol events and close notifications", async () => {
    const fixture = await startFakeCdp();
    const endpoint = { host: "127.0.0.1" as const, port: fixture.port };
    const connection = await CdpConnection.connect(
      await discoverBrowserWebSocket(endpoint),
      endpoint,
    );
    const event = new Promise<unknown>((resolveEvent) => {
      connection.on("Runtime.executionContextsCleared", resolveEvent);
    });
    const closed = new Promise<void>((resolveClose) => {
      connection.onClose(resolveClose);
    });

    fixture.emit("Runtime.executionContextsCleared", { reason: "reload" });
    await expect(event).resolves.toEqual({ reason: "reload" });
    fixture.disconnectClients();
    await closed;
  });

  it("rejects pending and subsequent requests after the target disconnects", async () => {
    const fixture = await startFakeCdp();
    const endpoint = { host: "127.0.0.1" as const, port: fixture.port };
    const connection = await CdpConnection.connect(
      await discoverBrowserWebSocket(endpoint),
      endpoint,
    );
    const closed = new Promise<void>((resolveClose) => {
      connection.onClose(resolveClose);
    });
    const pending = connection.send("Test.hold");

    fixture.disconnectClients();

    await expect(pending).rejects.toMatchObject({ code: "CDP_NOT_READY" });
    await closed;
    await expect(connection.send("Test.echo", { value: "after-close" }))
      .rejects.toMatchObject({ code: "CDP_NOT_READY" });
  });

  it("fails closed when an incoming JSON message is not an object", async () => {
    const fixture = await startFakeCdp();
    const endpoint = { host: "127.0.0.1" as const, port: fixture.port };
    const connection = await CdpConnection.connect(
      await discoverBrowserWebSocket(endpoint),
      endpoint,
    );
    const closed = new Promise<void>((resolveClose) => {
      connection.onClose(resolveClose);
    });

    fixture.emitRaw("null");

    await closed;
  });
});
