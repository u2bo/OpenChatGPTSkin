import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { THEME_CORE_VERSION } from "@open-chatgpt-skin/theme-core";
import { THEME_SCHEMA_VERSION } from "@open-chatgpt-skin/theme-schema";

describe("workspace packages", () => {
  it("exports stable foundation versions", () => {
    expect(THEME_SCHEMA_VERSION).toBe(4);
    expect(THEME_CORE_VERSION).toBe("0.3.3");
  });

  it("keeps Go as the only business host and TypeScript as authoring packages", async () => {
    const [rootPackage, runtimeContractPackage, studioPackage, goModule] = await Promise.all([
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("packages/runtime-contract/package.json", "utf8").then(JSON.parse),
      readFile("apps/theme-studio/package.json", "utf8").then(JSON.parse),
      readFile("host/go/go.mod", "utf8"),
    ]);

    expect(rootPackage.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(rootPackage.name).toBe("open-chatgpt-skin");
    expect(runtimeContractPackage.name).toBe("@open-chatgpt-skin/runtime-contract");
    expect(studioPackage.name).toBe("@open-chatgpt-skin/theme-studio");
    expect(goModule).toContain("module github.com/u2bo/OpenChatGPTSkin/host/go");
    expect(rootPackage.scripts).toMatchObject({
      runtime: "go -C host/go run -buildvcs=false -tags nodynamic ./cmd/openchatgptskin runtime",
      "studio:dev": "npm run go:cdp-adapter:build && tsx scripts/dev/start-go-studio.ts",
      "studio:build": "npm run build -w @open-chatgpt-skin/theme-studio",
      verify: "npm run contracts:verify && npm run build && npm run test && npm run typecheck && npm run go:verify",
      "verify:foundation": "npm run themes:build && npm run build && npm run test && npm run typecheck && node packages/theme-core/dist/cli.js catalog --root themes",
    });
    expect(runtimeContractPackage.dependencies).toHaveProperty(
      "@open-chatgpt-skin/theme-schema",
      "0.3.3",
    );
    expect(studioPackage.dependencies).toHaveProperty(
      "@open-chatgpt-skin/theme-schema",
      "0.3.3",
    );
  });
});
