import { createServer, type Server, type Socket } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { RuntimeError } from "../errors.js";
import {
  CONTROL_MAX_FRAME_BYTES,
  decodeControlFrame,
  encodeControlFrame,
} from "./framing.js";
import {
  CONTROL_PROTOCOL_VERSION,
  ControlRequestSchema,
  ControlResponseSchema,
  NIL_REQUEST_ID,
  controlEndpointForIdentity,
  type ControlRequest,
  type ControlResponse,
} from "./protocol.js";
import type { ControlDispatchResult } from "./result.js";

export interface SecureUnixSocketServerOptions {
  readonly userIdentity: string;
  readonly dispatch: (request: ControlRequest) => Promise<ControlDispatchResult>;
  readonly endpoint?: string;
  readonly platform?: NodeJS.Platform;
  readonly currentUid?: number;
}

function unavailableError(): RuntimeError {
  return new RuntimeError(
    "RUNTIME_CONTROL_UNAVAILABLE",
    "Runtime control socket is unavailable",
    "Retry the OpenChatGPTSkin command.",
  );
}

function requestIdFrom(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return NIL_REQUEST_ID;
  const requestId = (value as Readonly<Record<string, unknown>>).requestId;
  return typeof requestId === "string" && /^[0-9a-f-]{36}$/i.test(requestId)
    ? requestId
    : NIL_REQUEST_ID;
}

function failureResponse(requestId: string): ControlResponse {
  return ControlResponseSchema.parse({
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: {
      code: "RUNTIME_CONTROL_UNAVAILABLE",
      message: "The Runtime command could not be completed.",
      nextAction: "Review Runtime status and retry.",
    },
  });
}

async function removeOwnedStaleSocket(endpoint: string, uid: number): Promise<void> {
  try {
    const info = await lstat(endpoint);
    if (!info.isSocket() || info.uid !== uid) throw unavailableError();
    await unlink(endpoint);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export class SecureUnixSocketServer {
  private server: Server | null = null;
  private socketIdentity: { readonly dev: number; readonly ino: number } | null = null;
  private readonly endpoint: string;
  private readonly uid: number;

  permissionsVerified = false;

  private constructor(private readonly options: SecureUnixSocketServerOptions) {
    const platform = options.platform ?? process.platform;
    if (platform !== "darwin") {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "Unix Runtime control requires macOS",
      );
    }
    const uid = options.currentUid ?? process.getuid?.();
    if (typeof uid !== "number" || !Number.isInteger(uid) || uid < 0 ||
      options.userIdentity !== `uid:${uid}`) {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "macOS Runtime user identity is invalid",
      );
    }
    this.uid = uid;
    this.endpoint = options.endpoint ?? controlEndpointForIdentity(
      options.userIdentity,
      "darwin",
    );
  }

  static async start(options: SecureUnixSocketServerOptions): Promise<SecureUnixSocketServer> {
    const control = new SecureUnixSocketServer(options);
    await removeOwnedStaleSocket(control.endpoint, control.uid);
    const server = createServer((socket) => control.handleConnection(socket));
    control.server = server;
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(control.endpoint, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    }).catch(async (error: unknown) => {
      await control.close();
      throw error;
    });

    await chmod(control.endpoint, 0o600);
    const info = await lstat(control.endpoint);
    const mode = info.mode & 0o777;
    if (!info.isSocket() || info.uid !== control.uid || mode !== 0o600) {
      await control.close();
      throw unavailableError();
    }
    control.socketIdentity = { dev: info.dev, ino: info.ino };
    control.permissionsVerified = true;
    return control;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
    try {
      const info = await lstat(this.endpoint);
      if (this.socketIdentity && info.isSocket() && info.uid === this.uid &&
        info.dev === this.socketIdentity.dev && info.ino === this.socketIdentity.ino) {
        await unlink(this.endpoint);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private handleConnection(socket: Socket): void {
    // Binding creates the filesystem node before chmod completes. Never retain a
    // connection accepted during that short startup window.
    if (!this.permissionsVerified) {
      socket.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let expected: number | null = null;
    let settled = false;

    const fail = (requestId = NIL_REQUEST_ID) => {
      if (settled || socket.destroyed) return;
      settled = true;
      socket.end(encodeControlFrame(failureResponse(requestId)));
    };

    socket.on("data", (chunk: Buffer) => {
      if (settled) {
        socket.destroy();
        return;
      }
      bytes += chunk.length;
      if (bytes > CONTROL_MAX_FRAME_BYTES + 4) {
        fail();
        return;
      }
      chunks.push(chunk);
      const frame = Buffer.concat(chunks);
      if (expected === null && frame.length >= 4) {
        const payloadBytes = frame.readUInt32LE(0);
        if (payloadBytes < 1 || payloadBytes > CONTROL_MAX_FRAME_BYTES) {
          fail();
          return;
        }
        expected = payloadBytes + 4;
      }
      if (expected === null || frame.length < expected) return;
      if (frame.length !== expected) {
        fail();
        return;
      }
      settled = true;
      let raw: unknown;
      try {
        raw = decodeControlFrame(frame);
        const request = ControlRequestSchema.parse(raw);
        void this.options.dispatch(request).then((result) => {
          socket.end(encodeControlFrame(result.response), () => {
            void result.afterResponse?.();
          });
        }, () => {
          settled = false;
          fail(request.requestId);
        });
      } catch {
        settled = false;
        fail(requestIdFrom(raw));
      }
    });
    socket.once("error", () => socket.destroy());
  }
}
