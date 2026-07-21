import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ControllerLock } from "@open-chatgpt-skin/windows-runtime";

const firstIdentity = {
  pid: 100,
  startedAt: "2026-07-17T00:00:00.000Z",
} as const;

const secondIdentity = {
  pid: 200,
  startedAt: "2026-07-17T00:00:01.000Z",
} as const;

describe("ControllerLock", () => {
  it("permits one live owner and removes only its own lock", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ocs-lock-")), "controller.lock");
    const inspect = vi.fn(async (pid: number) =>
      pid === firstIdentity.pid ? firstIdentity.startedAt : null,
    );
    const first = await ControllerLock.acquire(path, firstIdentity, inspect);

    await expect(ControllerLock.acquire(path, secondIdentity, inspect))
      .rejects.toMatchObject({ code: "RUNTIME_BUSY" });

    await first.release();
    const second = await ControllerLock.acquire(path, secondIdentity, inspect);
    await second.release();
  });

  it("reclaims a stale lock with an atomic rename", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ocs-lock-")), "controller.lock");
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, ...firstIdentity })}\n`);

    const lock = await ControllerLock.acquire(
      path,
      secondIdentity,
      vi.fn(async () => null),
    );

    await lock.release();
  });

  it("preserves malformed lock evidence instead of deleting it", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "ocs-lock-")), "controller.lock");
    await writeFile(path, "{ not-json");

    await expect(ControllerLock.acquire(path, secondIdentity, vi.fn(async () => null)))
      .rejects.toMatchObject({ code: "RUNTIME_SESSION_STALE" });
    await expect(readFile(path, "utf8")).resolves.toBe("{ not-json");
  });
});
