import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  ControlCommandSchema,
  ControlResponseSchema,
} from "./control/result.js";
import { RuntimeError } from "./errors.js";
import {
  PendingOperationSchema,
  RuntimeAdapterIdentitySchema,
  RuntimeCdpIdentitySchema,
  RuntimeCodexIdentitySchema,
  RuntimeProcessSchema,
  RuntimeStatusSchema,
  RuntimeThemeRefSchema,
  type RuntimeThemeRef,
} from "./session/model.js";

export * from "./session/model.js";

export const RecentRequestSchema = z.object({
  requestId: z.string().uuid(),
  command: ControlCommandSchema,
  response: ControlResponseSchema,
  completedAt: z.string().datetime(),
}).strict();

export type RecentRequest = z.infer<typeof RecentRequestSchema>;

function sameTheme(
  left: RuntimeThemeRef | null,
  right: RuntimeThemeRef | null,
): boolean {
  return left !== null && right !== null &&
    left.id === right.id && left.version === right.version;
}

function addStateIssue(
  context: z.RefinementCtx,
  message: string,
  path: readonly (string | number)[] = [],
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message, path: [...path] });
}

export const RuntimeSessionStateSchema = z.object({
  schemaVersion: z.literal(2),
  sessionId: z.string().uuid(),
  status: RuntimeStatusSchema,
  runtime: RuntimeProcessSchema,
  codex: RuntimeCodexIdentitySchema.nullable(),
  cdp: RuntimeCdpIdentitySchema.nullable(),
  adapter: RuntimeAdapterIdentitySchema.nullable(),
  selectedTheme: RuntimeThemeRefSchema,
  appliedTheme: RuntimeThemeRefSchema.nullable(),
  skinApplied: z.boolean().nullable(),
  pendingOperation: PendingOperationSchema.nullable(),
  recentRequests: z.array(RecentRequestSchema).max(32),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict().superRefine((state, context) => {
  if (state.status === "active") {
    if (!state.codex || !state.cdp || !state.adapter) {
      addStateIssue(context, "active state requires complete managed identities");
    }
    if (state.skinApplied !== true || !sameTheme(state.selectedTheme, state.appliedTheme)) {
      addStateIssue(context, "active state requires the selected theme to be verified as applied");
    }
  }

  if (state.status !== "launching" && (!state.codex || !state.cdp)) {
    addStateIssue(context, `${state.status} requires exact Codex and CDP identities`);
  }

  if (["active", "paused", "paused-incompatible"].includes(state.status) && !state.adapter) {
    addStateIssue(context, `${state.status} requires the last verified Adapter identity`);
  }

  if (["paused", "paused-incompatible", "restored-awaiting-exit", "restored-cleanup-required"]
    .includes(state.status) &&
    (state.appliedTheme !== null || state.skinApplied !== false)) {
    addStateIssue(context, `${state.status} requires verified official appearance`);
  }

  if (state.status === "recovery-required" &&
    (state.appliedTheme !== null || state.skinApplied !== null)) {
    addStateIssue(context, "recovery-required must represent unknown appearance");
  }

  if (state.status === "restoring" && state.pendingOperation?.kind !== "restore") {
    addStateIssue(context, "restoring requires a restore pending operation");
  }

  const byRequestId = new Map<string, RecentRequest>();
  for (const [index, record] of state.recentRequests.entries()) {
    if (record.response.requestId !== record.requestId) {
      addStateIssue(context, "recent response request ID must match its record", ["recentRequests", index]);
    }
    const prior = byRequestId.get(record.requestId);
    if (prior && prior.command !== record.command) {
      addStateIssue(context, "recent request IDs cannot belong to different commands", ["recentRequests", index]);
    }
    byRequestId.set(record.requestId, record);
  }
});

export type RuntimeSessionState = z.infer<typeof RuntimeSessionStateSchema>;

function sameRecentResponse(left: RecentRequest, right: RecentRequest): boolean {
  return left.command === right.command &&
    left.completedAt === right.completedAt &&
    JSON.stringify(left.response) === JSON.stringify(right.response);
}

function mergeRecentRequests(
  current: readonly RecentRequest[],
  incoming: readonly RecentRequest[],
): RecentRequest[] {
  const result: RecentRequest[] = [];
  const byRequestId = new Map<string, RecentRequest>();
  for (const record of [...current, ...incoming]) {
    const validated = RecentRequestSchema.parse(record);
    const prior = byRequestId.get(validated.requestId);
    if (prior) {
      if (!sameRecentResponse(prior, validated)) {
        throw new RuntimeError(
          "RUNTIME_SESSION_STALE",
          "Recent Runtime response records conflict",
        );
      }
      continue;
    }
    byRequestId.set(validated.requestId, validated);
    result.push(validated);
  }
  return result.slice(-32);
}

export class RuntimeStateStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async read(): Promise<RuntimeSessionState | null> {
    await this.writeQueue;
    return this.readCurrent();
  }

  async write(value: RuntimeSessionState): Promise<void> {
    const incoming = RuntimeSessionStateSchema.parse(value);
    await this.enqueue(async () => {
      const current = await this.readCurrent();
      const state = RuntimeSessionStateSchema.parse({
        ...incoming,
        recentRequests: mergeRecentRequests(current?.recentRequests ?? [], incoming.recentRequests),
      });
      await this.writeCurrent(state);
    });
  }

  async appendRecentRequest(record: RecentRequest): Promise<boolean> {
    const incoming = RecentRequestSchema.parse(record);
    return this.enqueue(async () => {
      const current = await this.readCurrent();
      if (!current) return false;

      const prior = current.recentRequests.find((entry) => entry.requestId === incoming.requestId);
      if (prior) {
        if (!sameRecentResponse(prior, incoming)) {
          throw new RuntimeError(
            "RUNTIME_SESSION_STALE",
            "Recent Runtime response records conflict",
          );
        }
        return true;
      }

      const next = RuntimeSessionStateSchema.parse({
        ...current,
        recentRequests: mergeRecentRequests(current.recentRequests, [incoming]),
        updatedAt: incoming.completedAt,
      });
      await this.writeCurrent(next);
      return true;
    });
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      try {
        await unlink(this.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
  }

  private async readCurrent(): Promise<RuntimeSessionState | null> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    try {
      return RuntimeSessionStateSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new RuntimeError(
        "RUNTIME_SESSION_STALE",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async writeCurrent(state: RuntimeSessionState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}-${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);

    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary);
      throw error;
    }

    await handle.close();
    await rename(temporary, this.path);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(operation).finally(release);
  }
}
