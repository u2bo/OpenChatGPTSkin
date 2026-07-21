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
