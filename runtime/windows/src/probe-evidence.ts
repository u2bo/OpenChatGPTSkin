import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const ProbeObservationSchema = z.object({
  packageIdentity: z.literal("OpenAI.Codex"),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  target: z.object({
    type: z.literal("page"),
    protocol: z.enum(["app:", "https:"]),
    host: z.string().max(100),
    pathCategory: z.enum(["app-root", "codex"]),
  }).strict(),
  capabilities: z.object({
    main: z.literal(true),
    navigation: z.literal(true),
    composer: z.literal(true),
  }).strict(),
  markerRoundTrip: z.literal(true),
  loopbackOnly: z.literal(true),
  windowActivationVerified: z.literal(true),
  officialAppearanceRestored: z.literal(true),
}).strict();

export type ProbeObservation = z.infer<typeof ProbeObservationSchema>;

export const ProbeEvidenceSchema = z.object({
  schemaVersion: z.literal(2),
  ...ProbeObservationSchema.shape,
  managedExitVerified: z.literal(true),
  cdpClosedVerified: z.literal(true),
}).strict();

export type ProbeEvidence = z.infer<typeof ProbeEvidenceSchema>;

export async function recordProbeEvidence(
  repositoryRoot: string,
  evidence: ProbeEvidence,
): Promise<string> {
  const validated = ProbeEvidenceSchema.parse(evidence);
  const directory = join(repositoryRoot, "docs", "runtime-probes");
  const path = join(directory, `codex-${validated.packageVersion}.json`);
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
  return path;
}
