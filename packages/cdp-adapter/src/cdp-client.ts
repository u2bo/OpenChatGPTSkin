import { request } from "node:http";
import { RuntimeThemeError } from "./errors.js";
import { CurrentCodexAdapter, isAllowedCodexUrl } from "./current-adapter.js";
import type { CdpEndpoint, CdpRuntimeClient, CdpTarget } from "./types.js";

const HTTP_TIMEOUT_MS = 3_000;
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const CDP_REQUEST_TIMEOUT_MS = 5_000;
const MAX_CDP_MESSAGE_BYTES = 1024 * 1024;
const MAX_COMPATIBILITY_CANDIDATES = 8;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface CdpProtocolMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

function validateEndpoint(endpoint: CdpEndpoint): void {
  if (endpoint.host !== "127.0.0.1" ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535) {
    throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP endpoint must be IPv4 loopback");
  }
}

function validateWebSocketUrl(value: string, endpoint: CdpEndpoint): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP WebSocket URL is invalid");
  }
  if (url.protocol !== "ws:" ||
    url.hostname !== endpoint.host ||
    url.port !== String(endpoint.port) ||
    url.username !== "" ||
    url.password !== "") {
    throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP WebSocket URL is not same-port loopback");
  }
  return url.href;
}

function readJson(endpoint: CdpEndpoint, path: string): Promise<unknown> {
  validateEndpoint(endpoint);
  return new Promise((resolveJson, reject) => {
    const fail = (error: Error) => reject(error);
    const requestHandle = request({
      host: endpoint.host,
      port: endpoint.port,
      path,
      method: "GET",
      timeout: HTTP_TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        fail(new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP discovery redirects are forbidden"));
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(new RuntimeThemeError("CDP_NOT_READY", `CDP discovery returned HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_HTTP_BODY_BYTES) {
          response.destroy(new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP response exceeds 1 MB"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", fail);
      response.once("end", () => {
        try {
          resolveJson(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          fail(new RuntimeThemeError(
            "CDP_NOT_READY",
            error instanceof Error ? error.message : String(error),
          ));
        }
      });
    });
    requestHandle.once("timeout", () => {
      requestHandle.destroy(new RuntimeThemeError("CDP_NOT_READY", "CDP discovery timed out"));
    });
    requestHandle.once("error", fail);
    requestHandle.end();
  });
}

function parseTarget(value: unknown, endpoint: CdpEndpoint): CdpTarget {
  if (!value || typeof value !== "object") {
    throw new RuntimeThemeError("CDP_NOT_READY", "CDP target is not an object");
  }
  const target = value as Record<string, unknown>;
  for (const field of ["id", "type", "title", "url", "webSocketDebuggerUrl"] as const) {
    if (typeof target[field] !== "string") {
      throw new RuntimeThemeError("CDP_NOT_READY", `CDP target field ${field} is invalid`);
    }
  }
  return {
    id: target.id as string,
    type: target.type as string,
    title: target.title as string,
    url: target.url as string,
    webSocketDebuggerUrl: validateWebSocketUrl(target.webSocketDebuggerUrl as string, endpoint),
  };
}

export async function discoverCdpTargets(endpoint: CdpEndpoint): Promise<readonly CdpTarget[]> {
  const value = await readJson(endpoint, "/json/list");
  if (!Array.isArray(value)) {
    throw new RuntimeThemeError("CDP_NOT_READY", "CDP target list is not an array");
  }
  return value.map((target) => parseTarget(target, endpoint));
}

export async function discoverBrowserWebSocket(endpoint: CdpEndpoint): Promise<string> {
  const value = await readJson(endpoint, "/json/version");
  if (!value || typeof value !== "object" ||
    typeof (value as Record<string, unknown>).webSocketDebuggerUrl !== "string") {
    throw new RuntimeThemeError("CDP_NOT_READY", "CDP browser endpoint is missing");
  }
  return validateWebSocketUrl(
    (value as Record<string, unknown>).webSocketDebuggerUrl as string,
    endpoint,
  );
}

export function selectCodexTarget(targets: readonly CdpTarget[]): CdpTarget {
  const matches = targets.filter((target) =>
    target.type === "page" && isAllowedCodexUrl(target.url)
  );
  if (matches.length === 0) {
    throw new RuntimeThemeError("CDP_TARGET_NOT_FOUND", "No compatible Codex page target exists");
  }
  if (matches.length > 1) {
    throw new RuntimeThemeError("CDP_TARGET_AMBIGUOUS", "Multiple compatible Codex page targets exist");
  }
  return matches[0]!;
}

export interface WaitForCodexTargetOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

function targetWaitBounds(options: WaitForCodexTargetOptions): {
  readonly timeoutMs: number;
  readonly intervalMs: number;
} {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 100;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
    !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 1_000) {
    throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP target wait bounds are invalid");
  }
  return { timeoutMs, intervalMs };
}

function allowedPageTargets(targets: readonly CdpTarget[]): readonly CdpTarget[] {
  return targets.filter((target) => target.type === "page" && isAllowedCodexUrl(target.url));
}

function isCanonicalCodexTarget(target: CdpTarget): boolean {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    return false;
  }
  if (url.search !== "") return false;
  if (url.protocol === "app:") {
    return url.hostname === "-" && url.pathname === "/index.html";
  }
  return url.protocol === "https:" && url.hostname === "chatgpt.com" &&
    /^\/codex\/?$/.test(url.pathname);
}

function preferCanonicalTarget(matches: readonly CdpTarget[]): CdpTarget | null {
  const canonical = matches.filter(isCanonicalCodexTarget);
  return canonical.length === 1 ? canonical[0]! : null;
}

export async function waitForCodexTarget(
  endpoint: CdpEndpoint,
  options: WaitForCodexTargetOptions = {},
): Promise<CdpTarget> {
  const { timeoutMs, intervalMs } = targetWaitBounds(options);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return selectCodexTarget(await discoverCdpTargets(endpoint));
    } catch (error) {
      if (!(error instanceof RuntimeThemeError) || error.code !== "CDP_TARGET_NOT_FOUND") {
        throw error;
      }
      if (Date.now() >= deadline) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
    }
  }
}

async function hasCompatibleCodexDom(
  target: CdpTarget,
  endpoint: CdpEndpoint,
): Promise<boolean> {
  let connection: CdpConnection | null = null;
  try {
    connection = await CdpConnection.connect(target.webSocketDebuggerUrl, endpoint);
    return (await new CurrentCodexAdapter(connection).probe()).compatible;
  } catch (error) {
    if (error instanceof RuntimeThemeError && error.code === "CDP_ENDPOINT_UNSAFE") {
      throw error;
    }
    return false;
  } finally {
    connection?.close();
  }
}

export async function waitForCompatibleCodexTarget(
  endpoint: CdpEndpoint,
  options: WaitForCodexTargetOptions = {},
): Promise<CdpTarget> {
  const { timeoutMs, intervalMs } = targetWaitBounds(options);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const candidates = allowedPageTargets(await discoverCdpTargets(endpoint));
    if (candidates.length > MAX_COMPATIBILITY_CANDIDATES) {
      throw new RuntimeThemeError(
        "CDP_TARGET_AMBIGUOUS",
        "Too many compatible Codex URL candidates",
      );
    }
    const matches: CdpTarget[] = [];
    for (const candidate of candidates) {
      if (await hasCompatibleCodexDom(candidate, endpoint)) matches.push(candidate);
    }
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      const canonical = preferCanonicalTarget(matches);
      if (canonical) return canonical;
      throw new RuntimeThemeError(
        "CDP_TARGET_AMBIGUOUS",
        "Multiple page targets have compatible Codex DOM capabilities",
      );
    }
    if (Date.now() >= deadline) {
      throw new RuntimeThemeError(
        candidates.length === 0 ? "CDP_TARGET_NOT_FOUND" : "ADAPTER_INCOMPATIBLE",
        "No page target has compatible Codex DOM capabilities",
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
}

function messageText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    if (Buffer.byteLength(data) > MAX_CDP_MESSAGE_BYTES) {
      throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP message exceeds 1 MB");
    }
    return Promise.resolve(data);
  }
  if (data instanceof ArrayBuffer) {
    if (data.byteLength > MAX_CDP_MESSAGE_BYTES) {
      throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP message exceeds 1 MB");
    }
    return Promise.resolve(Buffer.from(data).toString("utf8"));
  }
  if (ArrayBuffer.isView(data)) {
    if (data.byteLength > MAX_CDP_MESSAGE_BYTES) {
      throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP message exceeds 1 MB");
    }
    return Promise.resolve(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"));
  }
  if (data instanceof Blob) {
    if (data.size > MAX_CDP_MESSAGE_BYTES) {
      throw new RuntimeThemeError("CDP_ENDPOINT_UNSAFE", "CDP message exceeds 1 MB");
    }
    return data.text();
  }
  throw new RuntimeThemeError("CDP_NOT_READY", "CDP message type is unsupported");
}

export class CdpConnection implements CdpRuntimeClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventListeners = new Map<string, Set<(params: unknown) => void>>();
  private readonly closeListeners = new Set<() => void>();
  private closed = false;

  private constructor(
    private readonly websocket: WebSocket,
  ) {
    websocket.binaryType = "arraybuffer";
    websocket.addEventListener("message", (event) => {
      void this.handleMessage(event.data);
    });
    websocket.addEventListener("close", () => this.handleClose());
    websocket.addEventListener("error", () => {
      this.failAll(new RuntimeThemeError("CDP_NOT_READY", "CDP WebSocket failed"));
    });
  }

  static async connect(
    webSocketUrl: string,
    endpoint: CdpEndpoint,
  ): Promise<CdpConnection> {
    const safeUrl = validateWebSocketUrl(webSocketUrl, endpoint);
    return new Promise((resolveConnection, reject) => {
      const websocket = new WebSocket(safeUrl);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        websocket.close();
        reject(new RuntimeThemeError("CDP_NOT_READY", "CDP WebSocket connection timed out"));
      }, HTTP_TIMEOUT_MS);
      websocket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveConnection(new CdpConnection(websocket));
      }, { once: true });
      websocket.addEventListener("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new RuntimeThemeError("CDP_NOT_READY", "CDP WebSocket connection failed"));
      }, { once: true });
    });
  }

  send<T>(method: string, params?: Readonly<Record<string, unknown>>): Promise<T> {
    if (this.closed || this.websocket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RuntimeThemeError("CDP_NOT_READY", "CDP WebSocket is closed"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new RuntimeThemeError("CDP_NOT_READY", `CDP request timed out: ${method}`));
      }, CDP_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolveRequest(value as T),
        reject: rejectRequest,
        timer,
      });
      try {
        this.websocket.send(JSON.stringify(params === undefined
          ? { id, method }
          : { id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectRequest(new RuntimeThemeError(
          "CDP_NOT_READY",
          error instanceof Error ? error.message : String(error),
        ));
      }
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send<{
      readonly result?: { readonly value?: unknown };
      readonly exceptionDetails?: unknown;
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new RuntimeThemeError("ADAPTER_INCOMPATIBLE", "Runtime.evaluate returned an exception");
    }
    return response.result?.value as T;
  }

  on(method: string, listener: (params: unknown) => void): () => void {
    const listeners = this.eventListeners.get(method) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.eventListeners.delete(method);
    };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.websocket.close();
  }

  private async handleMessage(data: unknown): Promise<void> {
    let message: CdpProtocolMessage;
    try {
      const parsed = JSON.parse(await messageText(data)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new RuntimeThemeError("CDP_NOT_READY", "CDP message is not an object");
      }
      message = parsed as CdpProtocolMessage;
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
      this.websocket.close();
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new RuntimeThemeError(
          "CDP_NOT_READY",
          message.error.message ?? "CDP request failed",
        ));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === "string") {
      for (const listener of this.eventListeners.get(message.method) ?? []) {
        listener(message.params);
      }
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new RuntimeThemeError("CDP_NOT_READY", "CDP WebSocket closed"));
    for (const listener of this.closeListeners) listener();
    this.closeListeners.clear();
  }
}
