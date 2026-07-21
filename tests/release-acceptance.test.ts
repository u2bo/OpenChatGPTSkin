import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptReleasePayload,
  verifyReleasePayload,
} from "../scripts/release/acceptance.js";
import {
  readReleaseManifest,
  stageReleasePayload,
  type StageReleasePayloadOptions,
} from "../scripts/release/payload.js";

const roots: string[] = [];
const themeIds = [
  "future-idol-cyan",
  "rose-carpet-star",
  "mountain-mist",
  "glacier-aurora",
] as const;
const buildCommit = "0123456789abcdef0123456789abcdef01234567";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createReleaseFixture(): Promise<{
  readonly workspaceRoot: string;
  readonly nodeExecutablePath: string;
  readonly nodeLicensePath: string;
}> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ocs-release-source-"));
  roots.push(workspaceRoot);
  await Promise.all([
    mkdir(join(workspaceRoot, "apps", "theme-studio", "dist"), { recursive: true }),
    mkdir(join(workspaceRoot, "runtime", "theme-studio-service", "dist"), { recursive: true }),
    mkdir(join(workspaceRoot, "themes", "builtin"), { recursive: true }),
    mkdir(join(workspaceRoot, "node-runtime"), { recursive: true }),
  ]);

  await writeJson(join(workspaceRoot, "package.json"), {
    name: "open-chatgpt-skin",
    version: "0.1.0-alpha.1",
    private: true,
    workspaces: ["runtime/*"],
  });
  await writeJson(join(workspaceRoot, "runtime", "theme-studio-service", "package.json"), {
    name: "@open-chatgpt-skin/theme-studio-service",
    version: "0.1.0-alpha.1",
    type: "module",
    dependencies: {},
  });
  await writeFile(
    join(workspaceRoot, "runtime", "theme-studio-service", "dist", "cli.js"),
    "process.stdout.write('fixture');\n",
    "utf8",
  );
  await Promise.all([
    writeFile(
      join(workspaceRoot, "runtime", "theme-studio-service", "dist", "cli.js.map"),
      '{"version":3,"sources":["../src/cli.ts"]}\n',
      "utf8",
    ),
    writeFile(
      join(workspaceRoot, "runtime", "theme-studio-service", "dist", "cli.d.ts"),
      "export {};\n",
      "utf8",
    ),
  ]);
  await writeFile(
    join(workspaceRoot, "apps", "theme-studio", "dist", "index.html"),
    '<!doctype html><meta property="csp-nonce" nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__"><script nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__"></script>',
    "utf8",
  );
  await Promise.all([
    writeFile(join(workspaceRoot, "README.md"), "# OpenChatGPTSkin\n", "utf8"),
    writeFile(join(workspaceRoot, "README.en.md"), "# OpenChatGPTSkin\n", "utf8"),
    writeFile(join(workspaceRoot, "LICENSE"), "MIT\n", "utf8"),
    writeFile(join(workspaceRoot, "node-runtime", "LICENSE"), "Node.js license\n", "utf8"),
  ]);
  await copyFile(process.execPath, join(workspaceRoot, "node-runtime", "node.exe"));
  await writeFile(
    join(workspaceRoot, "runtime", "theme-studio-service", "dist", "cli.js"),
    `import { createServer } from "node:http";
if (process.env.NODE_PATH || process.env.NODE_OPTIONS) {
  process.stderr.write("Release acceptance inherited a global Node environment");
  process.exit(19);
}
const themes = ${JSON.stringify(themeIds)}.map((id) => ({ source: "builtin", ref: { id, version: "1.0.0" } }));
const token = "a".repeat(64);
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'nonce-fixture'; script-src 'self' 'nonce-fixture'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><meta property="csp-nonce" nonce="fixture"><script nonce="fixture">window.ok=true</script>');
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/session") {
    response.writeHead(204, { "Set-Cookie": "ocs_studio=fixture; HttpOnly; SameSite=Strict; Path=/" });
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    response.end(JSON.stringify({ protocolVersion: 2, studioVersion: process.env.OPEN_CHATGPT_SKIN_VERSION, capabilities: ["studio-shell"], runtime: { status: "stopped" } }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/themes") {
    response.end(JSON.stringify({ themes }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/drafts") {
    response.writeHead(201);
    response.end(JSON.stringify({ draftId: "00000000-0000-4000-8000-000000000001", revision: 0 }));
    return;
  }
  if (request.method === "POST" && url.pathname.endsWith("/assets")) {
    response.end(JSON.stringify({ draftId: "00000000-0000-4000-8000-000000000001", revision: 1 }));
    return;
  }
  if (request.method === "POST" && url.pathname.endsWith("/save")) {
    response.end(JSON.stringify({ ref: { id: "acceptance-theme", version: "1.0.0" } }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/export") {
    response.writeHead(200, { "Content-Type": "application/vnd.open-chatgpt-skin+zip" });
    response.end("fixture-archive");
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({ url: \`http://127.0.0.1:\${address.port}/#bootstrap=\${token}\` }) + "\\n");
});
process.once("SIGTERM", () => server.close());
`,
    "utf8",
  );

  const builtins = [];
  for (const id of themeIds) {
    const directory = join(workspaceRoot, "themes", "builtin", id);
    await mkdir(join(directory, "assets"), { recursive: true });
    const files = new Map<string, Uint8Array>([
      ["theme.json", Buffer.from(JSON.stringify({ id, version: "1.0.0" }))],
      ["assets/background.webp", Buffer.from(`background:${id}`)],
      ["preview.webp", Buffer.from(`preview:${id}`)],
    ]);
    for (const [relativePath, bytes] of files) {
      await writeFile(join(directory, ...relativePath.split("/")), bytes);
    }
    await writeFile(join(directory, "source.png"), `authoring:${id}`, "utf8");
    await writeFile(join(directory, "LICENSE.md"), `License for ${id}\n`, "utf8");
    await writeJson(join(directory, "manifest.json"), {
      schemaVersion: 1,
      themeId: id,
      themeVersion: "1.0.0",
      files: Object.fromEntries([...files].map(([relativePath, bytes]) => [
        relativePath,
        { bytes: bytes.length, sha256: sha256(bytes) },
      ])),
    });
    builtins.push({
      id,
      name: id,
      version: "1.0.0",
      kind: "theme",
      path: `builtin/${id}`,
      ready: true,
      localOnly: false,
      licenseId: "MIT",
      preview: `builtin/${id}/preview.webp`,
    });
  }
  await writeJson(join(workspaceRoot, "themes", "catalog.json"), {
    schemaVersion: 1,
    builtins,
    recipes: [],
  });

  return {
    workspaceRoot,
    nodeExecutablePath: join(workspaceRoot, "node-runtime", "node.exe"),
    nodeLicensePath: join(workspaceRoot, "node-runtime", "LICENSE"),
  };
}

