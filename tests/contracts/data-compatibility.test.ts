import { describe, expect, it } from "vitest";
import { runBaselineSuite } from "../../scripts/contracts/baseline-runner.js";

describe("Node data compatibility corpus", () => {
  it("replays isolated drafts, versions, Runtime terminal state, cache, lock, and corruption", async () => {
    await expect(runBaselineSuite(process.cwd(), "node", "data")).resolves.toMatchObject({
      suite: "data",
      implementation: "node",
      result: {
        draft: {
          schemaVersion: 1,
          dirty: true,
          revision: 6,
          past: 3,
          future: 0,
          savedRef: { id: "baseline-draft", version: "1.0.0" },
          savedDraftWasClean: true,
          undoExposedRedo: true,
          redoConsumedFuture: true,
        },
        personalVersions: 2,
        runtimeTerminalStatus: "restored-awaiting-exit",
        trustedCacheSchemaVersion: 1,
        controllerLockSchemaVersion: 1,
        corruptRecordsRejected: 4,
        corruptStoresRejected: 4,
        sensitiveValuesFound: false,
      },
    });
  });

  it("fails explicitly when the requested implementation is unavailable", async () => {
    await expect(runBaselineSuite(process.cwd(), "go", "data")).rejects.toMatchObject({
      code: "GO_BASELINE_IMPLEMENTATION_UNAVAILABLE",
    });
  });
});
