import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { RUNTIME_ERROR_CODES, RuntimeError } from "./errors.js";
import { ProbeObservationSchema } from "./probe-evidence.js";

const baseShape = {
  schemaVersion: z.literal(1),
  sessionId: z.string().uuid(),
  root: z.object({
    pid: z.number().int().positive(),
    startedAt: z.string().datetime(),
  }).strict(),
  cdp: z.object({
    host: z.literal("127.0.0.1"),
    port: z.number().int().min(1).max(65535),
  }).strict(),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  recordEvidenceRequested: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

const PassedPendingProbeSchema = z.object({
  ...baseShape,
  status: z.literal("passed-awaiting-exit"),
  observation: ProbeObservationSchema,
}).strict();

const FailedPendingProbeSchema = z.object({
  ...baseShape,
  status: z.literal("failed-awaiting-exit"),
  failureCode: z.enum(RUNTIME_ERROR_CODES),
}).strict();

export const PendingProbeSessionSchema = z.discriminatedUnion("status", [
  PassedPendingProbeSchema,
  FailedPendingProbeSchema,
]);

export type PendingProbeSession = z.infer<typeof PendingProbeSessionSchema>;

export class PendingProbeStore {
  constructor(private readonly path: string) {}

  async read(): Promise<PendingProbeSession | null> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      return PendingProbeSessionSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new RuntimeError(
        "PROBE_PENDING_SESSION_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async write(value: PendingProbeSession): Promise<void> {
    const session = PendingProbeSessionSchema.parse(value);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}-${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
