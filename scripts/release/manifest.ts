import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PRODUCT_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

const ReleaseFileSchema = z.object({
  path: z.string().min(1).max(500).refine((path) =>
    !path.startsWith("/") && !path.startsWith("\\") &&
    !path.includes("\\") && !path.split("/").includes(".."),
  "release paths must be portable relative paths"),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(SHA256_PATTERN),
}).strict();

export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(2),
  product: z.literal("OpenChatGPTSkin"),
  version: z.string().regex(PRODUCT_VERSION_PATTERN),
  target: z.enum(["windows-x64", "macos-arm64", "macos-x64"]),
  roles: z.tuple([z.literal("studio"), z.literal("controller"), z.literal("runtime")]),
  host: z.object({
    language: z.literal("go"),
    goVersion: z.string().regex(/^go\d+\.\d+(?:\.\d+)?$/),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    dirty: z.boolean(),
    entry: ReleaseFileSchema,
  }).strict(),
  contracts: z.object({
    studio: z.literal(2),
    runtime: z.literal(1),
    theme: z.literal(4),
    data: z.literal(1),
    sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  cdpAdapter: z.object({
    sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  themes: z.object({
    catalogSchemaVersion: z.literal(1),
    builtins: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).min(1),
  }).strict(),
  image: z.object({
    implementation: z.string().min(1).max(160),
    cgo: z.literal(false),
  }).strict(),
  sidecars: z.array(ReleaseFileSchema).max(0),
  files: z.array(ReleaseFileSchema).min(1),
}).strict().superRefine((manifest, context) => {
  const builtins = new Set(manifest.themes.builtins);
  if (builtins.size !== manifest.themes.builtins.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["themes", "builtins"], message: "built-in theme IDs must be unique" });
  }
  const files = new Set<string>();
  for (const [index, file] of manifest.files.entries()) {
    if (file.path === "release-manifest.json" || files.has(file.path)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["files", index, "path"], message: "release file path is invalid or duplicated" });
    }
    files.add(file.path);
  }
  if (!files.has(manifest.host.entry.path)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["host", "entry", "path"], message: "host entry must be declared in files" });
  }
});

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export async function readReleaseManifest(releaseRoot: string): Promise<ReleaseManifest> {
  const value = JSON.parse(await readFile(join(releaseRoot, "release-manifest.json"), "utf8")) as unknown;
  return ReleaseManifestSchema.parse(value);
}
