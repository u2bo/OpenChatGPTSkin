import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { z } from "zod";
import { RuntimeError } from "../errors.js";

const ControllerLockRecordSchema = z.object({
  schemaVersion: z.literal(1),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
}).strict();

export type ControllerLockIdentity = z.infer<typeof ControllerLockRecordSchema>;
export type InspectProcessStartedAt = (pid: number) => Promise<string | null>;

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function staleLockError(): RuntimeError {
  return new RuntimeError(
    "RUNTIME_SESSION_STALE",
    "The Runtime controller lock record is invalid",
    "Inspect the Runtime data directory before retrying.",
  );
}

function busyError(): RuntimeError {
  return new RuntimeError(
    "RUNTIME_BUSY",
    "Another Runtime controller owns the session",
    "Wait for the existing Runtime controller to become ready.",
  );
}

async function writeExclusiveLock(path: string, identity: ControllerLockIdentity): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(identity)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readLock(path: string): Promise<ControllerLockIdentity> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw busyError();
    throw error;
  }
  try {
    return ControllerLockRecordSchema.parse(JSON.parse(text));
  } catch {
    throw staleLockError();
  }
}

export class ControllerLock {
  private released = false;

  private constructor(
    private readonly path: string,
    private readonly identity: ControllerLockIdentity,
  ) {}

  static async acquire(
    path: string,
    identity: Omit<ControllerLockIdentity, "schemaVersion">,
    inspectProcessStartedAt: InspectProcessStartedAt,
  ): Promise<ControllerLock> {
    const record = ControllerLockRecordSchema.parse({ schemaVersion: 1, ...identity });
    try {
      await writeExclusiveLock(path, record);
      return new ControllerLock(path, record);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }

    const existing = await readLock(path);
    const observedStartedAt = await inspectProcessStartedAt(existing.pid);
    if (observedStartedAt === existing.startedAt) throw busyError();

    const stalePath = `${path}.stale-${randomUUID()}`;
    try {
      await rename(path, stalePath);
    } catch (error) {
      if (isErrno(error, "ENOENT") || isErrno(error, "EEXIST")) throw busyError();
      throw error;
    }

    let lock: ControllerLock | null = null;
    try {
      await writeExclusiveLock(path, record);
      lock = new ControllerLock(path, record);
      await unlink(stalePath);
      return lock;
    } catch (error) {
      if (lock) await lock.release();
      if (isErrno(error, "EEXIST")) throw busyError();
      throw error;
    }
  }

  async release(): Promise<void> {
    if (this.released) return;

    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        this.released = true;
        return;
      }
      throw error;
    }

    let current: ControllerLockIdentity;
    try {
      current = ControllerLockRecordSchema.parse(JSON.parse(text));
    } catch {
      // An altered lock is preserved as evidence and must never be removed by this owner.
      this.released = true;
      return;
    }
    if (current.pid !== this.identity.pid || current.startedAt !== this.identity.startedAt) {
      this.released = true;
      return;
    }

    try {
      await unlink(this.path);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }
    this.released = true;
  }
}
