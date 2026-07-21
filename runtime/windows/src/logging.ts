import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { RUNTIME_ERROR_CODES } from "./errors.js";
import { RuntimeBuiltinThemeIdSchema } from "./themes/ids.js";

const RuntimeLogEntrySchema = z.object({
  schemaVersion: z.literal(1),
  timestamp: z.string().datetime(),
  event: z.enum([
    "discovery-complete",
    "launch-started",
    "cdp-attached",
    "theme-applied",
    "theme-paused",
    "theme-resumed",
    "theme-switch-started",
    "theme-switch-complete",
    "runtime-recovered",
    "cleanup-waiting",
    "restore-started",
    "restore-complete",
    "runtime-error",
  ]),
  runtimeVersion: z.string().max(40),
  packageVersion: z.string().max(40).optional(),
  adapterId: z.string().max(80).optional(),
  themeId: RuntimeBuiltinThemeIdSchema.optional(),
  durationMs: z.number().int().nonnegative().max(600_000).optional(),
  errorCode: z.enum(RUNTIME_ERROR_CODES).optional(),
}).strict();

export type RuntimeLogEntry = z.infer<typeof RuntimeLogEntrySchema>;

export class RuntimeLogger {
  constructor(private readonly path: string) {}

  async write(value: RuntimeLogEntry): Promise<void> {
    const entry = RuntimeLogEntrySchema.parse(value);
    await mkdir(dirname(this.path), { recursive: true });
    try {
      if ((await stat(this.path)).size >= 2 * 1024 * 1024) {
        try {
          await unlink(`${this.path}.1`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(this.path, `${this.path}.1`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
