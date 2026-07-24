import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { STUDIO_PROTOCOL_VERSION } from
  "../../packages/theme-studio-core/src/contracts.js";
import { THEME_SCHEMA_VERSION } from
  "../../packages/theme-schema/src/index.js";
import { CONTROL_PROTOCOL_VERSION } from
  "../../runtime/windows/src/control/result.js";
import { z } from "zod";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASELINE_RELATIVE_PATH = "contracts/baseline/v0.2.0/release-assets.json";
const DIRECTORY_HASH_ALGORITHM = "sha256-path-length-content-v1";

const HashSchema = z.string().regex(SHA256_PATTERN);

const FileMeasurementSchema = z.object({
  bytes: z.number().int().nonnegative(),
  sha256: HashSchema,
}).strict();

const BaselineSchema = z.object({
  schemaVersion: z.literal(1),
  baselineVersion: z.literal("0.2.0"),
  release: z.object({
    tag: z.literal("v0.2.0"),
    publishedAt: z.string().datetime(),
    assets: z.array(z.object({
      name: z.string().min(1),
      platform: z.enum(["windows", "macos", "all"]),
      arch: z.enum(["x64", "arm64", "all"]),
      kind: z.enum(["setup", "zip", "dmg", "tar.gz", "checksums"]),
      bytes: z.number().int().positive(),
      sha256: HashSchema,
    }).strict()).length(7),
  }).strict(),
  stages: z.array(z.object({
    target: z.enum(["windows-x64", "macos-arm64", "macos-x64"]),
    sourceAsset: z.string().min(1),
    totalBytes: z.number().int().positive(),
    composition: z.record(z.string(), z.number().int().nonnegative()),
  }).strict()).length(3),
  contracts: z.object({
    studioProtocol: z.literal(2),
    runtimeControl: z.literal(1),
    theme: z.literal(4),
    draft: z.literal(1),
    runtimeState: z.literal(2),
    trustedInstallCache: z.literal(1),
    themeStore: z.literal(1),
    controllerLock: z.literal(1),
    releaseManifest: z.literal(1),
    themeCatalog: z.literal(1),
  }).strict(),
  themes: z.object({
    catalog: FileMeasurementSchema,
    directoryHashAlgorithm: z.literal(DIRECTORY_HASH_ALGORITHM),
    builtins: z.array(z.object({
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      path: z.string().regex(/^builtin\/[a-z0-9]+(?:-[a-z0-9]+)*$/),
      bytes: z.number().int().positive(),
      fileCount: z.number().int().positive(),
      sha256: HashSchema,
    }).strict()).length(5),
  }).strict(),
}).strict();

type FrozenBaseline = z.infer<typeof BaselineSchema>;

export interface BaselineVerificationReport {
  readonly baselineVersion: "0.2.0";
  readonly releaseAssetCount: 7;
  readonly stageCount: 3;
  readonly themeCount: 5;
  readonly verified: true;
}

interface DirectoryMeasurement {
  readonly bytes: number;
  readonly fileCount: number;
  readonly sha256: string;
}

interface ThemeCatalog {
  readonly schemaVersion: number;
  readonly builtins: readonly {
    readonly id: string;
    readonly path: string;
  }[];
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`Baseline theme contains a non-file entry: ${path}`);
    }
  }
  return files.sort((left, right) =>
    toPortablePath(relative(root, left)).localeCompare(
      toPortablePath(relative(root, right)),
      "en",
    )
  );
}

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

