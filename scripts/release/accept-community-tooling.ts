import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { PRODUCT_VERSION_PATTERN } from "../../packages/theme-studio-core/src/security.js";
import { runNpmCli } from "./community-tooling.js";
import { requiredReleaseOption } from "./options.js";

const execFileAsync = promisify(execFile);
const PACKAGE_NAMES = [
  "@open-chatgpt-skin/community-catalog",
  "@open-chatgpt-skin/theme-core",
  "@open-chatgpt-skin/theme-schema",
] as const;
const CommunityToolingManifestSchema = z.object({
  schemaVersion: z.literal(1),
  productVersion: z.string().regex(PRODUCT_VERSION_PATTERN),
  nodeVersion: z.literal("22.18.0"),
  packages: z.array(z.object({
    name: z.enum(PACKAGE_NAMES),
    version: z.string().regex(PRODUCT_VERSION_PATTERN),
    file: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).length(PACKAGE_NAMES.length),
}).strict();

type CommunityToolingManifest = z.infer<typeof CommunityToolingManifestSchema>;

export interface CommunityToolingAcceptance {
  readonly accepted: true;
  readonly packageCount: 3;
  readonly cliValidated: true;
}

interface ValidatedTooling {
  readonly manifest: CommunityToolingManifest;
  readonly archives: ReadonlyMap<string, string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectedArchiveName(name: typeof PACKAGE_NAMES[number], version: string): string {
  return `${name.slice(1).replace("/", "-")}-${version}.tgz`;
}

async function validateTooling(outputDirectoryInput: string): Promise<ValidatedTooling> {
  const outputDirectory = resolve(outputDirectoryInput);
  const outputInfo = await lstat(outputDirectory);
  if (!outputInfo.isDirectory()) {
    throw new Error("Community tooling output must be a real directory");
  }
  const manifestPath = join(outputDirectory, "community-tooling.json");
  if (!(await lstat(manifestPath)).isFile()) {
    throw new Error("Community tooling manifest must be a regular file");
  }
  const manifest = CommunityToolingManifestSchema.parse(JSON.parse(await readFile(
    manifestPath,
    "utf8",
  )));
  if (process.versions.node !== manifest.nodeVersion) {
    throw new Error(
      `Community tooling acceptance requires Node.js ${manifest.nodeVersion}, received ${process.versions.node}`,
    );
  }
  const names = manifest.packages.map(({ name }) => name);
  if (new Set(names).size !== PACKAGE_NAMES.length ||
      names.some((name, index) => name !== PACKAGE_NAMES[index])) {
    throw new Error("Community tooling packages must be unique and sorted by package name");
  }
  if (manifest.packages.some(({ version }) => version !== manifest.productVersion)) {
    throw new Error("Community tooling package versions must match the product version");
  }

  const expectedEntries = new Set(["community-tooling.json"]);
  const archives = new Map<string, string>();
  for (const entry of manifest.packages) {
    const expectedFile = expectedArchiveName(entry.name, entry.version);
    if (entry.file !== expectedFile || entry.file.includes("/") || entry.file.includes("\\")) {
      throw new Error(`Community tooling archive filename is invalid: ${entry.file}`);
    }
    if (expectedEntries.has(entry.file)) {
      throw new Error(`Community tooling archive filename is duplicated: ${entry.file}`);
    }
    expectedEntries.add(entry.file);
    const path = resolve(outputDirectory, entry.file);
    const relativePath = relative(outputDirectory, path);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)) {
      throw new Error(`Community tooling archive is outside the output directory: ${entry.file}`);
    }
    const info = await lstat(path);
    if (!info.isFile() || info.size !== entry.bytes) {
      throw new Error(`Community tooling archive size does not match: ${entry.file}`);
    }
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    if (digest !== entry.sha256) {
      throw new Error(`Community tooling archive checksum does not match: ${entry.file}`);
    }
    archives.set(entry.name, path);
  }

  const directoryEntries = await readdir(outputDirectory, { withFileTypes: true });
  if (directoryEntries.length !== expectedEntries.size ||
      directoryEntries.some((entry) => !entry.isFile() || !expectedEntries.has(entry.name))) {
    throw new Error("Community tooling output contains an unexpected artifact");
  }
  return { manifest, archives };
}

async function resolveInstalledBin(
  projectDirectory: string,
  packageName: string,
  binName: string,
): Promise<string> {
  const packageDirectory = join(projectDirectory, "node_modules", ...packageName.split("/"));
  const metadata: unknown = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  if (!isObject(metadata) || !isObject(metadata.bin) || typeof metadata.bin[binName] !== "string") {
    throw new Error(`Installed package does not expose ${binName}`);
  }
  const binRelative = metadata.bin[binName];
  if (isAbsolute(binRelative) || binRelative.includes("\0")) {
    throw new Error(`Installed package exposes an unsafe bin path: ${binName}`);
  }
  const binPath = resolve(packageDirectory, binRelative);
  const relativePath = relative(packageDirectory, binPath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)) {
    throw new Error(`Installed package bin escapes its package: ${binName}`);
  }
  if (!(await lstat(binPath)).isFile()) {
    throw new Error(`Installed package bin is not a file: ${binName}`);
  }
  return binPath;
}

