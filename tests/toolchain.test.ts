import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("source toolchain", () => {
  it("runs theme catalog scripts against workspace source without prebuilt dist", async () => {
    const [packageJson, scriptsTsconfig] = await Promise.all([
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("tsconfig.scripts.json", "utf8").then(JSON.parse),
    ]);

    expect(packageJson.scripts["themes:build"]).toBe(
      "tsx --tsconfig tsconfig.scripts.json scripts/build-theme-catalog.ts",
    );
    expect(scriptsTsconfig.compilerOptions).toMatchObject({
      baseUrl: ".",
      noEmit: true,
      paths: {
        "@open-chatgpt-skin/theme-schema": ["./packages/theme-schema/src/index.ts"],
        "@open-chatgpt-skin/theme-core": ["./packages/theme-core/src/index.ts"],
      },
    });
  });

  it("keeps generated text files stable across Windows checkouts", async () => {
    const attributes = await readFile(".gitattributes", "utf8");
    expect(attributes).toContain("*.json text eol=lf");
    expect(attributes).toContain("*.md text eol=lf");
    expect(attributes).toContain("*.ts text eol=lf");
    expect(attributes).toContain("*.png binary");
    expect(attributes).toContain("*.webp binary");
  });
});
