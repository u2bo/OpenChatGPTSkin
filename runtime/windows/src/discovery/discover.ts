import { RuntimeError } from "../errors.js";
import type {
  DiscoveryResult,
  InstallInspection,
  ProcessIdentity,
  VerifiedCodexInstall,
  DesktopRuntimeProvider,
} from "../types.js";
import {
  MACOS_CODEX_BUNDLE_ID,
  MACOS_CODEX_ENTRY_POINT,
  MACOS_CODEX_IDENTITY_NAME,
  MACOS_CODEX_NOTARIZATION_AUTHORITY,
  MACOS_CODEX_RESOURCE_SIGNER,
  MACOS_CODEX_TEAM_ID,
} from "../macos/identity.js";
import type { TrustedCodexInstall } from "./trusted-cache.js";
import { TrustedInstallStore } from "./trusted-cache.js";

const EXPECTED_IDENTITY = "OpenAI.Codex";
const EXPECTED_ENTRY = "app/ChatGPT.exe";
const EXPECTED_ENTRY_POINT = "Windows.FullTrustApplication";
const APPROVED_PUBLISHERS = new Set([
  "CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B",
]);
const EXPECTED_PACKAGE_SIGNER = "50BDFD77-8903-4850-9FFE-6E8522F64D5B";
const APPROVED_RESOURCE_SIGNERS = new Set(["OpenAI OpCo, LLC"]);
const ENTRY_SUFFIX = `/${EXPECTED_ENTRY}`;