async function runJsonCli(
  label: string,
  file: string,
  args: readonly string[],
  cwd: string,
): Promise<Record<string, unknown>> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [file, ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch (error) {
    const stderr = (error as { readonly stderr?: unknown }).stderr;
    const detail = typeof stderr === "string" && stderr.trim() ? `: ${stderr.trim()}` : "";
    throw new Error(`${label} failed${detail}`);
  }
  const parsed: unknown = JSON.parse(stdout);
  if (!isObject(parsed) || parsed.valid !== true) {
    throw new Error(`${label} did not return a JSON success object`);
  }
  return parsed;
}

export async function acceptCommunityTooling(
  outputDirectory: string,
): Promise<CommunityToolingAcceptance> {
  const tooling = await validateTooling(outputDirectory);
  const projectDirectory = await mkdtemp(join(tmpdir(), "community-tooling-accept-"));
  try {
    const packageDirectory = join(projectDirectory, "packages");
    await mkdir(packageDirectory);
    const dependencies: Record<string, string> = {};
    for (const entry of tooling.manifest.packages) {
      const source = tooling.archives.get(entry.name);
      if (!source) throw new Error(`Community tooling archive is missing: ${entry.name}`);
      await copyFile(source, join(packageDirectory, entry.file));
      dependencies[entry.name] = `file:packages/${entry.file}`;
    }
    await writeFile(join(projectDirectory, "package.json"), `${JSON.stringify({
      name: "community-tooling-external-acceptance",
      private: true,
      type: "module",
      dependencies,
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    await runNpmCli([
      "install",
      "--ignore-scripts",
      "--package-lock=false",
      "--no-audit",
      "--no-fund",
    ], projectDirectory);

    const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const themeDirectory = join(projectDirectory, "fixture-theme");
    const catalogFile = join(projectDirectory, "community-catalog.json");
    await cp(join(repositoryRoot, "themes", "builtin", "mountain-mist"), themeDirectory, {
      recursive: true,
    });
    await copyFile(
      join(repositoryRoot, "tests", "fixtures", "community-catalog.json"),
      catalogFile,
    );

    const themeCli = await resolveInstalledBin(
      projectDirectory,
      "@open-chatgpt-skin/theme-core",
      "open-chatgpt-skin-theme",
    );
    const catalogCli = await resolveInstalledBin(
      projectDirectory,
      "@open-chatgpt-skin/community-catalog",
      "open-chatgpt-skin-community-catalog",
    );
    await runJsonCli("Theme CLI", themeCli, ["validate", "--dir", themeDirectory], projectDirectory);
    await runJsonCli("Community catalog CLI", catalogCli, [
      "validate",
      "--file", catalogFile,
      "--release-repository", "https://github.com/u2bo/OpenChatGPTSkin-Community",
      "--site-origin", "https://u2bo.github.io/OpenChatGPTSkin-Community",
    ], projectDirectory);

    return { accepted: true, packageCount: 3, cliValidated: true };
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = resolve(requiredReleaseOption(process.argv.slice(2), "--output"));
    process.stdout.write(`${JSON.stringify(await acceptCommunityTooling(output), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: {
        code: "COMMUNITY_TOOLING_ACCEPTANCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    })}\n`);
    process.exitCode = 1;
  }
}
