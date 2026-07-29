import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REQUIRED_NODE_VERSION = "22.18.0" as const;
const WORKSPACES = [
  { name: "@open-chatgpt-skin/community-catalog", directory: "packages/community-catalog" },
  { name: "@open-chatgpt-skin/theme-core", directory: "packages/theme-core" },
  { name: "@open-chatgpt-skin/theme-schema", directory: "packages/theme-schema" },
] as const;

export interface CommunityToolingPackage {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CommunityToolingManifest {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly nodeVersion: typeof REQUIRED_NODE_VERSION;
  readonly packages: readonly CommunityToolingPackage[];
}

export interface CommunityToolingBuildOptions {
  readonly workspaceRoot: string;
  readonly outputDirectory: string;
}

interface PackageMetadata {
  readonly name: string;
  readonly version: string;
}

interface NpmPackResult {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readPackageMetadata(path: string): Promise<PackageMetadata> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isObject(parsed) || typeof parsed.name !== "string" ||
      typeof parsed.version !== "string") {
    throw new Error(`Package metadata is invalid: ${path}`);
  }
  return { name: parsed.name, version: parsed.version };
}

async function prepareEmptyOutputDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory()) throw new Error(`Community tooling output is not a directory: ${path}`);
    if ((await readdir(path)).length > 0) {
      throw new Error(`Community tooling output directory must be empty: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true });
  }
}

function npmInvocation(args: readonly string[]): { file: string; args: string[] } {
  const environmentCli = process.env.npm_execpath;
  if (environmentCli?.endsWith(".js")) {
    return { file: process.execPath, args: [environmentCli, ...args] };
  }
  const adjacentCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return { file: process.execPath, args: [adjacentCli, ...args] };
}

export async function runNpmCli(
  args: readonly string[],
  cwd: string,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const invocation = npmInvocation(args);
  return execFileAsync(invocation.file, invocation.args, {
    cwd,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function parsePackResult(stdout: string, expected: PackageMetadata): NpmPackResult {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isObject(parsed[0])) {
    throw new Error(`npm pack must produce exactly one archive for ${expected.name}`);
  }
  const result = parsed[0];
  if (result.name !== expected.name || result.version !== expected.version ||
      typeof result.filename !== "string") {
    throw new Error(`npm pack metadata does not match ${expected.name}@${expected.version}`);
  }
  return {
    name: result.name,
    version: result.version,
    filename: result.filename,
  };
}

function resolvePackedFile(outputDirectory: string, filename: string): string {
  if (!filename || filename.includes("/") || filename.includes("\\")) {
    throw new Error(`npm pack returned an unsafe filename: ${filename}`);
  }
  const path = resolve(outputDirectory, filename);
  if (dirname(path) !== outputDirectory) {
    throw new Error(`npm pack returned a file outside the output directory: ${filename}`);
  }
  return path;
}

async function writeManifestAtomically(
  outputDirectory: string,
  manifest: CommunityToolingManifest,
): Promise<void> {
  const destination = join(outputDirectory, "community-tooling.json");
  const temporary = join(
    outputDirectory,
    `.community-tooling.${process.pid}-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await link(temporary, destination);
  } finally {
    await unlink(temporary);
  }
}

export async function buildCommunityTooling(
  options: CommunityToolingBuildOptions,
): Promise<CommunityToolingManifest> {
  if (process.versions.node !== REQUIRED_NODE_VERSION) {
    throw new Error(
      `Community tooling requires Node.js ${REQUIRED_NODE_VERSION}, received ${process.versions.node}`,
    );
  }
  const workspaceRoot = resolve(options.workspaceRoot);
  const outputDirectory = resolve(options.outputDirectory);
  await prepareEmptyOutputDirectory(outputDirectory);

  const rootMetadata = await readPackageMetadata(join(workspaceRoot, "package.json"));
  const packages: CommunityToolingPackage[] = [];
  for (const workspace of WORKSPACES) {
    const metadata = await readPackageMetadata(
      join(workspaceRoot, workspace.directory, "package.json"),
    );
    if (metadata.name !== workspace.name) {
      throw new Error(`Unexpected workspace package name: ${metadata.name}`);
    }
    if (metadata.version !== rootMetadata.version) {
      throw new Error(
        `Workspace version mismatch: ${metadata.name}@${metadata.version} != ${rootMetadata.version}`,
      );
    }
    const { stdout } = await runNpmCli([
      "pack",
      "--workspace", metadata.name,
      "--pack-destination", outputDirectory,
      "--json",
    ], workspaceRoot);
    const packed = parsePackResult(stdout, metadata);
    const filePath = resolvePackedFile(outputDirectory, packed.filename);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`Packed community tooling artifact is not a file: ${packed.filename}`);
    const bytes = await readFile(filePath);
    packages.push({
      name: metadata.name,
      version: metadata.version,
      file: packed.filename,
      bytes: info.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  packages.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const manifest: CommunityToolingManifest = {
    schemaVersion: 1,
    productVersion: rootMetadata.version,
    nodeVersion: REQUIRED_NODE_VERSION,
    packages,
  };
  await writeManifestAtomically(outputDirectory, manifest);
  return manifest;
}
