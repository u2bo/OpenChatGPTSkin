import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCommunityCatalogCli } from "@open-chatgpt-skin/community-catalog";
import { validCommunityCatalog } from "./fixtures/community-catalog.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    adapter: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
  };
}

const trustArgs = [
  "--release-repository", "https://github.com/u2bo/OpenChatGPTSkin-Community",
  "--site-origin", "https://u2bo.github.io/OpenChatGPTSkin-Community",
];

async function catalogFile(): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), "community-catalog-"));
  temporaryRoots.push(root);
  const file = join(root, "catalog.json");
  await writeFile(file, JSON.stringify(validCommunityCatalog));
  return { root, file };
}

describe("community catalog CLI", () => {
  it("keeps the JSON smoke fixture equal to the TypeScript fixture", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/community-catalog.json", import.meta.url));

    expect(JSON.parse(await readFile(fixture, "utf8"))).toEqual(validCommunityCatalog);
  });

  it("validates a catalog and returns machine-readable counts", async () => {
    const { file } = await catalogFile();
    const output = io();

    expect(await runCommunityCatalogCli(["validate", "--file", file, ...trustArgs], output.adapter)).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual({
      valid: true,
      schemaVersion: 1,
      catalogRevision: "1".repeat(40),
      themeCount: 1,
      versionCount: 1,
    });
    expect(output.stderr).toEqual([]);
  });

  it("writes canonical JSON only to a new destination", async () => {
    const { root, file } = await catalogFile();
    const out = join(root, "canonical.json");
    const output = io();

    expect(await runCommunityCatalogCli([
      "canonicalize", "--file", file, "--out", out, ...trustArgs,
    ], output.adapter)).toBe(0);
    expect(await readFile(out, "utf8")).toBe(`${JSON.stringify(validCommunityCatalog, null, 2)}\n`);
    expect(await runCommunityCatalogCli([
      "canonicalize", "--file", file, "--out", out, ...trustArgs,
    ], output.adapter)).toBe(73);
  });

  it("uses stable usage and catalog error codes", async () => {
    const usage = io();
    expect(await runCommunityCatalogCli(["validate"], usage.adapter)).toBe(64);
    expect(JSON.parse(usage.stderr.join(""))).toMatchObject({ error: { code: "CLI_USAGE" } });

    const { file } = await catalogFile();
    await writeFile(file, "{invalid json", "utf8");
    const invalid = io();
    expect(await runCommunityCatalogCli(["validate", "--file", file, ...trustArgs], invalid.adapter)).toBe(65);
    expect(JSON.parse(invalid.stderr.join(""))).toMatchObject({
      error: { code: "COMMUNITY_CATALOG_INVALID" },
    });
  });

  it("rejects options that are not valid for the selected command", async () => {
    const { root, file } = await catalogFile();
    const output = io();

    expect(await runCommunityCatalogCli([
      "validate", "--file", file, "--out", join(root, "ignored.json"), ...trustArgs,
    ], output.adapter)).toBe(64);
    expect(JSON.parse(output.stderr.join(""))).toMatchObject({ error: { code: "CLI_USAGE" } });
  });

  it.each([
    "http://github.com/u2bo/OpenChatGPTSkin-Community",
    "https://github.com/u2bo/OpenChatGPTSkin-Community/",
    "https://github.com/u2bo/OpenChatGPTSkin-Community?ref=main",
    "https://github.com/u2bo/OpenChatGPTSkin-Community#readme",
  ])("rejects an invalid release repository: %s", async (releaseRepository) => {
    const { file } = await catalogFile();
    const output = io();

    expect(await runCommunityCatalogCli([
      "validate",
      "--file", file,
      "--release-repository", releaseRepository,
      "--site-origin", "https://u2bo.github.io/OpenChatGPTSkin-Community",
    ], output.adapter)).toBe(64);
    expect(JSON.parse(output.stderr.join(""))).toMatchObject({ error: { code: "CLI_USAGE" } });
  });
});
