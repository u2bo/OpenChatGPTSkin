import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PRODUCT_VERSION_PATTERN } from
  "../../packages/theme-studio-core/src/security.js";
import { releaseOption } from "./options.js";

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly workspaces?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
}

async function readPackage(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, "utf8")) as PackageJson;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tag = releaseOption(args, "--tag");
  const root = resolve(".");
  const rootPackage = await readPackage(join(root, "package.json"));
  const version = rootPackage.version;
  if (!version || !PRODUCT_VERSION_PATTERN.test(version)) {
    throw new Error(`Root package version is invalid: ${version ?? "missing"}`);
  }
  if (tag && tag !== `v${version}`) {
    throw new Error(`Git Tag ${tag} does not match package version v${version}`);
  }

  const packages: PackageJson[] = [];
  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith("/*")) throw new Error(`Unsupported workspace pattern: ${pattern}`);
    const base = join(root, ...pattern.slice(0, -2).split("/"));
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      packages.push(await readPackage(join(base, entry.name, "package.json")));
    }
  }
  for (const packageJson of packages) {
    if (packageJson.version !== version) {
      throw new Error(`Workspace version mismatch: ${packageJson.name ?? "unnamed"}`);
    }
    for (const [name, range] of Object.entries(packageJson.dependencies ?? {})) {
      if (name.startsWith("@open-chatgpt-skin/") && range !== version) {
        throw new Error(`Internal dependency version mismatch: ${packageJson.name} -> ${name}`);
      }
    }
  }
  process.stdout.write(`${JSON.stringify({
    version,
    tag: tag ?? null,
    prerelease: version.includes("-"),
    workspacePackages: packages.length,
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "RELEASE_VERSION_INVALID",
      message: error instanceof Error ? error.message : "Release version validation failed",
    },
  })}\n`);
  process.exitCode = 1;
});