interface Candidate {
  readonly source: DiscoveryResult["source"];
  readonly install: VerifiedCodexInstall;
  readonly runningRoot: ProcessIdentity | null;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function packageRootFromEntryPath(
  entryPath: string,
  platform: DesktopRuntimeProvider["platform"],
): string {
  const normalized = normalizePath(entryPath);
  if (platform === "darwin") {
    const match = /^(.*\/Codex\.app)\/Contents\/MacOS\/[^/]+$/.exec(normalized);
    if (!match) {
      throw new RuntimeError(
        "CODEX_IDENTITY_INVALID",
        "running Codex path is outside Codex.app/Contents/MacOS",
      );
    }
    return match[1]!;
  }
  if (!normalized.toLowerCase().endsWith(ENTRY_SUFFIX.toLowerCase())) {
    throw new RuntimeError(
      "CODEX_IDENTITY_INVALID",
      `running ChatGPT path does not end with ${ENTRY_SUFFIX}`,
    );
  }
  return normalized.slice(0, -ENTRY_SUFFIX.length);
}

function verifyWindowsInspection(value: InstallInspection): VerifiedCodexInstall {
  const packageRoot = normalizePath(value.packageRoot);
  const entryPath = normalizePath(value.entryPath);
  const entryRelativePath = normalizePath(value.entryRelativePath).replace(/^\//, "");
  const expectedEntryPath = `${packageRoot}/${EXPECTED_ENTRY}`;
  const valid = value.identityName === EXPECTED_IDENTITY &&
    /^\d+\.\d+\.\d+\.\d+$/.test(value.packageVersion) &&
    APPROVED_PUBLISHERS.has(value.packagePublisher) &&
    value.appId === "App" &&
    entryRelativePath === EXPECTED_ENTRY &&
    value.entryPoint === EXPECTED_ENTRY_POINT &&
    value.packageSignatureStatus === "Valid" &&
    value.packageSignerCommonName === EXPECTED_PACKAGE_SIGNER &&
    value.catalogSignatureStatus === "Valid" &&
    value.catalogSignerCommonName === EXPECTED_PACKAGE_SIGNER &&
    value.entryBlockMapValid &&
    value.resourceSignatureStatus === "Valid" &&
    APPROVED_RESOURCE_SIGNERS.has(value.resourceSignerCommonName) &&
    entryPath.toLowerCase() === expectedEntryPath.toLowerCase();
  if (!valid) {
    throw new RuntimeError(
      "CODEX_IDENTITY_INVALID",
      "Codex Manifest, package signature, block map, or resource signer is invalid",
    );
  }
  return {
    ...value,
    packageRoot,
    entryPath,
    entryRelativePath: EXPECTED_ENTRY,
  };
}

function verifyMacOsInspection(value: InstallInspection): VerifiedCodexInstall {
  const packageRoot = normalizePath(value.packageRoot);
  const entryPath = normalizePath(value.entryPath);
  const entryRelativePath = normalizePath(value.entryRelativePath).replace(/^\//, "");
  const validEntry = /^Contents\/MacOS\/[^/]+$/.test(entryRelativePath);
  const expectedEntryPath = `${packageRoot}/${entryRelativePath}`;
  const valid = value.identityName === MACOS_CODEX_IDENTITY_NAME &&
    /^\d+\.\d+\.\d+\.\d+$/.test(value.packageVersion) &&
    value.packagePublisher === MACOS_CODEX_TEAM_ID &&
    value.appId === MACOS_CODEX_BUNDLE_ID &&
    validEntry &&
    value.entryPoint === MACOS_CODEX_ENTRY_POINT &&
    value.packageSignatureStatus === "Valid" &&
    value.packageSignerCommonName === MACOS_CODEX_TEAM_ID &&
    value.catalogSignatureStatus === "Valid" &&
    value.catalogSignerCommonName === MACOS_CODEX_NOTARIZATION_AUTHORITY &&
    value.entryBlockMapValid &&
    value.resourceSignatureStatus === "Valid" &&
    value.resourceSignerCommonName === MACOS_CODEX_RESOURCE_SIGNER &&
    packageRoot.endsWith("/Codex.app") &&
    entryPath === expectedEntryPath;
  if (!valid) {
    throw new RuntimeError(
      "CODEX_IDENTITY_INVALID",
      "Codex bundle identifier, code signature, notarization, or entry point is invalid",
    );
  }
  return { ...value, packageRoot, entryPath, entryRelativePath };
}

function verifyInspection(
  value: InstallInspection,
  platform: DesktopRuntimeProvider["platform"],
): VerifiedCodexInstall {
  return platform === "darwin"
    ? verifyMacOsInspection(value)
    : verifyWindowsInspection(value);
}

function installKey(
  value: VerifiedCodexInstall,
  platform: DesktopRuntimeProvider["platform"],
): string {
  const pathKey = (path: string) => platform === "darwin" ? path : path.toLowerCase();
  return [
    pathKey(value.packageRoot),
    pathKey(value.entryPath),
    value.identityName,
    value.packageVersion,
    value.packagePublisher,
    value.packageSignerCommonName,
    value.catalogSignerCommonName,
    String(value.entryBlockMapValid),
    value.resourceSignerCommonName,
  ].join("|");
}

async function inspect(
  provider: DesktopRuntimeProvider,
  source: DiscoveryResult["source"],
  packageRoot: string,
  runningRoot: ProcessIdentity | null,
): Promise<Candidate> {
  return {
    source,
    install: verifyInspection(await provider.inspectInstall(packageRoot), provider.platform),
    runningRoot,
  };
}

function cachedRoot(value: TrustedCodexInstall): string {
  return value.packageRoot;
}

export async function discoverCodexInstall(
  provider: DesktopRuntimeProvider,
  cache: TrustedInstallStore,
): Promise<DiscoveryResult> {
  const candidates: Candidate[] = [];
  const running = await provider.listCodexRoots();
  if (running.length > 1) {
    throw new RuntimeError(
      "CODEX_IDENTITY_INVALID",
      "multiple unmanaged Codex root processes were found",
    );
  }
  const runningRoot = running[0];
  if (runningRoot) {
    candidates.push(await inspect(
      provider,
      "running",
      packageRootFromEntryPath(runningRoot.executablePath, provider.platform),
      runningRoot,
    ));
  }

  const registeredRoots = [...new Set(await provider.currentUserPackageRoots())];
  const registeredSource = provider.platform === "darwin" ? "application" : "appx";
  for (const packageRoot of registeredRoots) {
    candidates.push(await inspect(provider, registeredSource, packageRoot, null));
  }

  if (candidates.length === 0) {
    const cached = await cache.read();
    if (cached) {
      candidates.push(await inspect(provider, "cache", cachedRoot(cached), null));
    }
  }

  if (candidates.length === 0) {
    throw new RuntimeError(
      "CODEX_DISCOVERY_REQUIRES_BOOTSTRAP",
      "No readable official Codex registration or trusted install cache exists",
      "Open official Codex once, then retry OpenChatGPTSkin Launcher.",
    );
  }

  const identities = new Set(candidates.map((candidate) =>
    installKey(candidate.install, provider.platform)
  ));
  if (identities.size !== 1) {
    throw new RuntimeError(
      "CODEX_IDENTITY_INVALID",
      "Codex discovery sources disagree about the official installation",
    );
  }

  const chosen = candidates.find((candidate) => candidate.source === "running") ??
    candidates.find((candidate) => candidate.source === registeredSource) ??
    candidates[0];
  if (!chosen) {
    throw new RuntimeError("CODEX_IDENTITY_INVALID", "verified candidate disappeared");
  }
  await cache.write(chosen.install);
  return {
    install: chosen.install,
    source: chosen.source,
    runningRoot: chosen.runningRoot,
  };
}
