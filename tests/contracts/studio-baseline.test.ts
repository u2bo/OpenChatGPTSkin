import { describe, expect, it } from "vitest";
import { runBaselineSuite } from "../../scripts/contracts/baseline-runner.js";

describe("Node Studio baseline corpus", () => {
  it("replays authentication, headers, bootstrap, and SSE over real loopback HTTP", async () => {
    await expect(runBaselineSuite(process.cwd(), "node", "studio")).resolves.toMatchObject({
      suite: "studio",
      implementation: "node",
      result: {
        protocolVersion: 2,
        sessionStatus: 204,
        bootstrapStatus: 200,
        unauthenticatedStatus: 401,
        securityHeaderCount: 5,
        eventKind: "runtime-status",
      },
    });
  });
});
