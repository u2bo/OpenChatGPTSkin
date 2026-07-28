import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { zipSync } from "fflate";
import { generateMacIcon } from "./macos-icon.js";
import { readReleaseManifest, ReleaseManifestSchema } from "./manifest.js";

const execFileAsync = promisify(execFile);
const PRODUCT = "OpenChatGPTSkin";
const IMAGE_IMPLEMENTATION = "gen2brain-webp-wasm2go-nodynamic-plus-internal-pipeline";

interface Target {
  readonly target: "windows-x64" | "macos-arm64" | "macos-x64";
  readonly goos: "windows" | "darwin";
  readonly goarch: "amd64" | "arm64";
  readonly executable: "OpenChatGPTSkin.exe" | "OpenChatGPTSkin";
  readonly executableFormat: "pe-x64" | "mach-o-arm64" | "mach-o-x64";
  readonly baselineStageBytes: number;
  readonly archiveKind: "zip-x64" | "tar.gz-arm64" | "tar.gz-x64";
  readonly archiveBaselineBytes: number;
}

const TARGETS: readonly Target[] = [
  {
    target: "windows-x64",
    goos: "windows",
    goarch: "amd64",
    executable: "OpenChatGPTSkin.exe",
    executableFormat: "pe-x64",
    baselineStageBytes: 115070815,
    archiveKind: "zip-x64",
    archiveBaselineBytes: 44744668,
  },
  {
    target: "macos-arm64",
    goos: "darwin",
    goarch: "arm64",
    executable: "OpenChatGPTSkin",
    executableFormat: "mach-o-arm64",
    baselineStageBytes: 136974297,
    archiveKind: "tar.gz-arm64",
    archiveBaselineBytes: 48772737,
  },
  {
    target: "macos-x64",
    goos: "darwin",
    goarch: "amd64",
    executable: "OpenChatGPTSkin",
    executableFormat: "mach-o-x64",
    baselineStageBytes: 141958550,
    archiveKind: "tar.gz-x64",
    archiveBaselineBytes: 51253278,
  },
] as const;

export interface GoReleaseTargetReport {
  readonly target: Target["target"];
  readonly executableFormat: Target["executableFormat"];
  readonly executableBytes: number;
  readonly stageBytes: number;
  readonly baselineStageBytes: number;
}

export interface GoReleaseArtifactReport {
  readonly name: string;
  readonly kind:
    | Target["archiveKind"]
    | "setup-x64"
    | "dmg-arm64"
    | "dmg-x64";
  readonly bytes: number;
  readonly sha256: string;
  readonly baselineBytes: number;
}

export interface GoReleaseReport {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly imageImplementation: typeof IMAGE_IMPLEMENTATION;
  readonly cgo: false;
  readonly sidecars: readonly [];
  readonly targets: readonly GoReleaseTargetReport[];
  readonly artifacts: readonly GoReleaseArtifactReport[];
}

export interface BuildGoReleaseOptions {
  readonly workspaceRoot: string;
  readonly outputDirectory: string;
  readonly nativeInstallers: boolean;
  readonly nativeArtifactsOnly?: boolean;
  readonly onProgress?: (message: string) => void;
}

interface GoReleaseBuildMetadata {
  readonly goVersion: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly contractsSha256: string;
  readonly cdpAdapterSha256: string;
}

function portable(path: string): string {
  return path.split(sep).join("/");
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

async function walkFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, path));
    else if (entry.isFile()) files.push(portable(relative(root, path)));
    else throw new Error(`Go release payload contains a non-file entry: ${path}`);
  }
  return files.sort();
}

async function directoryBytes(root: string): Promise<number> {
  let bytes = 0;
  for (const path of await walkFiles(root)) {
    bytes += (await stat(join(root, ...path.split("/")))).size;
  }
  return bytes;
}

interface ThemeCatalog {
  readonly builtins: readonly { readonly id: string; readonly path: string }[];
}

interface ThemeManifest {
  readonly themeId: string;
  readonly files: Readonly<Record<string, { readonly bytes: number; readonly sha256: string }>>;
}

