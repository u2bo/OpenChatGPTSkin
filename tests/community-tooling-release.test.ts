import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCommunityTooling } from "../scripts/release/community-tooling.js";
import { writeReleaseChecksums } from "../scripts/release/checksums.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("community tooling release", () => {
  it("packs three version-matched workspaces and records exact digests", async () => {
    const output = await mkdtemp(join(tmpdir(), "community-tooling-"));
    temporaryRoots.push(output);

    const manifest = await buildCommunityTooling({
      workspaceRoot: process.cwd(),
      outputDirectory: output,
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      productVersion: "0.3.2",
      nodeVersion: "22.18.0",
    });
    expect(manifest.packages.map(({ name }) => name)).toEqual([
      "@open-chatgpt-skin/community-catalog",
      "@open-chatgpt-skin/theme-core",
      "@open-chatgpt-skin/theme-schema",
    ]);
    expect(manifest.packages.every(({ version, bytes, sha256 }) =>
      version === "0.3.2" && bytes > 0 && /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
    expect((await readdir(output)).filter((name) => name.endsWith(".tgz"))).toHaveLength(3);

    const manifestText = await readFile(join(output, "community-tooling.json"), "utf8");
    expect(manifestText).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(manifestText).not.toContain(process.cwd());
    expect(manifestText).not.toMatch(/timestamp|createdAt/i);
  }, 60_000);

  it("includes only tooling archives and the exact manifest JSON in shared checksums", async () => {
    const output = await mkdtemp(join(tmpdir(), "community-tooling-"));
    temporaryRoots.push(output);
    await buildCommunityTooling({ workspaceRoot: process.cwd(), outputDirectory: output });
    await writeFile(join(output, "report.json"), "{}\n", "utf8");

    const checksums = await writeReleaseChecksums(output);
    const text = await readFile(checksums, "utf8");

    expect(text.match(/\.tgz$/gm)).toHaveLength(3);
    expect(text).toContain("  community-tooling.json");
    expect(text).not.toContain("report.json");
  }, 60_000);

  it("produces identical package bytes and manifests across repeated builds", async () => {
    const firstOutput = await mkdtemp(join(tmpdir(), "community-tooling-"));
    const secondOutput = await mkdtemp(join(tmpdir(), "community-tooling-"));
    temporaryRoots.push(firstOutput, secondOutput);

    const first = await buildCommunityTooling({
      workspaceRoot: process.cwd(),
      outputDirectory: firstOutput,
    });
    const second = await buildCommunityTooling({
      workspaceRoot: process.cwd(),
      outputDirectory: secondOutput,
    });

    expect(second).toEqual(first);
    expect(await readFile(join(secondOutput, "community-tooling.json"), "utf8"))
      .toBe(await readFile(join(firstOutput, "community-tooling.json"), "utf8"));
  }, 60_000);

  it("rejects a non-empty output directory", async () => {
    const output = await mkdtemp(join(tmpdir(), "community-tooling-"));
    temporaryRoots.push(output);
    await writeFile(join(output, "existing.txt"), "occupied", "utf8");

    await expect(buildCommunityTooling({
      workspaceRoot: process.cwd(),
      outputDirectory: output,
    })).rejects.toThrow(/empty/i);
  });
});
