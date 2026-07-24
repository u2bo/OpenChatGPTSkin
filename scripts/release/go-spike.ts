import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
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
import { strToU8, zipSync } from "fflate";

const execFileAsync = promisify(execFile);
const SPIKE_VERSION = "0.3.0-alpha.1";
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

export interface GoSpikeTargetReport {
  readonly target: Target["target"];
  readonly executableFormat: Target["executableFormat"];
  readonly executableBytes: number;
  readonly stageBytes: number;
  readonly baselineStageBytes: number;
}

export interface GoSpikeArtifactReport {
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

export interface GoSpikeReport {
  readonly schemaVersion: 1;
  readonly version: typeof SPIKE_VERSION;
  readonly imageImplementation: typeof IMAGE_IMPLEMENTATION;
  readonly cgo: false;
  readonly sidecars: readonly [];
  readonly targets: readonly GoSpikeTargetReport[];
  readonly artifacts: readonly GoSpikeArtifactReport[];
}

export interface BuildGoSpikeOptions {
  readonly workspaceRoot: string;
  readonly outputDirectory: string;
  readonly nativeInstallers: boolean;
  readonly nativeArtifactsOnly?: boolean;
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
    else throw new Error(`Go spike payload contains a non-file entry: ${path}`);
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

async function artifact(path: string, kind: GoSpikeArtifactReport["kind"], baselineBytes: number): Promise<GoSpikeArtifactReport> {
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
  throw new Error("Go spike executable format is invalid");
}

async function zipStage(stageParent: string, output: string): Promise<void> {
  const root = join(stageParent, PRODUCT);
  const entries: Record<string, Uint8Array> = {};
  for (const path of await walkFiles(root)) {
    entries[`${PRODUCT}/${path}`] = await readFile(join(root, ...path.split("/")));
  }
  await writeFile(output, zipSync(entries, { level: 9 }));
}

async function tarStage(stageParent: string, output: string): Promise<void> {
  await execFileAsync("tar", ["-czf", output, "-C", stageParent, PRODUCT], {
    windowsHide: true,
  });
}

async function stageTarget(
  workspaceRoot: string,
  outputDirectory: string,
  target: Target,
): Promise<GoSpikeTargetReport> {
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
    "-ldflags", "-s -w",
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
  ]);
  await writeFile(join(stageRoot, "go-spike-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    version: SPIKE_VERSION,
    target: target.target,
    roles: ["studio", "controller", "runtime"],
    imageImplementation: IMAGE_IMPLEMENTATION,
    cgo: false,
    sidecars: [],
  }, null, 2)}\n`, "utf8");
  const executableContents = await readFile(executablePath);
  const executableFormat = inspectExecutable(executableContents);
  if (executableFormat !== target.executableFormat) {
    throw new Error(`Go spike target format mismatch: ${target.target}`);
  }
  return {
    target: target.target,
    executableFormat,
    executableBytes: executableContents.length,
    stageBytes: await directoryBytes(stageRoot),
    baselineStageBytes: target.baselineStageBytes,
  };
}

async function buildPortableArtifacts(
  outputDirectory: string,
  targets: readonly Target[],
): Promise<GoSpikeArtifactReport[]> {
  const artifacts: GoSpikeArtifactReport[] = [];
  for (const target of targets) {
    const stageParent = join(outputDirectory, "stages", target.target);
    if (target.goos === "windows") {
      const path = join(outputDirectory, `${PRODUCT}_${SPIKE_VERSION}_go-spike_windows_x64.zip`);
      await zipStage(stageParent, path);
      artifacts.push(await artifact(path, target.archiveKind, target.archiveBaselineBytes));
    } else {
      const arch = target.goarch === "arm64" ? "arm64" : "x64";
      const path = join(outputDirectory, `${PRODUCT}_${SPIKE_VERSION}_go-spike_macos_${arch}.tar.gz`);
      await tarStage(stageParent, path);
      artifacts.push(await artifact(path, target.archiveKind, target.archiveBaselineBytes));
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
    throw new Error(`Go spike native packaging does not support ${process.platform}/${process.arch}`);
  }
  return target;
}

async function findInnoSetup(): Promise<string | null> {
  for (const path of [
    process.env.INNO_SETUP_COMPILER,
    "C:/Program Files (x86)/Inno Setup 6/ISCC.exe",
    "C:/Program Files/Inno Setup 6/ISCC.exe",
  ]) {
    if (path && await pathExists(path)) return path;
  }
  return null;
}

async function buildWindowsSetup(outputDirectory: string): Promise<GoSpikeArtifactReport> {
  const compiler = await findInnoSetup();
  if (!compiler) throw new Error("Native Windows Go spike packaging requires Inno Setup 6");
  const stageRoot = join(outputDirectory, "stages", "windows-x64", PRODUCT);
  const buildRoot = await mkdtemp(join(tmpdir(), "openchatgptskin-go-inno-"));
  try {
    const script = join(buildRoot, "go-spike.iss");
    const outputBase = `${PRODUCT}_${SPIKE_VERSION}_go-spike_windows_x64_Setup`;
    const quote = (value: string) => value.replaceAll('"', '""');
    await writeFile(script, [
      "[Setup]",
      `AppName=${PRODUCT} Go Host Spike`,
      `AppVersion=${SPIKE_VERSION}`,
      `DefaultDirName={localappdata}\\${PRODUCT}-Go-Spike`,
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
      `Name: "{autoprograms}\\${PRODUCT} Go Host Spike"; Filename: "{app}\\OpenChatGPTSkin.exe"`,
      "",
    ].join("\r\n"), "utf8");
    await execFileAsync(compiler, [script], { windowsHide: true });
    return artifact(join(outputDirectory, `${outputBase}.exe`), "setup-x64", 34083496);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

async function buildMacDmg(
  outputDirectory: string,
  target: Extract<Target, { readonly goos: "darwin" }>,
): Promise<GoSpikeArtifactReport> {
  const arch = target.goarch === "arm64" ? "arm64" : "x64";
  const stageRoot = join(outputDirectory, "stages", target.target, PRODUCT);
  const buildRoot = await mkdtemp(join(tmpdir(), `openchatgptskin-go-dmg-${arch}-`));
  try {
    const app = join(buildRoot, `${PRODUCT}.app`);
    const contents = join(app, "Contents");
    const payload = join(contents, "Resources", "payload");
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await mkdir(payload, { recursive: true });
    await cp(join(stageRoot, "OpenChatGPTSkin"), join(contents, "MacOS", "OpenChatGPTSkin"));
    await chmod(join(contents, "MacOS", "OpenChatGPTSkin"), 0o755);
    for (const path of await walkFiles(stageRoot)) {
      if (path === "OpenChatGPTSkin") continue;
      const destination = join(payload, ...path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(stageRoot, ...path.split("/")), destination);
    }
    await writeFile(join(contents, "Info.plist"), [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
      "<plist version=\"1.0\"><dict>",
      "<key>CFBundleExecutable</key><string>OpenChatGPTSkin</string>",
      "<key>CFBundleIdentifier</key><string>io.github.u2bo.openchatgptskin</string>",
      `<key>CFBundleShortVersionString</key><string>${SPIKE_VERSION}</string>`,
      "<key>CFBundleVersion</key><string>0.3.0.1</string>",
      "<key>CFBundlePackageType</key><string>APPL</string>",
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
    const output = join(outputDirectory, `${PRODUCT}_${SPIKE_VERSION}_go-spike_macos_${arch}.dmg`);
    await execFileAsync("hdiutil", [
      "create", "-volname", `${PRODUCT} Go Spike`, "-srcfolder", app,
      "-format", "UDZO", "-ov", output,
    ]);
    await execFileAsync("hdiutil", ["verify", output]);
    return artifact(output, arch === "arm64" ? "dmg-arm64" : "dmg-x64", arch === "arm64" ? 59251126 : 62221496);
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
    if (value.role !== "studio") throw new Error("Installed Go spike host health failed");
    await execFileAsync(join(installRoot, "unins000.exe"), [
      "/VERYSILENT",
      "/SUPPRESSMSGBOXES",
      "/NORESTART",
    ], { windowsHide: true });
  } finally {
    if (await pathExists(installRoot)) await rm(installRoot, { recursive: true, force: true });
  }
}

export async function buildGoSpikePackages(options: BuildGoSpikeOptions): Promise<GoSpikeReport> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error("npm_execpath is required to build the Go spike UI");
  await execFileAsync(process.execPath, [npmExecPath, "run", "studio:build"], {
    cwd: workspaceRoot,
    windowsHide: true,
  });
  const targets: GoSpikeTargetReport[] = [];
  for (const target of TARGETS) targets.push(await stageTarget(workspaceRoot, outputDirectory, target));
  const nativeTarget = options.nativeInstallers || options.nativeArtifactsOnly
    ? currentNativeTarget()
    : undefined;
  const artifacts = await buildPortableArtifacts(
    outputDirectory,
    options.nativeArtifactsOnly ? [nativeTarget!] : TARGETS,
  );
  if (options.nativeInstallers) {
    if (process.platform === "win32") artifacts.push(await buildWindowsSetup(outputDirectory));
    if (process.platform === "darwin") {
      artifacts.push(await buildMacDmg(
        outputDirectory,
        nativeTarget as Extract<Target, { readonly goos: "darwin" }>,
      ));
    }
  }
  const report: GoSpikeReport = {
    schemaVersion: 1,
    version: SPIKE_VERSION,
    imageImplementation: IMAGE_IMPLEMENTATION,
    cgo: false,
    sidecars: [],
    targets,
    artifacts,
  };
  await writeFile(join(outputDirectory, "go-spike-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function acceptGoSpikePackages(
  outputDirectoryInput: string,
  requireAllNative: boolean,
): Promise<{
  readonly accepted: true;
  readonly artifactCount: number;
  readonly nativeEvidenceComplete: boolean;
}> {
  const outputDirectory = resolve(outputDirectoryInput);
  const report = JSON.parse(await readFile(join(outputDirectory, "go-spike-report.json"), "utf8")) as GoSpikeReport;
  if (report.schemaVersion !== 1 || report.targets.length !== 3) {
    throw new Error("Go spike report identity is invalid");
  }
  for (const target of report.targets) {
    if (target.stageBytes >= target.baselineStageBytes) {
      throw new Error(`Go spike stage exceeds its baseline: ${target.target}`);
    }
    const definition = TARGETS.find((value) => value.target === target.target);
    if (!definition) throw new Error(`Unknown Go spike target: ${target.target}`);
    const executable = await readFile(join(
      outputDirectory, "stages", target.target, PRODUCT, definition.executable,
    ));
    if (inspectExecutable(executable) !== target.executableFormat) {
      throw new Error(`Go spike executable format changed: ${target.target}`);
    }
    for (const required of [
      "apps/theme-studio/dist/index.html",
      "themes/catalog.json",
      "themes/builtin/future-idol-cyan/theme.json",
      "themes/builtin/glacier-aurora/theme.json",
      "themes/builtin/mountain-mist/theme.json",
      "themes/builtin/rose-carpet-star/theme.json",
      "themes/builtin/yua-mikami-starlight/theme.json",
      "go-spike-manifest.json",
    ]) {
      await access(join(outputDirectory, "stages", target.target, PRODUCT, ...required.split("/")));
    }
  }
  for (const expected of report.artifacts) {
    const artifactPath = join(outputDirectory, expected.name);
    const contents = await readFile(artifactPath);
    if (contents.length !== expected.bytes || sha256(contents) !== expected.sha256) {
      throw new Error(`Go spike artifact hash changed: ${expected.name}`);
    }
    if (expected.bytes >= expected.baselineBytes) {
      throw new Error(`Go spike artifact exceeds its baseline: ${expected.name}`);
    }
    if (expected.kind === "setup-x64" && process.platform === "win32") {
      await acceptWindowsSetup(artifactPath);
    }
  }
  const kinds = new Set(report.artifacts.map(({ kind }) => kind));
  const nativeEvidenceComplete = [
    "zip-x64", "setup-x64", "tar.gz-arm64", "dmg-arm64", "tar.gz-x64", "dmg-x64",
  ].every((kind) => kinds.has(kind as GoSpikeArtifactReport["kind"]));
  if (requireAllNative && !nativeEvidenceComplete) {
    throw new Error("Go spike native package evidence is incomplete");
  }
  return { accepted: true, artifactCount: report.artifacts.length, nativeEvidenceComplete };
}

export async function mergeGoSpikePackages(
  inputDirectories: readonly string[],
  outputDirectoryInput: string,
): Promise<GoSpikeReport> {
  if (inputDirectories.length < 2) {
    throw new Error("Go spike merge requires Windows and macOS inputs");
  }
  const outputDirectory = resolve(outputDirectoryInput);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const inputs = inputDirectories.map(resolve);
  const reports = await Promise.all(inputs.map(async (directory) => ({
    directory,
    report: JSON.parse(await readFile(join(directory, "go-spike-report.json"), "utf8")) as GoSpikeReport,
  })));
  const foundation = reports[0]!.report;
  if (reports.some(({ report }) =>
    report.schemaVersion !== foundation.schemaVersion ||
    report.version !== foundation.version ||
    report.imageImplementation !== foundation.imageImplementation ||
    JSON.stringify(report.targets) !== JSON.stringify(foundation.targets)
  )) {
    throw new Error("Go spike reports do not describe the same source build");
  }
  await cp(join(reports[0]!.directory, "stages"), join(outputDirectory, "stages"), { recursive: true });
  const selected = new Map<GoSpikeArtifactReport["kind"], {
    readonly directory: string;
    readonly artifact: GoSpikeArtifactReport;
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
  const report: GoSpikeReport = { ...foundation, artifacts };
  await writeFile(join(outputDirectory, "go-spike-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
