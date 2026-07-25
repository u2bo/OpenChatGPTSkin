import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { verifyFrozenBaseline } from "../../scripts/contracts/baseline.js";

describe("v0.2.0 Go migration baseline", () => {
  it("verifies the frozen release, contract, stage, and theme evidence read-only", async () => {
    const report = await verifyFrozenBaseline(process.cwd());

    expect(report).toEqual({
      baselineVersion: "0.2.0",
      releaseAssetCount: 7,
      stageCount: 3,
      themeCount: 5,
      verified: true,
    });
  });

  it("exposes the verifier through the documented package command", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };

    expect(packageJson.scripts?.["go:baseline:verify"]).toBe(
      "tsx --tsconfig tsconfig.scripts.json scripts/contracts/verify-baseline.ts",
    );
  });
});
