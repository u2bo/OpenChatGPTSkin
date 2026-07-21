import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PendingProbeStore,
  createRuntimePaths,
} from "@open-chatgpt-skin/windows-runtime";

const passed = {
  schemaVersion: 1,
  sessionId: "00000000-0000-4000-8000-000000000001",
  status: "passed-awaiting-exit",
  root: { pid: 200, startedAt: "2026-07-16T00:00:01.000Z" },
  cdp: { host: "127.0.0.1", port: 55123 },
  packageVersion: "26.707.9981.0",
  observation: {
    packageIdentity: "OpenAI.Codex",
    packageVersion: "26.707.9981.0",
    target: { type: "page", protocol: "app:", host: "-", pathCategory: "app-root" },
    capabilities: { main: true, navigation: true, composer: true },
    markerRoundTrip: true,
    loopbackOnly: true,
    windowActivationVerified: true,
    officialAppearanceRestored: true,
  },
  recordEvidenceRequested: true,
  createdAt: "2026-07-16T00:00:02.000Z",
  updatedAt: "2026-07-16T00:00:02.000Z",
} as const;

describe("PendingProbeStore", () => {
  it("atomically writes, reads, and clears a strict session", async () => {
    const paths = createRuntimePaths(
      await mkdtemp(join(tmpdir(), "ocs-pending-probe-")),
      "D:/install",
    );
    const store = new PendingProbeStore(paths.pendingProbeFile);

    await store.write(passed);
    await expect(store.read()).resolves.toEqual(passed);
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
  });

  it("rejects privacy-expanded pending JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-pending-probe-"));
    const paths = createRuntimePaths(root, "D:/install");
    await mkdir(paths.runtimeDirectory, { recursive: true });
    await writeFile(
      paths.pendingProbeFile,
      JSON.stringify({ ...passed, commandLine: "secret" }),
    );

    await expect(new PendingProbeStore(paths.pendingProbeFile).read())
      .rejects.toMatchObject({ code: "PROBE_PENDING_SESSION_INVALID" });
  });
});