async function createReleaseRoot(): Promise<string> {
  const outputRoot = await mkdtemp(join(tmpdir(), "ocs-release-output-"));
  roots.push(outputRoot);
  return join(outputRoot, "OpenChatGPTSkin");
}

function releaseOptions(
  fixture: Awaited<ReturnType<typeof createReleaseFixture>>,
  releaseRoot: string,
  overrides: Partial<StageReleasePayloadOptions> = {},
): StageReleasePayloadOptions {
  return {
    workspaceRoot: fixture.workspaceRoot,
    releaseRoot,
    version: "0.1.0-alpha.1",
    platform: "win32",
    arch: "x64",
    nodeVersion: process.versions.node,
    buildCommit,
    nodeExecutablePath: fixture.nodeExecutablePath,
    nodeLicensePath: fixture.nodeLicensePath,
    ...overrides,
  };
}

describe("Release Acceptance", () => {
  it("stages the production payload while excluding authoring-only assets", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();

    await stageReleasePayload(releaseOptions(fixture, releaseRoot));

    const manifest = await readReleaseManifest(releaseRoot);
    const verification = await verifyReleasePayload(releaseRoot);
    expect(verification).toMatchObject({
      version: "0.1.0-alpha.1",
      target: { platform: "win32", arch: "x64" },
      filesVerified: Object.keys(manifest.files).length,
    });
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      product: "OpenChatGPTSkin",
      version: "0.1.0-alpha.1",
      target: { platform: "win32", arch: "x64" },
      runtime: { nodeVersion: process.versions.node },
      build: { commit: buildCommit },
      themeCatalog: { schemaVersion: 1 },
      entry: "OpenChatGPTSkin.cmd",
    });
    expect(manifest.themes).toEqual(themeIds);
    expect(Object.keys(manifest.files)).toEqual(
      expect.arrayContaining([
        "OpenChatGPTSkin.cmd",
        "apps/theme-studio/dist/index.html",
        "runtime/node.exe",
        "runtime/LICENSE",
        "themes/catalog.json",
      ]),
    );
    const releaseFiles = Object.keys(manifest.files);
    for (const forbidden of [
      /source\.png$/,
      /^docs\/superpowers\//,
      /^node_modules\/vite\//,
      /\.map$/,
      /\.d\.ts$/,
    ]) {
      expect(releaseFiles.some((file) => forbidden.test(file))).toBe(false);
    }
    await expect(access(join(
      releaseRoot,
      "node_modules",
      "@open-chatgpt-skin",
      "theme-studio-service",
      "dist",
      "cli.js",
    ))).resolves.toBeUndefined();
    await expect(access(join(
      releaseRoot,
      "themes",
      "builtin",
      "mountain-mist",
      "source.png",
    ))).rejects.toMatchObject({ code: "ENOENT" });

    const launcher = await readFile(join(releaseRoot, "OpenChatGPTSkin.cmd"), "utf8");
    expect(launcher).toContain("OPEN_CHATGPT_SKIN_INSTALL_ROOT");
    expect(launcher).toContain("runtime\\node.exe");
    expect(launcher).toContain("theme-studio-service\\dist\\cli.js");

    const previousNodePath = process.env.NODE_PATH;
    const previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_PATH = join(fixture.workspaceRoot, "global-node-modules");
    process.env.NODE_OPTIONS = "--no-warnings";
    let acceptance: Awaited<ReturnType<typeof acceptReleasePayload>>;
    try {
      acceptance = await acceptReleasePayload(releaseRoot);
    } finally {
      if (previousNodePath === undefined) delete process.env.NODE_PATH;
      else process.env.NODE_PATH = previousNodePath;
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
    }
    expect(acceptance).toMatchObject({
      scenario: "staged-payload",
      version: "0.1.0-alpha.1",
      target: { platform: "win32", arch: "x64" },
      uiVerified: true,
      themesVerified: 4,
      imageProcessingVerified: true,
      gracefulExitVerified: true,
      steps: {
        manifest: "passed",
        productionUi: "passed",
        session: "passed",
        runtimeStatus: "passed",
        themes: "passed",
        imageProcessing: "passed",
        themeExport: "passed",
        gracefulExit: "passed",
      },
    });
    expect(acceptance.durationMs).toBeGreaterThanOrEqual(0);
    expect(acceptance.exportBytes).toBeGreaterThan(0);
  });

  it("rejects an unsupported target before creating a payload", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();

    await expect(stageReleasePayload(releaseOptions(fixture, releaseRoot, {
      platform: "linux" as StageReleasePayloadOptions["platform"],
    }))).rejects.toThrow("Unsupported release platform: linux");
    await expect(access(releaseRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a missing output parent without reusing an existing payload", async () => {
    const fixture = await createReleaseFixture();
    const outputRoot = await mkdtemp(join(tmpdir(), "ocs-release-parent-"));
    roots.push(outputRoot);
    const releaseRoot = join(outputRoot, "missing", "OpenChatGPTSkin");

    await stageReleasePayload(releaseOptions(fixture, releaseRoot));
    await expect(access(join(releaseRoot, "release-manifest.json")))
      .resolves.toBeUndefined();
    await expect(stageReleasePayload(releaseOptions(fixture, releaseRoot)))
      .rejects.toMatchObject({ code: "EEXIST" });
  });

  it.skipIf(process.platform !== "win32")(
    "rejects a case-variant output path inside the source workspace on Windows",
    async () => {
      const fixture = await createReleaseFixture();
      const caseVariantWorkspace = fixture.workspaceRoot === fixture.workspaceRoot.toUpperCase()
        ? fixture.workspaceRoot.toLowerCase()
        : fixture.workspaceRoot.toUpperCase();
      const releaseRoot = join(caseVariantWorkspace, "release", "OpenChatGPTSkin");

      await expect(stageReleasePayload(releaseOptions(fixture, releaseRoot)))
        .rejects.toThrow("Release output must be outside the source workspace");
    },
  );

  it("rejects a theme asset that no longer matches its manifest", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();
    await writeFile(join(
      fixture.workspaceRoot,
      "themes",
      "builtin",
      "mountain-mist",
      "assets",
      "background.webp",
    ), "tampered", "utf8");

    await expect(stageReleasePayload(releaseOptions(fixture, releaseRoot)))
      .rejects.toThrow("Theme asset failed manifest verification: mountain-mist");
  });

  it("rejects a missing production dependency", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();
    await writeJson(join(
      fixture.workspaceRoot,
      "runtime",
      "theme-studio-service",
      "package.json",
    ), {
      name: "@open-chatgpt-skin/theme-studio-service",
      version: "0.1.0-alpha.1",
      type: "module",
      dependencies: { sharp: "0.34.5" },
    });

    await expect(stageReleasePayload(releaseOptions(fixture, releaseRoot)))
      .rejects.toThrow("Production dependency is not installed: sharp");
  });

  it("rejects a package version that differs from the requested release", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();

    await expect(stageReleasePayload(releaseOptions(fixture, releaseRoot, {
      version: "0.1.0-alpha.2",
    }))).rejects.toThrow("Root package version does not match release version");
  });

  it("rejects a bundled Node Runtime that differs from the manifest", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();
    await stageReleasePayload(releaseOptions(fixture, releaseRoot, {
      nodeVersion: "0.0.0",
    }));

    await expect(acceptReleasePayload(releaseRoot))
      .rejects.toThrow("Bundled Node Runtime version mismatch");
  });

  it("rejects production UI responses without the complete security headers", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();
    const serviceCli = join(
      fixture.workspaceRoot,
      "runtime",
      "theme-studio-service",
      "dist",
      "cli.js",
    );
    const source = await readFile(serviceCli, "utf8");
    await writeFile(serviceCli, source
      .replace('  response.setHeader("Referrer-Policy", "no-referrer");\n', "")
      .replace('  response.setHeader("X-Frame-Options", "DENY");\n', ""), "utf8");
    await stageReleasePayload(releaseOptions(fixture, releaseRoot));

    await expect(acceptReleasePayload(releaseRoot))
      .rejects.toThrow("Production UI security headers are invalid");
  });

  it("rejects production UI with an inline asset missing the CSP nonce", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();
    const serviceCli = join(
      fixture.workspaceRoot,
      "runtime",
      "theme-studio-service",
      "dist",
      "cli.js",
    );
    const source = await readFile(serviceCli, "utf8");
    await writeFile(
      serviceCli,
      source.replace('<script nonce="fixture">', "<script>"),
      "utf8",
    );
    await stageReleasePayload(releaseOptions(fixture, releaseRoot));

    await expect(acceptReleasePayload(releaseRoot))
      .rejects.toThrow("Production UI inline assets are not nonce-bound");
  });

  it("rejects a payload when the production host exits before readiness", async () => {
    const fixture = await createReleaseFixture();
    const releaseRoot = await createReleaseRoot();
    await writeFile(join(
      fixture.workspaceRoot,
      "runtime",
      "theme-studio-service",
      "dist",
      "cli.js",
    ), "process.exitCode = 17;\n", "utf8");
    await stageReleasePayload(releaseOptions(fixture, releaseRoot));

    await expect(acceptReleasePayload(releaseRoot))
      .rejects.toThrow("Release process exited before startup with code 17");
  });
});