async function copyRuntimeThemes(workspaceRoot: string, destination: string): Promise<void> {
  const sourceRoot = join(workspaceRoot, "themes");
  const catalogBytes = await readFile(join(sourceRoot, "catalog.json"));
  const catalog = JSON.parse(catalogBytes.toString("utf8")) as ThemeCatalog;
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "catalog.json"), catalogBytes);
  for (const entry of catalog.builtins) {
    const source = join(sourceRoot, ...entry.path.split("/"));
    const target = join(destination, ...entry.path.split("/"));
    const manifestBytes = await readFile(join(source, "manifest.json"));
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as ThemeManifest;
    if (manifest.themeId !== entry.id) throw new Error(`Theme manifest identity mismatch: ${entry.id}`);
    await mkdir(target, { recursive: true });
    await Promise.all([
      writeFile(join(target, "manifest.json"), manifestBytes),
      cp(join(source, "LICENSE.md"), join(target, "LICENSE.md")),
      ...Object.keys(manifest.files).map(async (path) => {
        const sourceFile = join(source, ...path.split("/"));
        const targetFile = join(target, ...path.split("/"));
        await mkdir(dirname(targetFile), { recursive: true });
        await cp(sourceFile, targetFile);
      }),
    ]);
  }
}

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function directorySha256(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await walkFiles(root)) {
    hash.update(path, "utf8");
    hash.update("\0", "utf8");
    hash.update(await readFile(join(root, ...path.split("/"))));
  }
  return hash.digest("hex");
}

async function buildMetadata(workspaceRoot: string): Promise<GoReleaseBuildMetadata> {
  const [{ stdout: goVersion }, { stdout: commit }, { stdout: status }, cdpManifest] = await Promise.all([
    execFileAsync("go", ["env", "GOVERSION"], { cwd: join(workspaceRoot, "host", "go"), windowsHide: true }),
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, windowsHide: true }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: workspaceRoot, windowsHide: true }),
    readFile(join(workspaceRoot, "host", "go", "internal", "cdp", "generated", "adapter-manifest.json"), "utf8"),
  ]);
  const parsed = JSON.parse(cdpManifest) as { readonly sha256?: unknown };
  if (typeof parsed.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(parsed.sha256)) {
    throw new Error("Embedded CDP Adapter manifest hash is invalid");
  }
  return {
    goVersion: goVersion.trim(),
    commit: commit.trim(),
    dirty: status.trim().length > 0,
    contractsSha256: await directorySha256(join(workspaceRoot, "contracts")),
    cdpAdapterSha256: parsed.sha256,
  };
}

async function artifact(path: string, kind: GoReleaseArtifactReport["kind"], baselineBytes: number): Promise<GoReleaseArtifactReport> {
  const contents = await readFile(path);
  return { name: path.split(sep).at(-1)!, kind, bytes: contents.length, sha256: sha256(contents), baselineBytes };
}

function inspectExecutable(contents: Uint8Array): Target["executableFormat"] {
  const bytes = Buffer.from(contents);
  if (bytes.length >= 2 && bytes.toString("ascii", 0, 2) === "MZ") return "pe-x64";
  if (bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = bytes.readUInt32LE(4);
    if (cpu === 0x0100000c) return "mach-o-arm64";
    if (cpu === 0x01000007) return "mach-o-x64";
  }
  throw new Error("Go release executable format is invalid");
}

async function readReleaseVersion(workspaceRoot: string): Promise<string> {
  const value = JSON.parse(await readFile(join(workspaceRoot, "package.json"), "utf8")) as {
    readonly version?: unknown;
  };
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) {
    throw new Error("Release package version is invalid");
  }
  return value.version;
}

async function zipStage(stageParent: string, output: string): Promise<void> {
  const root = join(stageParent, PRODUCT);
  const entries: Record<string, Uint8Array> = {};
  for (const path of await walkFiles(root)) {
    entries[`${PRODUCT}/${path}`] = await readFile(join(root, ...path.split("/")));
  }
  await writeFile(output, zipSync(entries, { level: 9 }));
}

