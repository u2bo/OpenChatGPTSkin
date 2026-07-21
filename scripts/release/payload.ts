import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PRODUCT_VERSION_PATTERN } from
  "../../packages/theme-studio-core/src/security.js";

const PRODUCT = "OpenChatGPTSkin";
const SERVICE_PACKAGE = "@open-chatgpt-skin/theme-studio-service";
const INTERNAL_PACKAGE_PREFIX = "@open-chatgpt-skin/";
const RELEASE_MANIFEST_FILE = "release-manifest.json";
const BUILTIN_THEME_IDS = [
  "future-idol-cyan",
  "rose-carpet-star",
  "mountain-mist",
  "glacier-aurora",
] as const;

export type ReleasePlatform = "win32" | "darwin";
export type ReleaseArch = "x64" | "arm64";

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly workspaces?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

interface ThemeCatalog {
  readonly schemaVersion: number;
  readonly builtins: readonly {
    readonly id: string;
    readonly path: string;
  }[];
  readonly recipes?: readonly unknown[];
}

interface ThemeManifest {
  readonly schemaVersion: number;
  readonly themeId: string;
  readonly themeVersion: string;
  readonly files: Readonly<Record<string, {
    readonly bytes: number;
    readonly sha256: string;
  }>>;
}

export interface ReleaseManifest {
  readonly schemaVersion: 1;
  readonly product: typeof PRODUCT;
  readonly version: string;
  readonly target: {
    readonly platform: ReleasePlatform;
    readonly arch: ReleaseArch;
  };
  readonly runtime: {
    readonly nodeVersion: string;
  };
  readonly build: {
    readonly commit: string;
  };
  readonly themeCatalog: {
    readonly schemaVersion: number;
  };
  readonly entry: "OpenChatGPTSkin.cmd" | "OpenChatGPTSkin";
  readonly themes: readonly string[];
  readonly files: Readonly<Record<string, {
    readonly bytes: number;
    readonly sha256: string;
  }>>;
}

export interface StageReleasePayloadOptions {
  readonly workspaceRoot: string;
  readonly releaseRoot: string;
  readonly version: string;
  readonly platform: ReleasePlatform;
  readonly arch: ReleaseArch;
  readonly nodeVersion: string;
  readonly buildCommit: string;
  readonly nodeExecutablePath: string;
  readonly nodeLicensePath: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertReleaseVersion(
  version: unknown,
): asserts version is string {
  if (typeof version !== "string" ||
    !PRODUCT_VERSION_PATTERN.test(version)) {
    throw new Error(`Release version is invalid: ${String(version)}`);
  }
}

function assertBuildCommit(commit: unknown): asserts commit is string {
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`Release build commit is invalid: ${String(commit)}`);
  }
}

function assertNodeVersion(version: unknown): asserts version is string {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `Release Node Runtime version is invalid: ${String(version)}`,
    );
  }
}

export function assertReleaseTarget(platform: unknown, arch: unknown): void {
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`Unsupported release platform: ${platform}`);
  }
  if (arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported release architecture: ${arch}`);
  }
}

function releaseRelativePath(path: string): string {
  return path.split(sep).join("/");
}

function assertSafeRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.includes("\\")) {
    throw new Error(`Release path is invalid: ${path}`);
  }
  const normalized = path.split("/");
  if (normalized.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Release path is invalid: ${path}`);
  }
}

