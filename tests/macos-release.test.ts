import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  macDmgArtifactName,
  portableArtifactName,
  releasePlatformLabel,
} from "../scripts/release/artifact-names.js";
import {
  renderMacInfoPlist,
  renderMacLauncher,
  toAppleBundleVersion,
} from "../scripts/release/macos-metadata.js";
import {
  buildMacAppBundle,
  verifyMacAppBundleLayout,
} from "../scripts/release/macos-app.js";
import {
  assertMacBinaryArchitecture,
  buildMacDmg,
  generateMacIcon,
  macIconEntries,
} from "../scripts/release/macos-dmg.js";
import { acceptMacDmg } from "../scripts/release/macos-acceptance.js";
import { RELEASE_ACCEPTANCE_SCENARIOS } from
  "../scripts/release/acceptance.js";
import {
  packagePortableRelease,
  writeReleaseChecksums,
} from "../scripts/release/package-portable.js";
import { createMacPayloadFixture } from "./helpers/release-payload-fixture.js";

describe("macOS release metadata", () => {
  it("uses macos in user-facing names while preserving platform input", () => {
    expect(releasePlatformLabel("darwin")).toBe("macos");
    expect(portableArtifactName("0.1.0-alpha.1", "darwin", "arm64"))
      .toBe("OpenChatGPTSkin_0.1.0-alpha.1_macos_arm64.tar.gz");
    expect(macDmgArtifactName("0.1.0-alpha.1", "x64"))
      .toBe("OpenChatGPTSkin_0.1.0-alpha.1_macos_x64.dmg");
  });

  it("converts supported prerelease versions to Apple bundle versions", () => {
    expect(toAppleBundleVersion("0.1.0-alpha.1")).toBe("0.1.0a1");
    expect(toAppleBundleVersion("1.2.3-beta.4")).toBe("1.2.3b4");
    expect(toAppleBundleVersion("2.0.0-rc.2")).toBe("2.0.0fc2");
    expect(toAppleBundleVersion("2.0.0")).toBe("2.0.0");
    expect(() => toAppleBundleVersion("2.0.0-preview.1"))
      .toThrow("Unsupported macOS product version");
  });

  it("renders fixed bundle identity, exact product version, and safe launcher paths", () => {
    const plist = renderMacInfoPlist({
      productVersion: "0.1.0-alpha.1",
      arch: "arm64",
    });
    expect(plist).toContain("<string>io.github.u2bo.openchatgptskin</string>");
    expect(plist).toContain("<string>0.1.0a1</string>");
    expect(plist).toContain("<string>0.1.0-alpha.1</string>");
    expect(plist).toContain("<key>LSUIElement</key>\n  <true/>");

    const launcher = renderMacLauncher("0.1.0-alpha.1");
    expect(launcher).toContain('OPEN_CHATGPT_SKIN_INSTALL_ROOT="$payload"');
    expect(launcher).toContain('exec "$payload/runtime/node"');
    expect(launcher).not.toContain("process.cwd");
  });
});

