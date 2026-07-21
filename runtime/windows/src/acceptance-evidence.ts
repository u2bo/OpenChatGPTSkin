import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ACCEPTANCE_SWITCH_EDGES } from "./acceptance-sequence.js";
import { RUNTIME_BUILTIN_THEME_IDS, RuntimeBuiltinThemeIdSchema } from "./themes/ids.js";

const packageVersionSchema = z.string().regex(/^\d+\.\d+\.\d+\.\d+$/);

export const RuntimeAcceptanceThemeSchema = z.object({
  id: RuntimeBuiltinThemeIdSchema,
  applied: z.literal(true),
  verified: z.literal(true),
}).strict();

export const RuntimeAcceptanceSwitchSchema = z.object({
  from: RuntimeBuiltinThemeIdSchema,
  to: RuntimeBuiltinThemeIdSchema,
  verified: z.literal(true),
}).strict();

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

export const RuntimeAcceptanceEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  packageIdentity: z.literal("OpenAI.Codex"),
  packageVersion: packageVersionSchema,
  runtimeVersion: z.string().min(1).max(40),
  themes: z.array(RuntimeAcceptanceThemeSchema).length(RUNTIME_BUILTIN_THEME_IDS.length),
  switches: z.array(RuntimeAcceptanceSwitchSchema).length(ACCEPTANCE_SWITCH_EDGES.length),
  pauseVerified: z.literal(true),
  pausedSwitchVerified: z.literal(true),
  resumeVerified: z.literal(true),
  restoreVerified: z.literal(true),
  maxThemeOperationDurationMs: z.number().nonnegative().max(2_000),
  idleCpuPercent: z.number().nonnegative().lt(1),
  managedExitVerified: z.literal(true),
  cdpClosedVerified: z.literal(true),
  normalLaunchNoDebugArguments: z.literal(true),
}).strict().superRefine((value, context) => {
  const expectedThemes = new Set(RUNTIME_BUILTIN_THEME_IDS);
  const actualThemes = new Set(value.themes.map((theme) => theme.id));
  if (actualThemes.size !== expectedThemes.size ||
    [...expectedThemes].some((id) => !actualThemes.has(id))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["themes"],
      message: "acceptance evidence must verify every built-in theme exactly once",
    });
  }

  const expectedEdges = new Set(ACCEPTANCE_SWITCH_EDGES.map(([from, to]) => edgeKey(from, to)));
  const actualEdges = new Set(value.switches.map((edge) => edgeKey(edge.from, edge.to)));
  if (actualEdges.size !== expectedEdges.size ||
    [...expectedEdges].some((edge) => !actualEdges.has(edge))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["switches"],
      message: "acceptance evidence must verify every fixed switch edge exactly once",
    });
  }
});

export type RuntimeAcceptanceEvidence = z.infer<typeof RuntimeAcceptanceEvidenceSchema>;

export async function recordRuntimeAcceptanceEvidence(
  directory: string,
  evidence: RuntimeAcceptanceEvidence,
): Promise<string> {
  const validated = RuntimeAcceptanceEvidenceSchema.parse(evidence);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `codex-${validated.packageVersion}.json`);
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch((cleanupError: unknown) => {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError;
    });
    throw error;
  }
  await handle.close();
  await rename(temporary, path);
  return path;
}
