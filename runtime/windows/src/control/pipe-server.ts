import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { z } from "zod";
import {
  RuntimeError,
  runtimeErrorCode,
  type RuntimeErrorCode,
} from "../errors.js";
import { WINDOWS_POWERSHELL } from "../windows/powershell-path.js";
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
  pipeNameForSid,
  type ControlRequest,
  type ControlResponse,
} from "./protocol.js";
import type { ControlDispatchResult } from "./result.js";
export type { ControlDispatchResult } from "./result.js";
import { ENCODED_PIPE_HOST_SCRIPT } from "./pipe-host-script.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const MAX_BROKER_LINE_BYTES = Math.ceil(CONTROL_MAX_FRAME_BYTES / 3) * 4 + 128;
const REQUEST_ID_SCHEMA = z.string().uuid();

export interface SecurePipeServerOptions {
  readonly sid: string;
  readonly dispatch: (request: ControlRequest) => Promise<ControlDispatchResult>;
  readonly powershellPath?: string;
  readonly startupTimeoutMs?: number;
}

interface ActiveRequest {
  readonly sequence: string;
  afterResponse?: () => Promise<void> | void;
}

interface Broker {
  readonly index: number;
  readonly restartAttempt: number;
  readonly child: ChildProcessWithoutNullStreams;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  lineBuffer: string;
  isReady: boolean;
  stopped: boolean;
  active: ActiveRequest | null;
}

function unavailableError(): RuntimeError {
  return new RuntimeError(
    "RUNTIME_CONTROL_UNAVAILABLE",
    "Runtime control pipe is unavailable",
    "Retry the OpenChatGPTSkin command.",
  );
}

function requestIdFrom(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NIL_REQUEST_ID;
  }
  const parsed = REQUEST_ID_SCHEMA.safeParse(
    (value as Readonly<Record<string, unknown>>).requestId,
  );
  return parsed.success ? parsed.data : NIL_REQUEST_ID;
}

function errorResponse(
  requestId: string,
  code: RuntimeErrorCode = "RUNTIME_CONTROL_UNAVAILABLE",
): ControlResponse {
  return ControlResponseSchema.parse({
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: {
      code,
      message: "The Runtime command could not be completed.",
      nextAction: "Review Runtime status and retry.",
    },
  });
}

function decodeBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length > MAX_BROKER_LINE_BYTES ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

