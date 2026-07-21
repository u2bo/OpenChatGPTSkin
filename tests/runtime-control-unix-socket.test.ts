import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SecureUnixSocketServer,
  sendControlRequest,
  type ControlDispatchResult,
  type ControlRequest,
} from "@open-chatgpt-skin/windows-runtime";

describe.skipIf(process.platform !== "darwin")("secured macOS Runtime socket", () => {
  it("creates a 0600 current-user socket and dispatches one framed request", async () => {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("macOS UID is unavailable");
    const directory = await mkdtemp(join(tmpdir(), "ocs-control-"));
    const endpoint = join(directory, "runtime.sock");
    const identity = `uid:${uid}`;
    const dispatch = vi.fn(async (request: ControlRequest): Promise<ControlDispatchResult> => ({
      response: {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result: {
          status: "stopped",
          controllerAvailable: true,
          selectedTheme: null,
          appliedTheme: null,
          skinApplied: false,
          packageVersion: null,
          operation: null,
          nextAction: "None",
        },
      },
    }));
    const server = await SecureUnixSocketServer.start({
      userIdentity: identity,
      endpoint,
      dispatch,
    });
    try {
      expect(server.permissionsVerified).toBe(true);
      const request = {
        protocolVersion: 1 as const,
        requestId: "00000000-0000-4000-8000-000000000021",
        command: "status" as const,
        params: {},
      };
      await expect(sendControlRequest({ sid: identity, endpoint, request }))
        .resolves.toMatchObject({ ok: true, requestId: request.requestId });
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });
});