describe("macOS app bundle", () => {
  it("wraps the accepted payload without changing its manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-mac-app-"));
    try {
      const releaseRoot = await createMacPayloadFixture(root, "arm64");
      const originalManifest = await readFile(
        join(releaseRoot, "release-manifest.json"),
        "utf8",
      );
      const iconPath = join(root, "AppIcon.icns");
      await writeFile(iconPath, "icon", "utf8");

      const result = await buildMacAppBundle({
        releaseRoot,
        outputDirectory: join(root, "bundle"),
        iconPath,
      });

      expect(result).toMatchObject({
        version: "0.1.0-alpha.1",
        arch: "arm64",
      });
      expect(await readFile(
        join(result.payloadRoot, "release-manifest.json"),
        "utf8",
      )).toBe(originalManifest);
      expect(await readFile(
        join(result.appPath, "Contents", "MacOS", "OpenChatGPTSkin"),
        "utf8",
      )).toContain('payload="$contents/Resources/payload"');
      if (process.platform !== "win32") {
        expect((await stat(
          join(result.appPath, "Contents", "MacOS", "OpenChatGPTSkin"),
        )).mode & 0o111).not.toBe(0);
      }
      await expect(verifyMacAppBundleLayout(result.appPath)).resolves
        .toMatchObject({
          version: "0.1.0-alpha.1",
          arch: "arm64",
        });
      await expect(buildMacAppBundle({
        releaseRoot,
        outputDirectory: join(root, "bundle"),
        iconPath,
      })).rejects.toThrow("macOS app output already exists");
      await expect(access(
        join(result.appPath, "Contents", "Resources", "AppIcon.icns"),
      )).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("macOS native distribution contract", () => {
  it("requires the complete Apple iconset", () => {
    expect(macIconEntries()).toEqual([
      ["icon_16x16.png", 16],
      ["icon_16x16@2x.png", 32],
      ["icon_32x32.png", 32],
      ["icon_32x32@2x.png", 64],
      ["icon_128x128.png", 128],
      ["icon_128x128@2x.png", 256],
      ["icon_256x256.png", 256],
      ["icon_256x256@2x.png", 512],
      ["icon_512x512.png", 512],
      ["icon_512x512@2x.png", 1024],
    ]);
  });

  it("accepts only the requested Mach-O architecture", () => {
    expect(() => assertMacBinaryArchitecture(
      "Mach-O 64-bit executable arm64",
      "arm64",
      "runtime/node",
    )).not.toThrow();
    expect(() => assertMacBinaryArchitecture(
      "Mach-O 64-bit executable x86_64",
      "x64",
      "runtime/node",
    )).not.toThrow();
    expect(() => assertMacBinaryArchitecture(
      "Mach-O 64-bit executable x86_64",
      "arm64",
      "runtime/node",
    )).toThrow("runtime/node does not target arm64");
    expect(() => assertMacBinaryArchitecture(
      "Mach-O universal binary with 2 architectures: [x86_64] [arm64]",
      "arm64",
      "runtime/node",
    )).toThrow("runtime/node does not target arm64");
  });

  it("registers the app bundle acceptance scenario", () => {
    expect(RELEASE_ACCEPTANCE_SCENARIOS).toContain("macos-app-bundle");
  });

  it.skipIf(process.platform === "darwin")(
    "rejects native packaging outside macOS",
    async () => {
      await expect(generateMacIcon("source.svg", "AppIcon.icns"))
        .rejects.toThrow("macOS icon generation requires Darwin");
      await expect(buildMacDmg({
        appPath: "OpenChatGPTSkin.app",
        outputDirectory: "artifacts",
        version: "0.1.0-alpha.1",
        arch: "arm64",
      })).rejects.toThrow("DMG packaging requires Darwin");
      await expect(acceptMacDmg("OpenChatGPTSkin.dmg"))
        .rejects.toThrow("macOS DMG acceptance requires Darwin");
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "creates an icns with the native macOS toolchain",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "ocs-mac-icon-"));
      try {
        const output = join(root, "AppIcon.icns");
        await generateMacIcon(
          "assets/branding/open-chatgpt-skin-icon.svg",
          output,
        );
        expect((await stat(output)).size).toBeGreaterThan(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe("macOS release integration", () => {
  it("packages Darwin with macos names and checksums the DMG", async () => {
    const root = await mkdtemp(join(tmpdir(), "ocs-mac-package-"));
    try {
      const releaseRoot = await createMacPayloadFixture(root, "arm64");
      const output = join(root, "artifacts");
      const portable = await packagePortableRelease(releaseRoot, output);
      expect(portable.name)
        .toBe("OpenChatGPTSkin_0.1.0-alpha.1_macos_arm64.tar.gz");
      await writeFile(
        join(output, "OpenChatGPTSkin_0.1.0-alpha.1_macos_arm64.dmg"),
        "dmg",
        "utf8",
      );
      const checksumsPath = await writeReleaseChecksums(output);
      const checksums = await readFile(checksumsPath, "utf8");
      expect(checksums).toContain(
        "OpenChatGPTSkin_0.1.0-alpha.1_macos_arm64.tar.gz",
      );
      expect(checksums).toContain(
        "OpenChatGPTSkin_0.1.0-alpha.1_macos_arm64.dmg",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes the macOS build and acceptance commands", async () => {
    const packageJson = JSON.parse(
      await readFile("package.json", "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };
    expect(packageJson.scripts?.["release:macos"])
      .toBe("tsx scripts/release/build-macos-distribution.ts");
    expect(packageJson.scripts?.["release:acceptance:macos"])
      .toBe("tsx scripts/release/accept-macos-distribution.ts");
  });
});
