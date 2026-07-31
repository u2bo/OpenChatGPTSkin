import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptGoReleasePackages,
  buildGoReleasePackages,
  mergeGoReleasePackages,
} from "../scripts/release/go-release.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const releaseIntegrationTimeoutMs = 180_000;
const agentAcceptanceEvidence = {
  accepted: true,
  contractVersion: 1,
  protocolVersion: 1,
  themeSchemaVersion: 4,
  workflow: [
    "contract", "create", "config", "show",
    "validate", "pack", "unpack", "validate",
  ],
  pathCoverage: { spaces: true, unicode: true },
  failureScenarios: [
    { scenario: "missing-required-option", exitCode: 2, errorCode: "CLI_ARGUMENT_INVALID" },
    { scenario: "missing-background", exitCode: 1, errorCode: "CLI_READ" },
    { scenario: "existing-project", exitCode: 1, errorCode: "CLI_WRITE" },
    { scenario: "invalid-config", exitCode: 1, errorCode: "THEME_SCHEMA_INVALID" },
    { scenario: "existing-archive", exitCode: 1, errorCode: "CLI_WRITE" },
    { scenario: "existing-unpack-directory", exitCode: 1, errorCode: "CLI_WRITE" },
  ],
} as const;

function runAgentAcceptance(arguments_: readonly string[]) {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error("npm executable path is unavailable");
  return execFileAsync(process.execPath, [
    npmExecPath,
    "run",
    "--silent",
    "theme:agent-acceptance",
    "--",
    ...arguments_,
  ], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("Go host production packages", () => {
  it("uses the native Go release workflow for publishing", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-15");
    expect(workflow).toContain("macos-15-intel");
    expect(workflow).toContain("--native-only");
    expect(workflow).toContain("release:build");
    expect(workflow).toContain("release:acceptance");
    expect(workflow).toContain("gh release create");
    expect(workflow).not.toContain("release:node");
    expect(workflow).not.toContain("runtime/node");
  });

  it.runIf(process.platform === "win32" || process.platform === "darwin")(
    "builds only the current native host when native-only is requested", async () => {
    const output = await mkdtemp(join(tmpdir(), "openchatgptskin-go-release-"));
    temporaryRoots.push(output);
    const report = await buildGoReleasePackages({
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
    expect(report.artifacts[0]?.name).not.toContain("go-spike");
    expect(report.artifacts.every(({ bytes, baselineBytes }) => bytes < baselineBytes)).toBe(true);
    const stageRoot = join(output, "stages", expectedTarget.target, "OpenChatGPTSkin");
    const manifest = JSON.parse(await readFile(
      join(stageRoot, "release-manifest.json"),
      "utf8",
    )) as {
      readonly schemaVersion?: unknown;
      readonly roles?: unknown;
      readonly host?: { readonly language?: unknown };
    };
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      roles: ["studio", "controller", "runtime", "theme"],
      host: { language: "go" },
    });
    const executable = join(
      stageRoot,
      process.platform === "win32" ? "OpenChatGPTSkin.exe" : "OpenChatGPTSkin",
    );
    const themeHelp = await execFileAsync(executable, ["theme", "help"], {
      windowsHide: true,
    });
    expect(themeHelp.stderr).toBe("");
    expect(JSON.parse(themeHelp.stdout)).toMatchObject({
      role: "theme",
      protocolVersion: 1,
      commands: { create: expect.any(String), config: expect.any(String) },
    });
    const agentAcceptance = await runAgentAcceptance([
      "--executable", executable,
      "--label", "Vitest staged host",
    ]);
    expect(agentAcceptance.stderr).toBe("");
    expect(JSON.parse(agentAcceptance.stdout)).toEqual(agentAcceptanceEvidence);
    await expect(acceptGoReleasePackages(output, false)).resolves.toMatchObject({
      accepted: true,
      artifactCount: 1,
      nativeEvidenceComplete: false,
    });
  }, releaseIntegrationTimeoutMs);

  it("does not expose a missing executable path in acceptance diagnostics", async () => {
    const missingExecutable = join(tmpdir(), "Private User Path", "OpenChatGPTSkin.exe");
    let failure: unknown;
    try {
      await runAgentAcceptance(["--executable", missingExecutable]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    const result = failure as { readonly code?: unknown; readonly stdout?: unknown; readonly stderr?: unknown };
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    const envelope = JSON.parse(String(result.stderr));
    expect(envelope.error.message).not.toContain(missingExecutable);
    expect(envelope).toMatchObject({
      error: { code: "THEME_CLI_AGENT_ACCEPTANCE_FAILED" },
    });
  });

  it("merges three single-target native reports without cross-building", async () => {
    const root = await mkdtemp(join(tmpdir(), "openchatgptskin-go-release-merge-"));
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
      await writeFile(join(input, "go-release-report.json"), JSON.stringify({
        schemaVersion: 1,
        version: "0.3.2",
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
    const merged = await mergeGoReleasePackages(inputs, join(root, "combined"));
    expect(merged.targets.map(({ target }) => target)).toEqual(definitions.map(({ target }) => target));
    expect(merged.artifacts).toHaveLength(6);
  });
});
