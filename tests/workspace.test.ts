import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { THEME_CORE_VERSION } from "@open-chatgpt-skin/theme-core";
import { THEME_SCHEMA_VERSION } from "@open-chatgpt-skin/theme-schema";

describe("workspace packages", () => {
  it("exports stable foundation versions", () => {
    expect(THEME_SCHEMA_VERSION).toBe(2);
    expect(THEME_CORE_VERSION).toBe("0.1.0-alpha.1");
  });

  it("declares the Runtime CLI and its built executable", async () => {
    const [rootPackage, runtimePackage, studioPackage, studioServicePackage] = await Promise.all([
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("runtime/windows/package.json", "utf8").then(JSON.parse),
      readFile("apps/theme-studio/package.json", "utf8").then(JSON.parse),
      readFile("runtime/theme-studio-service/package.json", "utf8").then(JSON.parse),
    ]);

    expect(rootPackage.workspaces).toEqual(["apps/*", "packages/*", "runtime/*"]);
    expect(rootPackage.name).toBe("open-chatgpt-skin");
    expect(runtimePackage.name).toBe("@open-chatgpt-skin/windows-runtime");
    expect(studioPackage.name).toBe("@open-chatgpt-skin/theme-studio");
    expect(studioServicePackage.name).toBe("@open-chatgpt-skin/theme-studio-service");
    expect(rootPackage.scripts).toMatchObject({
      runtime: "npm run build && node runtime/windows/dist/cli.js",
      "studio:dev": "npm run build && npm run dev -w @open-chatgpt-skin/theme-studio-service",
      "studio:build": "npm run build -w @open-chatgpt-skin/theme-studio",
      verify: "npm run build && npm run test && npm run typecheck",
      "verify:runtime": "npm run build && npm run test && npm run typecheck",
      "verify:foundation": "npm run themes:build && npm run build && npm run test && npm run typecheck && node packages/theme-core/dist/cli.js catalog --root themes",
    });
    expect(runtimePackage.bin).toMatchObject({
      "open-chatgpt-skin-runtime": "./dist/cli.js",
    });
    expect(runtimePackage.dependencies).toHaveProperty(
      "@open-chatgpt-skin/theme-schema",
      "0.1.0-alpha.1",
    );
    expect(studioPackage.dependencies).toHaveProperty(
      "@open-chatgpt-skin/theme-schema",
      "0.1.0-alpha.1",
    );
    expect(studioServicePackage.bin).toMatchObject({
      "open-chatgpt-skin-studio": "./dist/cli.js",
    });
  });
});
