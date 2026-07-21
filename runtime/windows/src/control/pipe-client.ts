import { createConnection, type Socket } from "node:net";
import { RuntimeError } from "../errors.js";
import { CONTROL_MAX_FRAME_BYTES, decodeControlFrame, encodeControlFrame } from "./framing.js";
import {
  ControlRequestSchema,
  ControlResponseSchema,
  controlEndpointForIdentity,
  type ControlRequest,
  type ControlResponse,
} from "./protocol.js";

const DEFAULT_CONTROL_TIMEOUT_MS = 5_000;
const CONNECTION_RETRY_DELAY_MS = 10;

export interface SendControlRequestOptions {
  readonly sid: string;
  readonly request: ControlRequest;
  readonly timeoutMs?: number;
  readonly responseTimeoutMs?: number;
  readonly endpoint?: string;
}

function unavailableError(): RuntimeError {
  return new RuntimeError(
    "RUNTIME_CONTROL_UNAVAILABLE",
    "Runtime control pipe is unavailable",
    "Retry the OpenChatGPTSkin command.",
  );
}

function isTransientConnectError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}

export async function sendControlRequest(
  options: SendControlRequestOptions,
): Promise<ControlResponse> {
  const request = ControlRequestSchema.parse(options.request);
  const connectionTimeoutMs = options.timeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
  const responseTimeoutMs = options.responseTimeoutMs ?? connectionTimeoutMs;
  if (!Number.isInteger(connectionTimeoutMs) || connectionTimeoutMs < 1 ||
    connectionTimeoutMs > 60_000 || !Number.isInteger(responseTimeoutMs) ||
    responseTimeoutMs < 1 || responseTimeoutMs > 60_000) {
    throw new RuntimeError("RUNTIME_ENVIRONMENT_INVALID", "Control timeout is invalid");
  }

  return new Promise<ControlResponse>((resolveResponse, rejectResponse) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let expectedFrameBytes: number | null = null;
    let completeResponse: ControlResponse | null = null;
    let socket: Socket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const connectionDeadline = Date.now() + connectionTimeoutMs;
    let responseDeadline: number | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (retryTimer) clearTimeout(retryTimer);
      callback();
    };
    const fail = () => {
      settle(() => {
        socket?.destroy();
        rejectResponse(unavailableError());
      });
    };
    let timeout = setTimeout(fail, connectionTimeoutMs);

    const beginResponseWindow = () => {
      if (responseDeadline !== null) return;
      responseDeadline = Date.now() + responseTimeoutMs;
      clearTimeout(timeout);
      timeout = setTimeout(fail, responseTimeoutMs);
    };

    const resolveIfComplete = () => {
      if (!completeResponse) return false;
      settle(() => resolveResponse(completeResponse!));
      return true;
    };

    const inspectResponse = () => {
      const bytes = Buffer.concat(chunks);
      if (expectedFrameBytes === null && bytes.length >= 4) {
        const payloadLength = bytes.readUInt32LE(0);
        if (payloadLength < 1 || payloadLength > CONTROL_MAX_FRAME_BYTES) {
          fail();
          return;
        }
        expectedFrameBytes = payloadLength + 4;
      }
      if (expectedFrameBytes === null || bytes.length < expectedFrameBytes) return;
      if (bytes.length !== expectedFrameBytes) {
        fail();
        return;
      }
      try {
        const response = ControlResponseSchema.parse(decodeControlFrame(bytes));
        if (response.requestId !== request.requestId) {
          fail();
          return;
        }
        completeResponse = response;
      } catch {
        fail();
      }
    };

    const startConnection = () => {
      if (settled) return;
      const current = createConnection(
        options.endpoint ?? controlEndpointForIdentity(options.sid),
      );
      socket = current;
      let connected = false;
      let attemptFinished = false;
      let responseBytes = 0;
      const finishAttempt = (error?: Error) => {
        if (attemptFinished || settled) return;
        attemptFinished = true;
        const retryableHandoff = responseBytes === 0 &&
          (connected || (error !== undefined && isTransientConnectError(error)));
        const deadline = responseDeadline ?? connectionDeadline;
        if (retryableHandoff && Date.now() + CONNECTION_RETRY_DELAY_MS < deadline) {
          if (socket === current) socket = null;
          current.destroy();
          retryTimer = setTimeout(startConnection, CONNECTION_RETRY_DELAY_MS);
          return;
        }
        if (!resolveIfComplete()) fail();
      };

      current.once("error", finishAttempt);
      current.once("connect", () => {
        if (settled) {
          current.destroy();
          return;
        }
        connected = true;
        beginResponseWindow();
        current.write(encodeControlFrame(request), (error) => {
          if (error) finishAttempt(error);
        });
      });
      current.on("data", (chunk: Buffer) => {
        if (settled) return;
        responseBytes += chunk.length;
        receivedBytes += chunk.length;
        if (receivedBytes > CONTROL_MAX_FRAME_BYTES + 4) {
          fail();
          return;
        }
        chunks.push(chunk);
        inspectResponse();
      });
      current.once("end", () => finishAttempt());
      current.once("close", () => finishAttempt());
    };

    startConnection();
  });
}
