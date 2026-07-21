import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  RuntimeAcceptanceSwitchSchema,
  RuntimeAcceptanceThemeSchema,
} from "./acceptance-evidence.js";
import { ACCEPTANCE_SWITCH_EDGES } from "./acceptance-sequence.js";
import { RuntimeError } from "./errors.js";
import { RUNTIME_BUILTIN_THEME_IDS } from "./themes/ids.js";

const processIdentitySchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
}).strict();

const cdpSchema = z.object({
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65_535),
}).strict();

export const PendingAcceptanceSessionSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().uuid(),
  status: z.literal("awaiting-exit"),
  runtime: processIdentitySchema,
  root: processIdentitySchema,
  cdp: cdpSchema,
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  runtimeVersion: z.string().min(1).max(40),
  themes: z.array(RuntimeAcceptanceThemeSchema).length(RUNTIME_BUILTIN_THEME_IDS.length),
  switches: z.array(RuntimeAcceptanceSwitchSchema).length(ACCEPTANCE_SWITCH_EDGES.length),
  pauseVerified: z.literal(true),
  pausedSwitchVerified: z.literal(true),
  resumeVerified: z.literal(true),
  restoreVerified: z.literal(true),
  maxThemeOperationDurationMs: z.number().nonnegative().max(2_000),
  idleCpuPercent: z.number().nonnegative().lt(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type PendingAcceptanceSession = z.infer<typeof PendingAcceptanceSessionSchema>;

export interface AcceptanceSessionStore {
  read(): Promise<PendingAcceptanceSession | null>;
  write(value: PendingAcceptanceSession): Promise<void>;
  clear(): Promise<void>;
}

export class PendingAcceptanceStore implements AcceptanceSessionStore {
  constructor(private readonly path: string) {}

  async read(): Promise<PendingAcceptanceSession | null> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      return PendingAcceptanceSessionSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new RuntimeError(
        "RUNTIME_SESSION_STALE",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async write(value: PendingAcceptanceSession): Promise<void> {
    const session = PendingAcceptanceSessionSchema.parse(value);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}-${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(session, null, 2)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary).catch((cleanupError: unknown) => {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError;
      });
      throw error;
    }
    await handle.close();
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
