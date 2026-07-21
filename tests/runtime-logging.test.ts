import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeLogger } from "@open-chatgpt-skin/windows-runtime";

describe("RuntimeLogger", () => {
  it("accepts the bounded theme-switch completion event", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-log-"));
    const logger = new RuntimeLogger(join(root, "runtime.jsonl"));

    await logger.write({
      schemaVersion: 1,
      timestamp: "2026-07-17T00:00:00.000Z",
      event: "theme-switch-complete",
      runtimeVersion: "0.1.0",
      packageVersion: "26.707.12708.0",
      adapterId: "current-2026-07",
      themeId: "mountain-mist",
      durationMs: 250,
    });

    expect(await readFile(join(root, "runtime.jsonl"), "utf8"))
      .toContain("theme-switch-complete");
  });

  it("rejects content-shaped fields and PID metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-log-"));
    const logger = new RuntimeLogger(join(root, "runtime.jsonl"));
    const entry = {
      schemaVersion: 1 as const,
      timestamp: "2026-07-17T00:00:00.000Z",
      event: "theme-applied" as const,
      runtimeVersion: "0.1.0",
    };

    await expect(logger.write({ ...entry, content: "private chat text" } as never))
      .rejects.toThrow();
    await expect(logger.write({ ...entry, pid: 100 } as never))
      .rejects.toThrow();
    await expect(logger.write({ ...entry, themeId: "private chat text" } as never))
      .rejects.toThrow();
  });
});
