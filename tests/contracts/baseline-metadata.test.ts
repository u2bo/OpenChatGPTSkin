import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { verifyFrozenBaseline } from "../../scripts/contracts/baseline.js";

describe("v0.2.0 Go migration baseline", () => {
  it("accepts catalog additions while retaining the frozen five-theme evidence", async () => {
    const report = await verifyFrozenBaseline(process.cwd());
    const currentCatalog = JSON.parse(await readFile("themes/catalog.json", "utf8")) as {
      readonly builtins: readonly unknown[];
    };

    expect(report).toEqual({
      baselineVersion: "0.2.0",
      releaseAssetCount: 7,
      stageCount: 3,
      themeCount: 5,
      verified: true,
    });
    expect(currentCatalog.builtins).toHaveLength(6);
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
