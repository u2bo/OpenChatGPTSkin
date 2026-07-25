import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptGoSpikePackages,
  buildGoSpikePackages,
  mergeGoSpikePackages,
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

  it.runIf(process.platform === "win32" || process.platform === "darwin")(
    "builds only the current native host when native-only is requested", async () => {
    const output = await mkdtemp(join(tmpdir(), "openchatgptskin-go-spike-"));
    temporaryRoots.push(output);
    const report = await buildGoSpikePackages({
      workspaceRoot: process.cwd(),
      outputDirectory: output,
      nativeInstallers: false,
      nativeArtifactsOnly: true,
    });

    const expectedTarget = process.platform === "win32"
      ? { target: "windows-x64", executableFormat: "pe-x64", artifact: "zip-x64" }
      : process.arch === "arm64"
        ? { target: "macos-arm64", executableFormat: "mach-o-arm64", artifact: "tar.gz-arm64" }
        : { target: "macos-x64", executableFormat: "mach-o-x64", artifact: "tar.gz-x64" };
    expect(report.targets.map(({ target, executableFormat }) => ({ target, executableFormat })))
      .toEqual([{ target: expectedTarget.target, executableFormat: expectedTarget.executableFormat }]);
    expect(report.targets.every(({ stageBytes, baselineStageBytes }) =>
      stageBytes < baselineStageBytes
    )).toBe(true);
    expect(report.artifacts.map(({ kind }) => kind)).toEqual([expectedTarget.artifact]);
    expect(report.artifacts.every(({ bytes, baselineBytes }) => bytes < baselineBytes)).toBe(true);
    await expect(acceptGoSpikePackages(output, false)).resolves.toMatchObject({
      accepted: true,
      artifactCount: 1,
      nativeEvidenceComplete: false,
    });
  }, 60_000);

  it("merges three single-target native reports without cross-building", async () => {
    const root = await mkdtemp(join(tmpdir(), "openchatgptskin-go-spike-merge-"));
    temporaryRoots.push(root);
    const definitions = [
      { target: "windows-x64", format: "pe-x64", kinds: ["zip-x64", "setup-x64"] },
      { target: "macos-arm64", format: "mach-o-arm64", kinds: ["tar.gz-arm64", "dmg-arm64"] },
      { target: "macos-x64", format: "mach-o-x64", kinds: ["tar.gz-x64", "dmg-x64"] },
    ] as const;
    const inputs: string[] = [];
    for (const definition of definitions) {
      const input = join(root, definition.target);
      inputs.push(input);
      await mkdir(join(input, "stages", definition.target, "OpenChatGPTSkin"), { recursive: true });
      await writeFile(join(input, "stages", definition.target, "OpenChatGPTSkin", "marker.txt"), definition.target);
      const artifacts = await Promise.all(definition.kinds.map(async (kind) => {
        const name = `${definition.target}-${kind}.bin`;
        await writeFile(join(input, name), kind);
        return { name, kind, bytes: kind.length, sha256: "0".repeat(64), baselineBytes: 1_000_000 };
      }));
      await writeFile(join(input, "go-spike-report.json"), JSON.stringify({
        schemaVersion: 1,
        version: "0.3.0-alpha.1",
        imageImplementation: "gen2brain-webp-wasm2go-nodynamic-plus-internal-pipeline",
        cgo: false,
        sidecars: [],
        targets: [{
          target: definition.target,
          executableFormat: definition.format,
          executableBytes: 1,
          stageBytes: 1,
          baselineStageBytes: 1_000_000,
        }],
        artifacts,
      }));
    }
    const merged = await mergeGoSpikePackages(inputs, join(root, "combined"));
    expect(merged.targets.map(({ target }) => target)).toEqual(definitions.map(({ target }) => target));
    expect(merged.artifacts).toHaveLength(6);
  });
});
