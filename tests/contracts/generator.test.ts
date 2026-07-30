import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildContracts,
  verifyGeneratedContracts,
} from "../../scripts/contracts/build.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

async function files(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, path));
    if (entry.isFile()) result.push(relative(root, path).replaceAll("\\", "/"));
  }
  return result.sort();
}

async function contents(root: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all((await files(root)).map(async (path) => [
    path,
    await readFile(join(root, ...path.split("/")), "utf8"),
  ])));
}

describe("cross-language contract generator", () => {
  it("generates the complete contract tree deterministically", async () => {
    const first = await mkdtemp(join(tmpdir(), "ocskin-contracts-first-"));
    const second = await mkdtemp(join(tmpdir(), "ocskin-contracts-second-"));
    temporaryRoots.push(first, second);

    await buildContracts(process.cwd(), first);
    await buildContracts(process.cwd(), second);

    expect(await files(first)).toEqual([
      "data/v1/cases/compatibility.json",
      "data/v1/schemas/index.json",
      "runtime/v1/cases/semantics.json",
      "runtime/v1/frames.json",
      "runtime/v1/schemas/index.json",
      "studio/v2/cases/http.json",
      "studio/v2/routes.json",
      "studio/v2/schemas/index.json",
      "theme-cli/v1/contract.json",
      "theme/v4/archive-cases.json",
      "theme/v4/draft-schema.json",
      "theme/v4/migrations.json",
      "theme/v4/schema.json",
      "theme/v4/semantic-cases.json",
    ]);
    expect(await contents(second)).toEqual(await contents(first));
  });

  it("keeps every generated negative semantic case actionable", async () => {
    const output = await mkdtemp(join(tmpdir(), "ocskin-contracts-cases-"));
    temporaryRoots.push(output);
    await buildContracts(process.cwd(), output);

    for (const path of [
      "studio/v2/cases/http.json",
      "runtime/v1/cases/semantics.json",
      "theme/v4/semantic-cases.json",
      "theme/v4/archive-cases.json",
      "data/v1/cases/compatibility.json",
    ]) {
      const document = JSON.parse(await readFile(join(output, ...path.split("/")), "utf8")) as {
        readonly cases: readonly {
          readonly valid: boolean;
          readonly expectedErrorCode?: string;
          readonly expectedPath?: string;
        }[];
      };
      const negative = document.cases.filter((entry) => !entry.valid);
      expect(negative.length, path).toBeGreaterThan(0);
      expect(negative.every((entry) =>
        Boolean(entry.expectedErrorCode) && Boolean(entry.expectedPath)
      ), path).toBe(true);
    }
  });

  it("captures the complete Studio surface and Runtime recovery model", async () => {
    const output = await mkdtemp(join(tmpdir(), "ocskin-contracts-complete-"));
    temporaryRoots.push(output);
    await buildContracts(process.cwd(), output);

    const studio = JSON.parse(await readFile(
      join(output, "studio", "v2", "routes.json"),
      "utf8",
    )) as {
      readonly routes: readonly { readonly id: string; readonly path: string }[];
      readonly bodyLimits: Readonly<Record<string, number>>;
      readonly responsePolicies: Readonly<Record<string, unknown>>;
    };
    expect(studio.routes).toContainEqual(expect.objectContaining({ id: "home", path: "/" }));
    expect(studio.bodyLimits).toEqual(expect.objectContaining({
      sessionJsonBytes: 16 * 1024,
      jsonBytes: 256 * 1024,
      imageBytes: 50 * 1024 * 1024,
      archiveBytes: 32 * 1024 * 1024,
    }));
    expect(Object.keys(studio.responsePolicies).sort()).toEqual(["binary", "html", "json", "sse"]);

    const runtime = JSON.parse(await readFile(
      join(output, "runtime", "v1", "cases", "semantics.json"),
      "utf8",
    )) as {
      readonly recoveryCases: readonly unknown[];
      readonly stateTransitions: Readonly<Record<string, readonly string[]>>;
    };
    expect(runtime.recoveryCases.length).toBeGreaterThan(0);
    expect(runtime.stateTransitions).toMatchObject({
      active: expect.arrayContaining(["paused", "restoring"]),
      restoring: expect.arrayContaining(["restored-awaiting-exit"]),
    });
  });

  it("verifies checked-in contracts without rewriting them", async () => {
    await expect(verifyGeneratedContracts(process.cwd())).resolves.toEqual({
      fileCount: 14,
      verified: true,
    });
  });

  it("exposes build and verify package commands", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };
    expect(packageJson.scripts?.["contracts:build"]).toBe(
      "tsx --tsconfig tsconfig.scripts.json scripts/contracts/build.ts && npm run go:theme-contract:build",
    );
    expect(packageJson.scripts?.["contracts:verify"]).toBe(
      "tsx --tsconfig tsconfig.scripts.json scripts/contracts/verify.ts",
    );
  });
});