async function measureDirectory(root: string): Promise<DirectoryMeasurement> {
  const hash = createHash("sha256");
  let bytes = 0;
  const files = await walkFiles(root);
  for (const path of files) {
    const relativePath = toPortablePath(relative(root, path));
    const contents = await readFile(path);
    bytes += contents.length;
    hash.update(relativePath, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(String(contents.length), "ascii");
    hash.update(Buffer.from([0]));
    hash.update(contents);
  }
  return { bytes, fileCount: files.length, sha256: hash.digest("hex") };
}

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Baseline ${label} must be unique`);
  }
}

function assertPrivacy(value: unknown, path = "baseline"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPrivacy(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (/^(?:pid|port|token|session|userName|projectName|absolutePath)$/i.test(key)) {
        throw new Error(`Baseline contains forbidden sensitive field: ${path}.${key}`);
      }
      assertPrivacy(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (/^[a-z]:[\\/]/i.test(value) ||
    /^\/(?:Users|home)\//.test(value) ||
    /(?:^|[\\/])AppData(?:[\\/]|$)/i.test(value)) {
    throw new Error(`Baseline contains an absolute user path: ${path}`);
  }
}

function assertStage(stage: FrozenBaseline["stages"][number]): void {
  const required = [
    "apps",
    "LICENSE",
    "node_modules",
    "launcher",
    "README.en.md",
    "README.md",
    "release-manifest.json",
    "runtime",
    "themes",
  ];
  for (const component of required) {
    if (!(component in stage.composition)) {
      throw new Error(`Baseline stage ${stage.target} is missing ${component}`);
    }
  }
  const measuredTotal = Object.values(stage.composition).reduce(
    (total, componentBytes) => total + componentBytes,
    0,
  );
  if (measuredTotal !== stage.totalBytes) {
    throw new Error(
      `Baseline stage ${stage.target} total mismatch: ${measuredTotal} != ${stage.totalBytes}`,
    );
  }
}

async function readBaseline(workspaceRoot: string): Promise<FrozenBaseline> {
  const path = join(workspaceRoot, ...BASELINE_RELATIVE_PATH.split("/"));
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  assertPrivacy(value);
  return BaselineSchema.parse(value);
}

export async function verifyFrozenBaseline(
  workspaceRootInput: string,
): Promise<BaselineVerificationReport> {
  const workspaceRoot = resolve(workspaceRootInput);
  const baseline = await readBaseline(workspaceRoot);

  assertUnique(baseline.release.assets.map((asset) => asset.name), "release asset names");
  assertUnique(baseline.stages.map((stage) => stage.target), "stage targets");
  assertUnique(baseline.themes.builtins.map((theme) => theme.id), "theme IDs");
  baseline.stages.forEach(assertStage);

  if (baseline.contracts.studioProtocol !== STUDIO_PROTOCOL_VERSION ||
    baseline.contracts.runtimeControl !== CONTROL_PROTOCOL_VERSION ||
    baseline.contracts.theme !== THEME_SCHEMA_VERSION) {
    throw new Error("Baseline protocol versions do not match the Node author sources");
  }

  const themesRoot = join(workspaceRoot, "themes");
  const catalogBytes = await readFile(join(themesRoot, "catalog.json"));
  if (catalogBytes.length !== baseline.themes.catalog.bytes ||
    sha256(catalogBytes) !== baseline.themes.catalog.sha256) {
    throw new Error("Baseline theme catalog hash does not match the workspace");
  }
  const catalog = JSON.parse(catalogBytes.toString("utf8")) as ThemeCatalog;
  if (catalog.schemaVersion !== baseline.contracts.themeCatalog) {
    throw new Error("Baseline theme catalog schema version does not match the workspace");
  }

  const actualCatalogThemes = catalog.builtins.map(({ id, path }) => ({ id, path }));
  const expectedCatalogThemes = baseline.themes.builtins.map(({ id, path }) => ({ id, path }));
  if (JSON.stringify(actualCatalogThemes) !== JSON.stringify(expectedCatalogThemes)) {
    throw new Error("Baseline built-in theme catalog does not match the workspace");
  }

  for (const expected of baseline.themes.builtins) {
    const actual = await measureDirectory(
      join(themesRoot, ...expected.path.split("/")),
    );
    if (actual.bytes !== expected.bytes ||
      actual.fileCount !== expected.fileCount ||
      actual.sha256 !== expected.sha256) {
      throw new Error(`Baseline built-in theme changed: ${expected.id}`);
    }
  }

  const themePayloadBytes = baseline.themes.catalog.bytes +
    baseline.themes.builtins.reduce((total, theme) => total + theme.bytes, 0);
  for (const stage of baseline.stages) {
    if (stage.composition.themes !== themePayloadBytes) {
      throw new Error(`Baseline stage theme size changed: ${stage.target}`);
    }
  }

  return {
    baselineVersion: baseline.baselineVersion,
    releaseAssetCount: 7,
    stageCount: 3,
    themeCount: 5,
    verified: true,
  };
}
