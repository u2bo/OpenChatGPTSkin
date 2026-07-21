import { createConnection, createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  CONTROL_MAX_FRAME_BYTES,
  encodeControlFrame,
  PowerShellWindowsProvider,
  SecurePipeServer,
  pipeNameForSid,
  sendControlRequest,
  RuntimeError,
  type ControlDispatchResult,
  type ControlRequest,
} from "@open-chatgpt-skin/windows-runtime";

const launchRequest = () => ({
  protocolVersion: 1 as const,
  requestId: "00000000-0000-4000-8000-000000000011",
  command: "launch" as const,
  params: { themeId: "mountain-mist" as const },
});

const statusRequest = (requestId = "00000000-0000-4000-8000-000000000012") => ({
  protocolVersion: 1 as const,
  requestId,
  command: "status" as const,
  params: {},
});

const successResponseFor = (request: ControlRequest): ControlDispatchResult => ({
  response: {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    result: {
      status: request.command === "launch" ? "active" : "stopped",
      controllerAvailable: true,
      selectedTheme: request.command === "launch"
        ? { id: request.params.themeId, version: "1.0.0" }
        : null,
      appliedTheme: request.command === "launch"
        ? { id: request.params.themeId, version: "1.0.0" }
        : null,
      skinApplied: request.command === "launch" ? true : false,
      packageVersion: request.command === "launch" ? "26.707.12708.0" : null,
      operation: null,
      nextAction: "Continue testing.",
    },
  },
});

describe.skipIf(process.platform !== "win32")("secured Runtime Pipe", () => {
  it("retries a connected pipe handoff that closes before any response", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    const request = statusRequest();
    let connections = 0;
    const server = createServer((socket) => {
      socket.once("data", () => {
        connections += 1;
        if (connections === 1) {
          socket.end();
          return;
        }
        socket.end(encodeControlFrame(successResponseFor(request).response));
      });
    });
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(pipeNameForSid(sid), () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });
      await expect(sendControlRequest({ sid, request })).resolves.toMatchObject({ ok: true });
      expect(connections).toBe(2);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  }, 60_000);

  it("allows a longer bounded response window after the pipe connects", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    const request = statusRequest("00000000-0000-4000-8000-000000000013");
    const server = createServer((socket) => {
      socket.once("data", () => {
        setTimeout(() => {
          if (!socket.destroyed) socket.end(encodeControlFrame(successResponseFor(request).response));
        }, 750);
      });
    });
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(pipeNameForSid(sid), () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });

      await expect(sendControlRequest({
        sid,
        request,
        timeoutMs: 500,
        responseTimeoutMs: 2_000,
      })).resolves.toMatchObject({ ok: true, requestId: request.requestId });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  }, 60_000);

  it("self-verifies the exact user plus SYSTEM ACL before dispatch", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    const dispatch = vi.fn(async (request: ControlRequest) => successResponseFor(request));
    const server = await SecurePipeServer.start({ sid, dispatch });
    try {
      expect(server.aclVerified).toBe(true);
      const response = await sendControlRequest({ sid, request: statusRequest() });
      expect(response.ok).toBe(true);
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  }, 60_000);

  it("never dispatches malformed or oversized frames", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    const dispatch = vi.fn(async () => {
      throw new Error("oversized input must never be dispatched");
    });
    const server = await SecurePipeServer.start({ sid, dispatch });
    try {
      await new Promise<void>((resolveClosed, reject) => {
        const socket = createConnection(pipeNameForSid(sid));
        socket.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code === "EPIPE") resolveClosed();
          else reject(error);
        });
        socket.once("close", () => resolveClosed());
        socket.once("connect", () => {
          const header = Buffer.alloc(4);
          header.writeUInt32LE(CONTROL_MAX_FRAME_BYTES + 1, 0);
          socket.write(header);
        });
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  }, 60_000);

  it("serves status while a mutation is still waiting", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    let releaseMutation!: () => void;
    const mutationBlocked = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const dispatch = vi.fn(async (request: ControlRequest) => {
      if (request.command === "launch") await mutationBlocked;
      return successResponseFor(request);
    });
    const server = await SecurePipeServer.start({ sid, dispatch });
    try {
      const launch = sendControlRequest({ sid, request: launchRequest() });
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
      await expect(sendControlRequest({ sid, request: statusRequest() }))
        .resolves.toMatchObject({ ok: true });
      releaseMutation();
      await expect(launch).resolves.toMatchObject({ ok: true });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("accepts back-to-back requests after every broker flush", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    const dispatch = vi.fn(async (request: ControlRequest) => successResponseFor(request));
    const server = await SecurePipeServer.start({ sid, dispatch });
    try {
      for (let index = 1; index <= 24; index += 1) {
        const requestId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        let response;
        try {
          response = await sendControlRequest({ sid, request: statusRequest(requestId) });
        } catch (error) {
          throw new Error(`request ${index} failed`, { cause: error });
        }
        expect(response).toMatchObject({ ok: true, requestId });
      }
      expect(new Set(dispatch.mock.calls.map(([request]) => request.requestId))).toEqual(
        new Set(Array.from({ length: 24 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        )),
      );
    } finally {
      await server.close();
    }
  }, 60_000);

  it("rejects a pending request when its helper broker exits", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    let releaseDispatch!: () => void;
    let finishDispatch!: () => void;
    const dispatchBlocked = new Promise<void>((resolve) => { releaseDispatch = resolve; });
    const dispatchFinished = new Promise<void>((resolve) => { finishDispatch = resolve; });
    const dispatch = vi.fn(async (request: ControlRequest) => {
      await dispatchBlocked;
      finishDispatch();
      return successResponseFor(request);
    });
    const server = await SecurePipeServer.start({ sid, dispatch });
    const launch = sendControlRequest({ sid, request: launchRequest() });
    const launchFailure = launch.then(
      () => null,
      (error: unknown) => error,
    );
    try {
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
      await server.close();
      releaseDispatch();
      await dispatchFinished;
      expect(await launchFailure).toMatchObject({ code: "RUNTIME_CONTROL_UNAVAILABLE" });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("returns only a stable code when dispatch fails", async () => {
    const sid = await new PowerShellWindowsProvider().currentUserSid();
    const server = await SecurePipeServer.start({
      sid,
      dispatch: async () => {
        throw new RuntimeError("RUNTIME_BUSY", "D:/private/project must not leave the broker");
      },
    });
    try {
      const response = await sendControlRequest({ sid, request: statusRequest() });
      expect(response).toMatchObject({ ok: false, error: { code: "RUNTIME_BUSY" } });
      if (response.ok) throw new Error("expected a controlled error response");
      expect(response.error.message).not.toContain("D:/private/project");
    } finally {
      await server.close();
    }
  }, 60_000);
});