async function copyIntoRelease(
  source: string,
  releaseRoot: string,
  target: string,
): Promise<void> {
  assertSafeRelativePath(target);
  const destination = join(releaseRoot, ...target.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function workspacePackages(
  workspaceRoot: string,
): Promise<ReadonlyMap<string, { readonly directory: string; readonly json: PackageJson }>> {
  const rootPackage = await readJson<PackageJson>(join(workspaceRoot, "package.json"));
  const packages = new Map<string, { directory: string; json: PackageJson }>();
  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern in release build: ${pattern}`);
    }
    const base = join(workspaceRoot, ...pattern.slice(0, -2).split("/"));
    if (!await pathExists(base)) continue;
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(base, entry.name);
      const packagePath = join(directory, "package.json");
      if (!await pathExists(packagePath)) continue;
      const json = await readJson<PackageJson>(packagePath);
      if (!json.name) throw new Error(`Workspace package has no name: ${packagePath}`);
      packages.set(json.name, { directory, json });
    }
  }
  return packages;
}

function packageTarget(name: string): string {
  return `node_modules/${name}`;
}

async function copyPackageDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    filter: (path) => {
      const relativePath = relative(source, path);
      if (!relativePath) return true;
      const first = relativePath.split(sep)[0];
      return first !== "node_modules" && first !== ".git" &&
        !relativePath.endsWith(".map") &&
        !/\.d\.(?:c|m)?ts$/.test(relativePath) &&
        !relativePath.endsWith(".tsbuildinfo");
    },
  });
}

async function findExternalPackage(
  workspaceRoot: string,
  requester: string,
  name: string,
): Promise<string | undefined> {
  const segments = name.split("/");
  const candidates = [
    join(requester, "node_modules", ...segments),
    join(workspaceRoot, "node_modules", ...segments),
  ];
  for (const candidate of candidates) {
    if (await pathExists(join(candidate, "package.json"))) return candidate;
  }
  return undefined;
}

async function copyRuntimePackages(
  workspaceRoot: string,
  releaseRoot: string,
  version: string,
): Promise<void> {
  const packages = await workspacePackages(workspaceRoot);
  if (!packages.has(SERVICE_PACKAGE)) {
    throw new Error(`Release entry package is missing: ${SERVICE_PACKAGE}`);
  }

  const internalQueue = [SERVICE_PACKAGE];
  const externalQueue: { name: string; requester: string }[] = [];
  const copiedInternal = new Set<string>();
  while (internalQueue.length > 0) {
    const name = internalQueue.shift()!;
    if (copiedInternal.has(name)) continue;
    const workspacePackage = packages.get(name);
    if (!workspacePackage) throw new Error(`Internal dependency is missing: ${name}`);
    if (workspacePackage.json.version !== version) {
      throw new Error(
        `Workspace package version mismatch for ${name}: ${workspacePackage.json.version ?? "missing"}`,
      );
    }
    if (!await pathExists(join(workspacePackage.directory, "dist"))) {
      throw new Error(`Workspace package is not built: ${name}`);
    }
    const target = join(releaseRoot, ...packageTarget(name).split("/"));
    await mkdir(dirname(target), { recursive: true });
    await mkdir(target);
    await copyFile(
      join(workspacePackage.directory, "package.json"),
      join(target, "package.json"),
    );
    await copyPackageDirectory(
      join(workspacePackage.directory, "dist"),
      join(target, "dist"),
    );
    copiedInternal.add(name);

    for (const dependency of Object.keys(workspacePackage.json.dependencies ?? {})) {
      if (dependency.startsWith(INTERNAL_PACKAGE_PREFIX)) {
        internalQueue.push(dependency);
      } else {
        externalQueue.push({ name: dependency, requester: workspacePackage.directory });
      }
    }
  }

  const copiedExternal = new Map<string, string>();
  while (externalQueue.length > 0) {
    const dependency = externalQueue.shift()!;
    const source = await findExternalPackage(
      workspaceRoot,
      dependency.requester,
      dependency.name,
    );
    if (!source) {
      throw new Error(`Production dependency is not installed: ${dependency.name}`);
    }
    const json = await readJson<PackageJson>(join(source, "package.json"));
    const identity = `${dependency.name}@${json.version ?? "missing"}`;
    const previous = copiedExternal.get(dependency.name);
    if (previous) {
      if (previous !== identity) {
        throw new Error(`Conflicting production dependency versions for ${dependency.name}`);
      }
      continue;
    }
    const target = join(releaseRoot, ...packageTarget(dependency.name).split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyPackageDirectory(source, target);
    copiedExternal.set(dependency.name, identity);
    for (const child of Object.keys({
      ...json.dependencies,
      ...json.optionalDependencies,
    })) {
      const childSource = await findExternalPackage(workspaceRoot, source, child);
      if (!childSource) {
        if (json.optionalDependencies?.[child] !== undefined) continue;
        throw new Error(`Production dependency is not installed: ${child}`);
      }
      externalQueue.push({ name: child, requester: source });
    }
  }
}

async function copyThemes(
  workspaceRoot: string,
  releaseRoot: string,
): Promise<{
  readonly ids: readonly string[];
  readonly catalogSchemaVersion: number;
}> {
  const themesRoot = join(workspaceRoot, "themes");
  const catalog = await readJson<ThemeCatalog>(join(themesRoot, "catalog.json"));
  if (!Number.isSafeInteger(catalog.schemaVersion) || catalog.schemaVersion < 1) {
    throw new Error("Release theme catalog schema version is invalid");
  }
  const actualIds = catalog.builtins.map((theme) => theme.id);
  if (actualIds.length !== BUILTIN_THEME_IDS.length ||
    BUILTIN_THEME_IDS.some((id) => !actualIds.includes(id))) {
    throw new Error(`Release catalog must contain the four built-in themes`);
  }
  if ((catalog.recipes?.length ?? 0) !== 0) {
    throw new Error("Release catalog must not contain local recipes");
  }
  await copyIntoRelease(
    join(themesRoot, "catalog.json"),
    releaseRoot,
    "themes/catalog.json",
  );

  for (const theme of catalog.builtins) {
    assertSafeRelativePath(theme.path);
    if (!theme.path.startsWith("builtin/")) {
      throw new Error(`Release theme path is not built-in: ${theme.path}`);
    }
    const sourceDirectory = join(themesRoot, ...theme.path.split("/"));
    const manifest = await readJson<ThemeManifest>(join(sourceDirectory, "manifest.json"));
    if (manifest.themeId !== theme.id) {
      throw new Error(`Theme manifest identity mismatch: ${theme.id}`);
    }
    await copyIntoRelease(
      join(sourceDirectory, "manifest.json"),
      releaseRoot,
      `themes/${theme.path}/manifest.json`,
    );
    await copyIntoRelease(
      join(sourceDirectory, "LICENSE.md"),
      releaseRoot,
      `themes/${theme.path}/LICENSE.md`,
    );
    for (const [file, expected] of Object.entries(manifest.files)) {
      assertSafeRelativePath(file);
      if (/source\.png$/i.test(file)) {
        throw new Error(`Authoring-only theme asset is present in a runtime manifest: ${file}`);
      }
      const bytes = await readFile(join(sourceDirectory, ...file.split("/")));
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
        throw new Error(`Theme asset failed manifest verification: ${theme.id}/${file}`);
      }
      await copyIntoRelease(
        join(sourceDirectory, ...file.split("/")),
        releaseRoot,
        `themes/${theme.path}/${file}`,
      );
    }
  }
  return {
    ids: actualIds,
    catalogSchemaVersion: catalog.schemaVersion,
  };
}

async function walkFiles(root: string, current: string = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Release payload must not contain symbolic links: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, path));
    } else if (entry.isFile()) {
      files.push(releaseRelativePath(relative(root, path)));
    }
  }
  return files.sort();
}

async function writeLaunchers(
  releaseRoot: string,
  version: string,
  platform: ReleasePlatform,
): Promise<ReleaseManifest["entry"]> {
  if (platform === "win32") {
    const entry = "OpenChatGPTSkin.cmd" as const;
    await writeFile(join(releaseRoot, entry), [
      "@echo off",
      "setlocal",
      'set "OPEN_CHATGPT_SKIN_INSTALL_ROOT=%~dp0"',
      `set "OPEN_CHATGPT_SKIN_VERSION=${version}"`,
      '"%~dp0runtime\\node.exe" "%~dp0node_modules\\@open-chatgpt-skin\\theme-studio-service\\dist\\cli.js" %*',
      "",
    ].join("\r\n"), "utf8");
    return entry;
  }

  const entry = "OpenChatGPTSkin" as const;
  await writeFile(join(releaseRoot, entry), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'export OPEN_CHATGPT_SKIN_INSTALL_ROOT="$root"',
    `export OPEN_CHATGPT_SKIN_VERSION="${version}"`,
    'exec "$root/runtime/node" "$root/node_modules/@open-chatgpt-skin/theme-studio-service/dist/cli.js" "$@"',
    "",
  ].join("\n"), "utf8");
  await chmod(join(releaseRoot, entry), 0o755);
  return entry;
}

export async function stageReleasePayload(
  options: StageReleasePayloadOptions,
): Promise<ReleaseManifest> {
  assertReleaseVersion(options.version);
  assertBuildCommit(options.buildCommit);
  assertNodeVersion(options.nodeVersion);
  assertReleaseTarget(options.platform, options.arch);
  const workspaceRoot = resolve(options.workspaceRoot);
  const releaseRoot = resolve(options.releaseRoot);
  const outputWithinWorkspace = relative(workspaceRoot, releaseRoot);
  if (outputWithinWorkspace === "" || (
    !isAbsolute(outputWithinWorkspace) &&
    outputWithinWorkspace !== ".." &&
    !outputWithinWorkspace.startsWith(`..${sep}`)
  )) {
    throw new Error("Release output must be outside the source workspace");
  }
  const rootPackage = await readJson<PackageJson>(join(workspaceRoot, "package.json"));
  if (rootPackage.version !== options.version) {
    throw new Error(
      `Root package version does not match release version: ${rootPackage.version ?? "missing"}`,
    );
  }

  await mkdir(dirname(releaseRoot), { recursive: true });
  await mkdir(releaseRoot);
  await Promise.all([
    copyIntoRelease(
      join(workspaceRoot, "apps", "theme-studio", "dist", "index.html"),
      releaseRoot,
      "apps/theme-studio/dist/index.html",
    ),
    copyIntoRelease(join(workspaceRoot, "README.md"), releaseRoot, "README.md"),
    copyIntoRelease(join(workspaceRoot, "README.en.md"), releaseRoot, "README.en.md"),
    copyIntoRelease(join(workspaceRoot, "LICENSE"), releaseRoot, "LICENSE"),
    copyIntoRelease(
      options.nodeExecutablePath,
      releaseRoot,
      options.platform === "win32" ? "runtime/node.exe" : "runtime/node",
    ),
    copyIntoRelease(
      options.nodeLicensePath,
      releaseRoot,
      "runtime/LICENSE",
    ),
  ]);
  if (options.platform === "darwin") {
    await chmod(join(releaseRoot, "runtime", "node"), 0o755);
  }

  await copyRuntimePackages(workspaceRoot, releaseRoot, options.version);
  const themes = await copyThemes(workspaceRoot, releaseRoot);
  const entry = await writeLaunchers(
    releaseRoot,
    options.version,
    options.platform,
  );

  const files: Record<string, { bytes: number; sha256: string }> = {};
  for (const file of await walkFiles(releaseRoot)) {
    if (file === RELEASE_MANIFEST_FILE) continue;
    const bytes = await readFile(join(releaseRoot, ...file.split("/")));
    files[file] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    product: PRODUCT,
    version: options.version,
    target: { platform: options.platform, arch: options.arch },
    runtime: { nodeVersion: options.nodeVersion },
    build: { commit: options.buildCommit.toLowerCase() },
    themeCatalog: { schemaVersion: themes.catalogSchemaVersion },
    entry,
    themes: themes.ids,
    files,
  };
  await writeFile(
    join(releaseRoot, RELEASE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

export async function readReleaseManifest(
  releaseRoot: string,
): Promise<ReleaseManifest> {
  const manifest = await readJson<unknown>(
    join(releaseRoot, RELEASE_MANIFEST_FILE),
  );
  if (!isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.product !== PRODUCT) {
    throw new Error("Release manifest identity is invalid");
  }
  assertReleaseVersion(manifest.version);
  if (!isRecord(manifest.target)) {
    throw new Error("Release manifest target is missing");
  }
  assertReleaseTarget(manifest.target.platform, manifest.target.arch);
  if (!isRecord(manifest.runtime)) {
    throw new Error("Release manifest Runtime metadata is missing");
  }
  assertNodeVersion(manifest.runtime.nodeVersion);
  if (!isRecord(manifest.build)) {
    throw new Error("Release manifest build metadata is missing");
  }
  assertBuildCommit(manifest.build.commit);
  const expectedEntry = manifest.target.platform === "win32"
    ? "OpenChatGPTSkin.cmd"
    : "OpenChatGPTSkin";
  if (manifest.entry !== expectedEntry) {
    throw new Error("Release manifest entry does not match its target");
  }
  if (!isRecord(manifest.themeCatalog) ||
    !Number.isSafeInteger(manifest.themeCatalog.schemaVersion) ||
    (manifest.themeCatalog.schemaVersion as number) < 1) {
    throw new Error("Release manifest theme catalog is invalid");
  }
  if (!Array.isArray(manifest.themes) ||
    manifest.themes.length === 0 ||
    manifest.themes.some((theme) =>
      typeof theme !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(theme)
    ) ||
    new Set(manifest.themes).size !== manifest.themes.length ||
    !isRecord(manifest.files) ||
    Object.keys(manifest.files).length === 0) {
    throw new Error("Release manifest contents are invalid");
  }
  for (const [path, metadata] of Object.entries(manifest.files)) {
    assertSafeRelativePath(path);
    if (!isRecord(metadata) ||
      !Number.isSafeInteger(metadata.bytes) ||
      (metadata.bytes as number) < 0 ||
      typeof metadata.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(metadata.sha256)) {
      throw new Error(`Release manifest file metadata is invalid: ${path}`);
    }
  }
  return manifest as unknown as ReleaseManifest;
}
