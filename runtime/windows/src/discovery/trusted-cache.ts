import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { VerifiedCodexInstall } from "../types.js";
import {
  MACOS_CODEX_BUNDLE_ID,
  MACOS_CODEX_ENTRY_POINT,
  MACOS_CODEX_IDENTITY_NAME,
  MACOS_CODEX_NOTARIZATION_AUTHORITY,
  MACOS_CODEX_RESOURCE_SIGNER,
  MACOS_CODEX_TEAM_ID,
} from "../macos/identity.js";

const TrustedWindowsCodexInstallSchema = z.object({
  schemaVersion: z.literal(1),
  packageRoot: z.string().min(1),
  entryPath: z.string().min(1),
  identityName: z.literal(MACOS_CODEX_IDENTITY_NAME),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  packagePublisher: z.string().min(1),
  appId: z.literal("App"),
  entryRelativePath: z.literal("app/ChatGPT.exe"),
  entryPoint: z.literal("Windows.FullTrustApplication"),
  packageSignatureStatus: z.literal("Valid"),
  packageSignerCommonName: z.literal("50BDFD77-8903-4850-9FFE-6E8522F64D5B"),
  catalogSignatureStatus: z.literal("Valid"),
  catalogSignerCommonName: z.literal("50BDFD77-8903-4850-9FFE-6E8522F64D5B"),
  entryBlockMapValid: z.literal(true),
  resourceSignatureStatus: z.literal("Valid"),
  resourceSignerCommonName: z.literal("OpenAI OpCo, LLC"),
  verifiedAt: z.string().datetime(),
}).strict();

const TrustedMacOsCodexInstallSchema = z.object({
  schemaVersion: z.literal(1),
  packageRoot: z.string().endsWith("/Codex.app"),
  entryPath: z.string().min(1),
  identityName: z.literal("OpenAI.Codex"),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
  packagePublisher: z.literal(MACOS_CODEX_TEAM_ID),
  appId: z.literal(MACOS_CODEX_BUNDLE_ID),
  entryRelativePath: z.string().regex(/^Contents\/MacOS\/[^/]+$/),
  entryPoint: z.literal(MACOS_CODEX_ENTRY_POINT),
  packageSignatureStatus: z.literal("Valid"),
  packageSignerCommonName: z.literal(MACOS_CODEX_TEAM_ID),
  catalogSignatureStatus: z.literal("Valid"),
  catalogSignerCommonName: z.literal(MACOS_CODEX_NOTARIZATION_AUTHORITY),
  entryBlockMapValid: z.literal(true),
  resourceSignatureStatus: z.literal("Valid"),
  resourceSignerCommonName: z.literal(MACOS_CODEX_RESOURCE_SIGNER),
  verifiedAt: z.string().datetime(),
}).strict();

const TrustedCodexInstallSchema = z.union([
  TrustedWindowsCodexInstallSchema,
  TrustedMacOsCodexInstallSchema,
]);

export type TrustedCodexInstall = z.infer<typeof TrustedCodexInstallSchema>;

export class TrustedInstallStore {
  constructor(private readonly path: string) {}

  async read(): Promise<TrustedCodexInstall | null> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    try {
      return TrustedCodexInstallSchema.parse(JSON.parse(text));
    } catch {
      const quarantine = join(
        dirname(this.path),
        `trusted-codex.invalid-${Date.now()}-${randomUUID()}.json`,
      );
      await rename(this.path, quarantine);
      return null;
    }
  }

  async write(install: VerifiedCodexInstall): Promise<void> {
    const value = TrustedCodexInstallSchema.parse({
      schemaVersion: 1,
      ...install,
      verifiedAt: new Date().toISOString(),
    });
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}-${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}