async function stageTarget(
  workspaceRoot: string,
  outputDirectory: string,
  target: Target,
  metadata: GoReleaseBuildMetadata,
  version: string,
): Promise<GoReleaseTargetReport> {
  const stageParent = join(outputDirectory, "stages", target.target);
  const stageRoot = join(stageParent, PRODUCT);
  await rm(stageParent, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  const executablePath = join(stageRoot, target.executable);
  await execFileAsync("go", [
    "build",
    "-buildvcs=false",
    "-trimpath",
    "-tags", "nodynamic",
    "-ldflags", `-s -w -X github.com/u2bo/OpenChatGPTSkin/host/go/internal/app.goHostVersion=${version}`,
    "-o", executablePath,
    "./cmd/openchatgptskin",
  ], {
    cwd: join(workspaceRoot, "host", "go"),
    env: {
      ...process.env,
      CGO_ENABLED: "0",
      GOOS: target.goos,
      GOARCH: target.goarch,
    },
    windowsHide: true,
  });
  if (target.goos === "darwin") await chmod(executablePath, 0o755);
  await Promise.all([
    cp(join(workspaceRoot, "apps", "theme-studio", "dist"), join(stageRoot, "apps", "theme-studio", "dist"), { recursive: true }),
    copyRuntimeThemes(workspaceRoot, join(stageRoot, "themes")),
    cp(join(workspaceRoot, "LICENSE"), join(stageRoot, "LICENSE")),
    cp(join(workspaceRoot, "README.md"), join(stageRoot, "README.md")),
    cp(join(workspaceRoot, "README.en.md"), join(stageRoot, "README.en.md")),
  ]);
  const executableContents = await readFile(executablePath);
  const executableFormat = inspectExecutable(executableContents);
  if (executableFormat !== target.executableFormat) {
    throw new Error(`Go release target format mismatch: ${target.target}`);
  }
  const catalog = JSON.parse(await readFile(join(stageRoot, "themes", "catalog.json"), "utf8")) as ThemeCatalog & {
    readonly schemaVersion?: unknown;
  };
  const files = await Promise.all((await walkFiles(stageRoot)).map(async (path) => {
    const contents = await readFile(join(stageRoot, ...path.split("/")));
    return { path, bytes: contents.length, sha256: sha256(contents) };
  }));
  const manifest = ReleaseManifestSchema.parse({
    schemaVersion: 2,
    product: PRODUCT,
    version,
    target: target.target,
    roles: ["studio", "controller", "runtime"],
    host: {
      language: "go",
      goVersion: metadata.goVersion,
      commit: metadata.commit,
      dirty: metadata.dirty,
      entry: {
        path: target.executable,
        bytes: executableContents.length,
        sha256: sha256(executableContents),
      },
    },
    contracts: {
      studio: 2,
      runtime: 1,
      theme: 4,
      data: 1,
      sha256: metadata.contractsSha256,
    },
    cdpAdapter: { sha256: metadata.cdpAdapterSha256 },
    themes: {
      catalogSchemaVersion: catalog.schemaVersion,
      builtins: catalog.builtins.map(({ id }) => id),
    },
    image: { implementation: IMAGE_IMPLEMENTATION, cgo: false },
    sidecars: [],
    files,
  });
  await writeFile(join(stageRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await assertNodeFreeStage(stageRoot);
  return {
    target: target.target,
    executableFormat,
    executableBytes: executableContents.length,
    stageBytes: await directoryBytes(stageRoot),
    baselineStageBytes: target.baselineStageBytes,
  };
}

async function assertNodeFreeStage(stageRoot: string): Promise<void> {
  for (const path of await walkFiles(stageRoot)) {
    const parts = path.toLowerCase().split("/");
    const name = parts.at(-1);
    if (parts.includes("node_modules") || name === "node" || name === "node.exe") {
      throw new Error(`Go release stage contains a Node Runtime entry: ${path}`);
    }
  }
}

async function buildPortableArtifacts(
  workspaceRoot: string,
  outputDirectory: string,
  targets: readonly Target[],
  version: string,
): Promise<GoReleaseArtifactReport[]> {
  const artifacts: GoReleaseArtifactReport[] = [];
  for (const target of targets) {
    const stageParent = join(outputDirectory, "stages", target.target);
    if (target.goos === "windows") {
      const path = join(outputDirectory, `${PRODUCT}_${version}_windows_x64.zip`);
      await zipStage(stageParent, path);
      artifacts.push(await artifact(path, target.archiveKind, target.archiveBaselineBytes));
    } else {
      artifacts.push(await buildMacTar(workspaceRoot, outputDirectory, target, version));
    }
  }
  return artifacts;
}

function currentNativeTarget(): Target {
  const target = TARGETS.find(({ goos, goarch }) =>
    goos === (process.platform === "win32" ? "windows" : process.platform) &&
    goarch === (process.arch === "x64" ? "amd64" : process.arch)
  );
  if (!target) {
    throw new Error(`Go release packaging does not support ${process.platform}/${process.arch}`);
  }
  return target;
}

async function findInnoSetup(): Promise<string | null> {
  const candidates = [
    process.env.INNO_SETUP_COMPILER,
    "C:/Program Files (x86)/Inno Setup 6/ISCC.exe",
    "C:/Program Files/Inno Setup 6/ISCC.exe",
  ];
  if (process.platform === "win32") {
    for (const key of [
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
      "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
      "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
    ]) {
      try {
        const { stdout } = await execFileAsync("reg.exe", ["query", key, "/v", "InstallLocation"], { windowsHide: true });
        const match = /^\s*InstallLocation\s+REG_\w+\s+(.+)$/im.exec(stdout);
        if (match?.[1]) candidates.push(join(match[1].trim(), "ISCC.exe"));
      } catch (error) {
        const code = (error as { readonly code?: string | number }).code;
        if (code !== 1 && code !== "1") throw error;
      }
    }
  }
  for (const path of candidates) {
    if (path && await pathExists(path)) return path;
  }
  return null;
}

async function buildWindowsSetup(outputDirectory: string, version: string): Promise<GoReleaseArtifactReport> {
  const compiler = await findInnoSetup();
  if (!compiler) throw new Error("Native Windows release packaging requires Inno Setup 6");
  const stageRoot = join(outputDirectory, "stages", "windows-x64", PRODUCT);
  const buildRoot = await mkdtemp(join(tmpdir(), "openchatgptskin-go-inno-"));
  try {
    const script = join(buildRoot, "go-release.iss");
    const outputBase = `${PRODUCT}_${version}_windows_x64_Setup`;
    const quote = (value: string) => value.replaceAll('"', '""');
    await writeFile(script, [
      "[Setup]",
      `AppId=${PRODUCT}`,
      `AppName=${PRODUCT}`,
      `AppVersion=${version}`,
      "AppPublisher=OpenChatGPTSkin Contributors",
      "AppPublisherURL=https://github.com/u2bo/OpenChatGPTSkin",
      `DefaultDirName={localappdata}\\Programs\\${PRODUCT}`,
      `DefaultGroupName=${PRODUCT}`,
      "PrivilegesRequired=lowest",
      "ArchitecturesAllowed=x64compatible",
      "ArchitecturesInstallIn64BitMode=x64compatible",
      "Compression=lzma2/ultra64",
      "SolidCompression=yes",
      `OutputDir=${quote(outputDirectory)}`,
      `OutputBaseFilename=${outputBase}`,
      "Uninstallable=yes",
      "[Files]",
      `Source: "${quote(join(stageRoot, "*"))}"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs`,
      "[Icons]",
      `Name: "{autoprograms}\\${PRODUCT}"; Filename: "{app}\\OpenChatGPTSkin.exe"`,
      "[Run]",
      `Filename: "{app}\\OpenChatGPTSkin.exe"; Description: "启动 ${PRODUCT}"; Flags: nowait postinstall skipifsilent`,
      "",
    ].join("\r\n"), "utf8");
    await execFileAsync(compiler, [script], { windowsHide: true });
    return artifact(join(outputDirectory, `${outputBase}.exe`), "setup-x64", 34083496);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

async function buildMacDmg(
  workspaceRoot: string,
  outputDirectory: string,
  target: Target,
  version: string,
): Promise<GoReleaseArtifactReport> {
  const arch = target.goarch === "arm64" ? "arm64" : "x64";
  const stageRoot = join(outputDirectory, "stages", target.target, PRODUCT);
  const buildRoot = await mkdtemp(join(tmpdir(), `openchatgptskin-go-dmg-${arch}-`));
  try {
    const app = join(buildRoot, `${PRODUCT}.app`);
    await stageMacApp(workspaceRoot, stageRoot, app, target, version);
    const output = join(outputDirectory, `${PRODUCT}_${version}_macos_${arch}.dmg`);
    await execFileAsync("hdiutil", [
      "create", "-volname", PRODUCT, "-srcfolder", app,
      "-format", "UDZO", "-ov", output,
    ]);
    await execFileAsync("hdiutil", ["verify", output]);
    return artifact(output, arch === "arm64" ? "dmg-arm64" : "dmg-x64", arch === "arm64" ? 59251126 : 62221496);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

async function stageMacApp(
  workspaceRoot: string,
  stageRoot: string,
  app: string,
  target: Target,
  version: string,
): Promise<void> {
  const arch = target.goarch === "arm64" ? "arm64" : "x64";
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  const payload = join(resources, "payload");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await mkdir(payload, { recursive: true });
  for (const path of await walkFiles(stageRoot)) {
    const destination = join(payload, ...path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(stageRoot, ...path.split("/")), destination);
  }
  const payloadExecutable = join(payload, "OpenChatGPTSkin");
  const bundleExecutable = join(contents, "MacOS", "OpenChatGPTSkin");
  await chmod(payloadExecutable, 0o755);
  await link(payloadExecutable, bundleExecutable);
  await chmod(bundleExecutable, 0o755);
  await generateMacIcon(
    join(workspaceRoot, "assets", "branding", "open-chatgpt-skin-icon.svg"),
    join(resources, "AppIcon.icns"),
  );
  await writeFile(join(contents, "Info.plist"), [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\"><dict>",
    "<key>CFBundleExecutable</key><string>OpenChatGPTSkin</string>",
    "<key>CFBundleIdentifier</key><string>io.github.u2bo.openchatgptskin</string>",
    `<key>CFBundleShortVersionString</key><string>${version}</string>`,
    `<key>CFBundleVersion</key><string>${version.replace(/-.+$/, "")}.1</string>`,
    "<key>CFBundlePackageType</key><string>APPL</string>",
    "<key>CFBundleIconFile</key><string>AppIcon</string>",
    "<key>LSUIElement</key><true/>",
    "<key>LSMultipleInstancesProhibited</key><true/>",
    "</dict></plist>",
    "",
  ].join("\n"), "utf8");
  await execFileAsync("plutil", ["-lint", join(contents, "Info.plist")]);
  const health = await execFileAsync(join(contents, "MacOS", "OpenChatGPTSkin"), ["studio", "--health-once"]);
  const healthResult = JSON.parse(health.stdout) as { readonly role?: unknown };
  if (healthResult.role !== "studio") {
    throw new Error(`macOS ${arch} App Bundle host health failed`);
  }
}

async function buildMacTar(
  workspaceRoot: string,
  outputDirectory: string,
  target: Target,
  version: string,
): Promise<GoReleaseArtifactReport> {
  const arch = target.goarch === "arm64" ? "arm64" : "x64";
  const stageRoot = join(outputDirectory, "stages", target.target, PRODUCT);
  const buildRoot = await mkdtemp(join(tmpdir(), `openchatgptskin-go-tar-${arch}-`));
  try {
    const app = join(buildRoot, `${PRODUCT}.app`);
    await stageMacApp(workspaceRoot, stageRoot, app, target, version);
    const output = join(outputDirectory, `${PRODUCT}_${version}_macos_${arch}.tar.gz`);
    await execFileAsync("tar", ["-czf", output, "-C", buildRoot, `${PRODUCT}.app`]);
    return artifact(output, target.archiveKind, target.archiveBaselineBytes);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

async function acceptWindowsSetup(setupPath: string): Promise<void> {
  const installRoot = await mkdtemp(join(tmpdir(), "openchatgptskin-go-installed-"));
  await rm(installRoot, { recursive: true, force: true });
  try {
    await execFileAsync(setupPath, [
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
      "/SP-",
      `/DIR=${installRoot}`,
    ], { windowsHide: true });
    const health = await execFileAsync(join(installRoot, "OpenChatGPTSkin.exe"), ["studio", "--health-once"], { windowsHide: true });
    const value = JSON.parse(health.stdout) as { readonly role?: unknown };
    if (value.role !== "studio") throw new Error("Installed Go release host health failed");
    await execFileAsync(join(installRoot, "unins000.exe"), [
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
    ], { windowsHide: true });
  } finally {
    if (await pathExists(installRoot)) await rm(installRoot, { recursive: true, force: true });
  }
}

export async function buildGoReleasePackages(options: BuildGoReleaseOptions): Promise<GoReleaseReport> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error("npm_execpath is required to build the Go release UI");
  const version = await readReleaseVersion(workspaceRoot);
  options.onProgress?.("Building Theme Studio UI");
  await execFileAsync(process.execPath, [npmExecPath, "run", "studio:build"], {
    cwd: workspaceRoot,
    windowsHide: true,
  });
  const metadata = await buildMetadata(workspaceRoot);
  const selectedTargets = options.nativeArtifactsOnly ? [currentNativeTarget()] : TARGETS;
  const targets: GoReleaseTargetReport[] = [];
  for (const target of selectedTargets) {
    options.onProgress?.(`Building and staging ${target.target}`);
    targets.push(await stageTarget(workspaceRoot, outputDirectory, target, metadata, version));
  }
  const nativeTarget = options.nativeInstallers || options.nativeArtifactsOnly
    ? currentNativeTarget()
    : undefined;
  options.onProgress?.("Building portable artifacts");
  const artifacts = await buildPortableArtifacts(workspaceRoot, outputDirectory, selectedTargets, version);
  if (options.nativeInstallers) {
    if (process.platform === "win32") {
      options.onProgress?.("Building Windows Setup");
      artifacts.push(await buildWindowsSetup(outputDirectory, version));
    }
    if (process.platform === "darwin") {
      options.onProgress?.(`Building macOS ${nativeTarget!.goarch === "arm64" ? "ARM64" : "x64"} DMG`);
      artifacts.push(await buildMacDmg(
        workspaceRoot,
        outputDirectory,
        nativeTarget!,
        version,
      ));
    }
  }
  const report: GoReleaseReport = {
    schemaVersion: 1,
    version,
    imageImplementation: IMAGE_IMPLEMENTATION,
    cgo: false,
    sidecars: [],
    targets,
    artifacts,
  };
  await writeFile(join(outputDirectory, "go-release-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  options.onProgress?.("Go release build complete");
  return report;
}

export async function acceptGoReleasePackages(
  outputDirectoryInput: string,
  requireAllNative: boolean,
): Promise<{
  readonly accepted: true;
  readonly artifactCount: number;
  readonly nativeEvidenceComplete: boolean;
}> {
  const outputDirectory = resolve(outputDirectoryInput);
  const report = JSON.parse(await readFile(join(outputDirectory, "go-release-report.json"), "utf8")) as GoReleaseReport;
  if (report.schemaVersion !== 1 || report.targets.length < 1 || report.targets.length > TARGETS.length ||
    new Set(report.targets.map(({ target }) => target)).size !== report.targets.length) {
    throw new Error("Go release report identity is invalid");
  }
  for (const target of report.targets) {
    if (target.stageBytes >= target.baselineStageBytes) {
      throw new Error(`Go release stage exceeds its baseline: ${target.target}`);
    }
    const definition = TARGETS.find((value) => value.target === target.target);
    if (!definition) throw new Error(`Unknown Go release target: ${target.target}`);
    const stageRoot = join(outputDirectory, "stages", target.target, PRODUCT);
    await assertNodeFreeStage(stageRoot);
    const executable = await readFile(join(stageRoot, definition.executable));
    if (inspectExecutable(executable) !== target.executableFormat) {
      throw new Error(`Go release executable format changed: ${target.target}`);
    }
    const manifest = await readReleaseManifest(stageRoot);
    if (manifest.version !== report.version || manifest.target !== target.target ||
      manifest.host.entry.path !== definition.executable || manifest.host.entry.bytes !== executable.length ||
      manifest.host.entry.sha256 !== sha256(executable) ||
      manifest.sidecars.length !== 0) {
      throw new Error(`Go release manifest is invalid: ${target.target}`);
    }
    const declaredFiles = new Map(manifest.files.map((file) => [file.path, file]));
    for (const path of await walkFiles(stageRoot)) {
      if (path === "release-manifest.json") continue;
      const contents = await readFile(join(stageRoot, ...path.split("/")));
      const declared = declaredFiles.get(path);
      if (declared?.bytes !== contents.length || declared.sha256 !== sha256(contents)) {
        throw new Error(`Go release file metadata is invalid: ${target.target}/${path}`);
      }
      declaredFiles.delete(path);
    }
    if (declaredFiles.size !== 0) {
      throw new Error(`Go release manifest declares missing files: ${target.target}`);
    }
    for (const required of [
      "apps/theme-studio/dist/index.html",
      "themes/catalog.json",
      "themes/builtin/future-idol-cyan/theme.json",
      "themes/builtin/glacier-aurora/theme.json",
      "themes/builtin/hoshimiya-ichigo-shining-stage/theme.json",
      "themes/builtin/mountain-mist/theme.json",
      "themes/builtin/rose-carpet-star/theme.json",
      "themes/builtin/yua-mikami-starlight/theme.json",
      "release-manifest.json",
      "README.md",
      "README.en.md",
    ]) {
      await access(join(outputDirectory, "stages", target.target, PRODUCT, ...required.split("/")));
    }
  }
  for (const expected of report.artifacts) {
    const artifactPath = join(outputDirectory, expected.name);
    const contents = await readFile(artifactPath);
    if (contents.length !== expected.bytes || sha256(contents) !== expected.sha256) {
      throw new Error(`Go release artifact hash changed: ${expected.name}`);
    }
    if (expected.bytes >= expected.baselineBytes) {
      throw new Error(`Go release artifact exceeds its baseline: ${expected.name}`);
    }
    if (expected.kind === "setup-x64" && process.platform === "win32") {
      await acceptWindowsSetup(artifactPath);
    }
  }
  const kinds = new Set(report.artifacts.map(({ kind }) => kind));
  const nativeEvidenceComplete = TARGETS.every(({ target }) => report.targets.some((value) => value.target === target)) && [
    "zip-x64", "setup-x64", "tar.gz-arm64", "dmg-arm64", "tar.gz-x64", "dmg-x64",
  ].every((kind) => kinds.has(kind as GoReleaseArtifactReport["kind"]));
  if (requireAllNative && !nativeEvidenceComplete) {
    throw new Error("Go release native package evidence is incomplete");
  }
  return { accepted: true, artifactCount: report.artifacts.length, nativeEvidenceComplete };
}

export async function mergeGoReleasePackages(
  inputDirectories: readonly string[],
  outputDirectoryInput: string,
): Promise<GoReleaseReport> {
  if (inputDirectories.length < 2) {
    throw new Error("Go release merge requires Windows and macOS inputs");
  }
  const outputDirectory = resolve(outputDirectoryInput);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const inputs = inputDirectories.map((directory) => resolve(directory));
  const reports = await Promise.all(inputs.map(async (directory) => ({
    directory,
    report: JSON.parse(await readFile(join(directory, "go-release-report.json"), "utf8")) as GoReleaseReport,
  })));
  const foundation = reports[0]!.report;
  if (reports.some(({ report }) =>
    report.schemaVersion !== foundation.schemaVersion ||
    report.version !== foundation.version ||
    report.imageImplementation !== foundation.imageImplementation ||
    report.cgo !== foundation.cgo ||
    JSON.stringify(report.sidecars) !== JSON.stringify(foundation.sidecars)
  )) {
    throw new Error("Go release reports do not describe the same source build");
  }
  const selectedTargets = new Map<Target["target"], {
    readonly directory: string;
    readonly target: GoReleaseTargetReport;
  }>();
  for (const input of reports) {
    for (const target of input.report.targets) {
      const existing = selectedTargets.get(target.target);
      if (existing && JSON.stringify(existing.target) !== JSON.stringify(target)) {
        throw new Error(`Go release target reports conflict: ${target.target}`);
      }
      selectedTargets.set(target.target, { directory: input.directory, target });
    }
  }
  if (!TARGETS.every(({ target }) => selectedTargets.has(target))) {
    throw new Error("Go release merge is missing a native target");
  }
  for (const [target, value] of selectedTargets) {
    await cp(
      join(value.directory, "stages", target),
      join(outputDirectory, "stages", target),
      { recursive: true },
    );
  }
  const selected = new Map<GoReleaseArtifactReport["kind"], {
    readonly directory: string;
    readonly artifact: GoReleaseArtifactReport;
  }>();
  for (const input of reports) {
    for (const value of input.report.artifacts) {
      if (!selected.has(value.kind)) selected.set(value.kind, { directory: input.directory, artifact: value });
    }
  }
  const artifacts = [...selected.values()]
    .map(({ artifact: value }) => value)
    .sort((left, right) => left.kind.localeCompare(right.kind, "en"));
  for (const value of selected.values()) {
    await cp(
      join(value.directory, value.artifact.name),
      join(outputDirectory, value.artifact.name),
    );
  }
  const targets = TARGETS.map(({ target }) => selectedTargets.get(target)!.target);
  const report: GoReleaseReport = { ...foundation, targets, artifacts };
  await writeFile(join(outputDirectory, "go-release-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
