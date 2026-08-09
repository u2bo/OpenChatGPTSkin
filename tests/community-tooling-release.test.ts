import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acceptCommunityTooling } from "../scripts/release/accept-community-tooling.js";
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
      productVersion: "0.4.2",
      nodeVersion: "22.18.0",
    });
    expect(manifest.packages.map(({ name }) => name)).toEqual([
      "@open-chatgpt-skin/community-catalog",
      "@open-chatgpt-skin/theme-core",
      "@open-chatgpt-skin/theme-schema",
    ]);
    expect(manifest.packages.every(({ version, bytes, sha256 }) =>
      version === "0.4.2" && bytes > 0 && /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
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

  it("rejects unknown manifest fields and tampered archive bytes", async () => {
    const output = await mkdtemp(join(tmpdir(), "community-tooling-"));
    temporaryRoots.push(output);
    const manifest = await buildCommunityTooling({
      workspaceRoot: process.cwd(),
      outputDirectory: output,
    });
    const manifestPath = join(output, "community-tooling.json");
    const manifestText = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, unknown: true }, null, 2)}\n`, "utf8");
    await expect(acceptCommunityTooling(output)).rejects.toThrow();

    await writeFile(manifestPath, manifestText, "utf8");
    const archivePath = join(output, manifest.packages[0]!.file);
    await writeFile(archivePath, Buffer.concat([
      await readFile(archivePath),
      Buffer.from("tampered"),
    ]));
    await expect(acceptCommunityTooling(output)).rejects.toThrow(/size|checksum/i);
  }, 60_000);

  it("installs the tarballs in a clean external project and runs both CLIs", async () => {
    const output = await mkdtemp(join(tmpdir(), "community-tooling-"));
    temporaryRoots.push(output);
    await buildCommunityTooling({ workspaceRoot: process.cwd(), outputDirectory: output });

    await expect(acceptCommunityTooling(output)).resolves.toEqual({
      accepted: true,
      packageCount: 3,
      cliValidated: true,
    });
  }, 120_000);

  it("keeps build jobs read-only and publishes tooling only after verify", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");

    expect(workflow).toMatch(/community-tooling:\r?\n\s+needs: verify/);
    expect(workflow).toContain("release:community-tooling:accept");
    expect(workflow).toContain("name: community-tooling");
    expect(workflow).toContain("community-tooling.json");
    expect(workflow).toContain("*.tgz");
    expect(workflow).toContain("needs: [native-release, community-tooling]");
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
  });
});
