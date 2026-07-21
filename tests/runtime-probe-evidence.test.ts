import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  ProbeEvidenceSchema,
  recordProbeEvidence,
} from "@open-chatgpt-skin/windows-runtime";

const evidence = {
  schemaVersion: 2,
  packageIdentity: "OpenAI.Codex",
  packageVersion: "26.707.9981.0",
  target: {
    type: "page",
    protocol: "https:",
    host: "chatgpt.com",
    pathCategory: "codex",
  },
  capabilities: {
    main: true,
    navigation: true,
    composer: true,
  },
  markerRoundTrip: true,
  loopbackOnly: true,
  windowActivationVerified: true,
  officialAppearanceRestored: true,
  managedExitVerified: true,
  cdpClosedVerified: true,
} as const;

describe("probe evidence", () => {
  it("rejects privacy-sensitive extra fields", () => {
    expect(ProbeEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(() => ProbeEvidenceSchema.parse({
      ...evidence,
      pid: 123,
      port: 9222,
      startedAt: "2026-07-16T00:00:00.000Z",
      executablePath: "C:/Users/name/secret.exe",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/secret",
    })).toThrow();
    expect(() => ProbeEvidenceSchema.parse({
      ...evidence,
      schemaVersion: 1,
      normalRelaunchVerified: true,
    })).toThrow();
  });

  it("records only the version-derived evidence filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-probe-evidence-"));

    const path = await recordProbeEvidence(root, evidence);

    expect(path).toBe(join(
      root,
      "docs",
      "runtime-probes",
      "codex-26.707.9981.0.json",
    ));
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(evidence);
  });

  it("writes evidence through a sibling temporary file before rename", async () => {
    const mkdir = vi.fn(async () => {});
    const writeFile = vi.fn(async () => {});
    const rename = vi.fn(async () => {});
    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({ mkdir, writeFile, rename }));
    try {
      const module = await import("../runtime/windows/src/probe-evidence.js");
      const root = "D:/repo";
      const path = await module.recordProbeEvidence(root, evidence);
      const [temporaryPath] = writeFile.mock.calls[0] ?? [];

      expect(temporaryPath).toMatch(
        /codex-26\.707\.9981\.0\.json\.\d+-[0-9a-f-]+\.tmp$/,
      );
      expect(rename).toHaveBeenCalledWith(temporaryPath, path);
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
    }
  });
});
