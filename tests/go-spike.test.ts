import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptGoSpikePackages,
  buildGoSpikePackages,
} from "../scripts/release/go-spike.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("Go host feasibility packages", () => {
  it("records the incomplete native and security evidence without claiming Gate A", async () => {
    const evidence = JSON.parse(await readFile(
      "contracts/baseline/v0.2.0/go-spike-sizes.json",
      "utf8",
    )) as {
      readonly targets: readonly { readonly stageBytes: number; readonly baselineStageBytes: number }[];
      readonly artifacts: readonly { readonly bytes: number; readonly baselineBytes: number }[];
      readonly nativeEvidenceComplete: boolean;
      readonly blockingEvidence: readonly string[];
      readonly security: { readonly reachableStandardLibraryVulnerabilities: number };
    };
    expect(evidence.targets).toHaveLength(3);
    expect(evidence.targets.every(({ stageBytes, baselineStageBytes }) => stageBytes < baselineStageBytes)).toBe(true);
    expect(evidence.artifacts).toHaveLength(4);
    expect(evidence.artifacts.every(({ bytes, baselineBytes }) => bytes < baselineBytes)).toBe(true);
    expect(evidence.nativeEvidenceComplete).toBe(false);
    expect(evidence.blockingEvidence).toHaveLength(3);
    expect(evidence.security.reachableStandardLibraryVulnerabilities).toBe(10);
  });

  it("keeps the native spike workflow manual and separate from publishing", async () => {
    const workflow = await readFile(".github/workflows/go-host-spike.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-15");
    expect(workflow).toContain("macos-15-intel");
    expect(workflow).toContain("--native-only");
    expect(workflow).toContain("go-host-spike-macos-arm64");
    expect(workflow).toContain("go-host-spike-macos-x64");
    expect(workflow).toContain("go:spike:merge");
    expect(workflow).not.toContain("gh release create");
  });

  it("cross-builds one host for three targets and packages the reviewed payload", async () => {
    const output = await mkdtemp(join(tmpdir(), "openchatgptskin-go-spike-"));
    temporaryRoots.push(output);
    const report = await buildGoSpikePackages({
      workspaceRoot: process.cwd(),
      outputDirectory: output,
      nativeInstallers: false,
    });

    expect(report.targets.map(({ target, executableFormat }) => ({ target, executableFormat })))
      .toEqual([
        { target: "windows-x64", executableFormat: "pe-x64" },
        { target: "macos-arm64", executableFormat: "mach-o-arm64" },
        { target: "macos-x64", executableFormat: "mach-o-x64" },
      ]);
    expect(report.targets.every(({ stageBytes, baselineStageBytes }) =>
      stageBytes < baselineStageBytes
    )).toBe(true);
    expect(report.artifacts.map(({ kind }) => kind).sort()).toEqual([
      "tar.gz-arm64",
      "tar.gz-x64",
      "zip-x64",
    ]);
    expect(report.artifacts.every(({ bytes, baselineBytes }) => bytes < baselineBytes)).toBe(true);
    await expect(acceptGoSpikePackages(output, false)).resolves.toMatchObject({
      accepted: true,
      artifactCount: 3,
      nativeEvidenceComplete: false,
    });
  }, 60_000);
});
