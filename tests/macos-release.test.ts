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