function frameForPayload(payload: Buffer): Buffer {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class SecurePipeServer {
  private readonly expectedPipeLeaf: string;
  private readonly startupTimeoutMs: number;
  private readonly brokers = new Map<number, Broker>();
  private closed = false;
  private permanentlyUnavailable = false;

  aclVerified = false;

  private constructor(private readonly options: SecurePipeServerOptions) {
    const timeout = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000) {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "Pipe startup timeout is invalid",
      );
    }
    this.startupTimeoutMs = timeout;
    this.expectedPipeLeaf = pipeNameForSid(options.sid).split("\\").at(-1) ?? "";
  }

  static async start(options: SecurePipeServerOptions): Promise<SecurePipeServer> {
    if (process.platform !== "win32") {
      throw new RuntimeError(
        "RUNTIME_ENVIRONMENT_INVALID",
        "Secured Runtime control requires Windows",
      );
    }

    const server = new SecurePipeServer(options);
    try {
      await Promise.all([server.startBroker(0, 0), server.startBroker(1, 0)]);
    } catch {
      await server.close();
      throw unavailableError();
    }
    server.aclVerified = true;
    return server;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.brokers.values()].map((broker) => this.stopBroker(broker)));
    this.brokers.clear();
  }

  private startBroker(index: number, restartAttempt: number): Promise<Broker> {
    const child = spawn(
      this.options.powershellPath ?? WINDOWS_POWERSHELL,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        ENCODED_PIPE_HOST_SCRIPT,
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolveReadyPromise, rejectReadyPromise) => {
      resolveReady = resolveReadyPromise;
      rejectReady = rejectReadyPromise;
    });
    const broker: Broker = {
      index,
      restartAttempt,
      child,
      resolveReady,
      rejectReady,
      lineBuffer: "",
      isReady: false,
      stopped: false,
      active: null,
    };
    this.brokers.set(index, broker);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receiveBrokerOutput(broker, chunk));
    child.stderr.resume();
    child.once("error", () => this.handleBrokerStop(broker));
    child.once("close", () => this.handleBrokerStop(broker));

    return new Promise<Broker>((resolveBroker, rejectBroker) => {
      const timer = setTimeout(() => {
        this.failBroker(broker);
        rejectBroker(unavailableError());
      }, this.startupTimeoutMs);
      ready.then(
        () => {
          clearTimeout(timer);
          resolveBroker(broker);
        },
        (error: Error) => {
          clearTimeout(timer);
          rejectBroker(error);
        },
      );
    });
  }

  private receiveBrokerOutput(broker: Broker, chunk: string): void {
    if (broker.stopped) return;
    broker.lineBuffer += chunk;
    while (true) {
      const newline = broker.lineBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = broker.lineBuffer.slice(0, newline).replace(/\r$/, "");
      broker.lineBuffer = broker.lineBuffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_BROKER_LINE_BYTES) {
        this.failBroker(broker);
        return;
      }
      this.handleBrokerLine(broker, line);
    }
    if (Buffer.byteLength(broker.lineBuffer, "utf8") > MAX_BROKER_LINE_BYTES) {
      this.failBroker(broker);
    }
  }

  private handleBrokerLine(broker: Broker, line: string): void {
    if (line.startsWith("READY ")) {
      if (broker.isReady || line !== `READY ${this.expectedPipeLeaf}`) {
        this.failBroker(broker);
        return;
      }
      broker.isReady = true;
      broker.resolveReady();
      return;
    }

    if (!broker.isReady) {
      this.failBroker(broker);
      return;
    }

    const requestMatch = /^REQUEST ([0-9]+) ([A-Za-z0-9+/=]+)$/.exec(line);
    if (requestMatch) {
      if (broker.active) {
        this.failBroker(broker);
        return;
      }
      const payload = decodeBase64(requestMatch[2]!);
      if (!payload || payload.length < 1 || payload.length > CONTROL_MAX_FRAME_BYTES) {
        this.failBroker(broker);
        return;
      }
      broker.active = { sequence: requestMatch[1]! };
      void this.dispatchBrokerRequest(broker, requestMatch[1]!, payload)
        .catch(() => this.failBroker(broker));
      return;
    }

    const flushedMatch = /^FLUSHED ([0-9]+)$/.exec(line);
    if (flushedMatch) {
      this.handleBrokerFlushed(broker, flushedMatch[1]!);
      return;
    }

    this.failBroker(broker);
  }

  private async dispatchBrokerRequest(
    broker: Broker,
    sequence: string,
    payload: Buffer,
  ): Promise<void> {
    let raw: unknown;
    try {
      raw = decodeControlFrame(frameForPayload(payload));
    } catch {
      await this.sendBrokerResponse(broker, sequence, errorResponse(NIL_REQUEST_ID));
      return;
    }

    const request = ControlRequestSchema.safeParse(raw);
    if (!request.success) {
      await this.sendBrokerResponse(broker, sequence, errorResponse(requestIdFrom(raw)));
      return;
    }

    let result: ControlDispatchResult;
    try {
      result = await this.options.dispatch(request.data);
    } catch (error) {
      await this.sendBrokerResponse(
        broker,
        sequence,
        errorResponse(request.data.requestId, runtimeErrorCode(error)),
      );
      return;
    }
    const response = ControlResponseSchema.safeParse(result.response);
    if (!response.success || response.data.requestId !== request.data.requestId) {
      await this.sendBrokerResponse(
        broker,
        sequence,
        errorResponse(request.data.requestId),
      );
      return;
    }
    await this.sendBrokerResponse(broker, sequence, response.data, result.afterResponse);
  }

  private async sendBrokerResponse(
    broker: Broker,
    sequence: string,
    response: ControlResponse,
    afterResponse?: () => Promise<void> | void,
  ): Promise<void> {
    if (broker.stopped || broker.active?.sequence !== sequence) {
      throw unavailableError();
    }
    const frame = encodeControlFrame(response);
    const payload = frame.subarray(4);
    if (afterResponse) broker.active.afterResponse = afterResponse;
    await new Promise<void>((resolveWrite, rejectWrite) => {
      broker.child.stdin.write(
        `RESPONSE ${sequence} ${payload.toString("base64")}\n`,
        "utf8",
        (error) => error ? rejectWrite(error) : resolveWrite(),
      );
    });
  }

  private handleBrokerFlushed(broker: Broker, sequence: string): void {
    if (!broker.active || broker.active.sequence !== sequence) {
      this.failBroker(broker);
      return;
    }
    const afterResponse = broker.active.afterResponse;
    broker.active = null;
    void this.acknowledgeBrokerFlush(broker, sequence, afterResponse)
      .catch(() => this.failBroker(broker));
  }

  private async acknowledgeBrokerFlush(
    broker: Broker,
    sequence: string,
    afterResponse?: () => Promise<void> | void,
  ): Promise<void> {
    if (broker.stopped) throw unavailableError();
    await new Promise<void>((resolveWrite, rejectWrite) => {
      broker.child.stdin.write(`CONTINUE ${sequence}\n`, "utf8", (error) =>
        error ? rejectWrite(error) : resolveWrite(),
      );
    });
    if (afterResponse) await afterResponse();
  }

  private failBroker(broker: Broker): void {
    if (broker.stopped) return;
    if (!broker.isReady) broker.rejectReady(unavailableError());
    void this.stopBroker(broker);
  }

  private handleBrokerStop(broker: Broker): void {
    if (broker.stopped) return;
    broker.stopped = true;
    if (!broker.isReady) broker.rejectReady(unavailableError());
    if (this.closed || this.brokers.get(broker.index) !== broker) return;
    if (broker.restartAttempt >= 1) {
      this.permanentlyUnavailable = true;
      void this.close();
      return;
    }
    void this.restartBroker(broker.index, broker.restartAttempt + 1);
  }

  private async restartBroker(index: number, restartAttempt: number): Promise<void> {
    if (this.closed || this.permanentlyUnavailable) return;
    try {
      await this.startBroker(index, restartAttempt);
    } catch {
      this.permanentlyUnavailable = true;
    }
  }

  private async stopBroker(broker: Broker): Promise<void> {
    if (broker.child.exitCode !== null || broker.child.killed) return;
    await new Promise<void>((resolveStop) => {
      const timeout = setTimeout(resolveStop, 1_000);
      broker.child.once("close", () => {
        clearTimeout(timeout);
        resolveStop();
      });
      broker.child.kill();
    });
  }
}
