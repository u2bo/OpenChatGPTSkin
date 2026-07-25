import { describe, expect, it } from "vitest";
import { runBaselineSuite } from "../../scripts/contracts/baseline-runner.js";

describe("Node Runtime baseline corpus", () => {
  it("replays framed requests through the real dispatcher", async () => {
    await expect(runBaselineSuite(process.cwd(), "node", "runtime")).resolves.toMatchObject({
      suite: "runtime",
      implementation: "node",
      result: {
        protocolVersion: 1,
        frameLimitBytes: 65536,
        transportSecurityVerified: true,
        status: "stopped",
        launchStatus: "active",
        replayed: true,
        conflictingRequestCode: "RUNTIME_CONTROL_UNAVAILABLE",
      },
    });
  });
});
