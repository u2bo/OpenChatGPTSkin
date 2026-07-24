import { describe, expect, it } from "vitest";
import { runBaselineSuite } from "../../scripts/contracts/baseline-runner.js";

describe("Node Theme baseline corpus", () => {
  it("replays built-ins, migrations, v4 capabilities, and ocskin cases", async () => {
    await expect(runBaselineSuite(process.cwd(), "node", "theme")).resolves.toMatchObject({
      suite: "theme",
      implementation: "node",
      result: {
        builtins: [
          "future-idol-cyan",
          "glacier-aurora",
          "mountain-mist",
          "rose-carpet-star",
          "yua-mikami-starlight",
        ],
        migratedVersions: [1, 2, 3, 4],
        archiveRoundTrips: 5,
        archiveNegativeCode: "ARCHIVE_ENTRY_UNSAFE",
        futureVersionCode: "THEME_SCHEMA_VERSION_UNSUPPORTED",
      },
    });
  });
});
