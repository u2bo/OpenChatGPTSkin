import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ReleaseArch,
  ReleaseManifest,
} from "../../scripts/release/payload.js";

export async function createMacPayloadFixture(
  root: string,
  arch: ReleaseArch,
): Promise<string> {
  const releaseRoot = join(root, "OpenChatGPTSkin");
  await mkdir(join(releaseRoot, "runtime"), { recursive: true });
  await mkdir(join(
    releaseRoot,
    "node_modules",
    "@open-chatgpt-skin",
    "theme-studio-service",
    "dist",
  ), { recursive: true });
  await writeFile(join(releaseRoot, "runtime", "node"), "node", "utf8");
  await writeFile(join(releaseRoot, "OpenChatGPTSkin"), "#!/bin/sh\n", "utf8");
  await writeFile(join(
    releaseRoot,
    "node_modules",
    "@open-chatgpt-skin",
    "theme-studio-service",
    "dist",
    "cli.js",
  ), "process.exit(0);\n", "utf8");

  const relativeFiles = [
    "OpenChatGPTSkin",
    "runtime/node",
    "node_modules/@open-chatgpt-skin/theme-studio-service/dist/cli.js",
  ];
  const files: Record<string, {
    readonly bytes: number;
    readonly sha256: string;
  }> = {};
  for (const relativePath of relativeFiles) {
    const bytes = await readFile(join(releaseRoot, ...relativePath.split("/")));
    files[relativePath] = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    product: "OpenChatGPTSkin",
    version: "0.1.0-alpha.1",
    target: { platform: "darwin", arch },
    runtime: { nodeVersion: "22.18.0" },
    build: { commit: "0123456789abcdef0123456789abcdef01234567" },
    themeCatalog: { schemaVersion: 1 },
    entry: "OpenChatGPTSkin",
    themes: [
      "future-idol-cyan",
      "rose-carpet-star",
      "mountain-mist",
      "glacier-aurora",
    ],
    files,
  };
  await writeFile(
    join(releaseRoot, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return releaseRoot;
}
