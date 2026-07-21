import {
  assertReleaseVersion,
  type ReleaseArch,
} from "./payload.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface ProductVersionParts {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease?: "alpha" | "beta" | "rc";
  readonly prereleaseNumber?: string;
}

function parseProductVersion(productVersion: string): ProductVersionParts {
  try {
    assertReleaseVersion(productVersion);
  } catch {
    throw new Error(`Unsupported macOS product version: ${productVersion}`);
  }
  const [core, prereleaseText] = productVersion.split("-");
  const [major, minor, patch] = core!.split(".") as [string, string, string];
  if (!prereleaseText) return { major, minor, patch };
  const [prerelease, prereleaseNumber] =
    prereleaseText.split(".") as ["alpha" | "beta" | "rc", string];
  return { major, minor, patch, prerelease, prereleaseNumber };
}

export function toAppleBundleVersion(productVersion: string): string {
  const {
    major,
    minor,
    patch,
    prerelease,
    prereleaseNumber,
  } = parseProductVersion(productVersion);
  if (!prerelease) return `${major}.${minor}.${patch}`;
  const suffix = prerelease === "alpha"
    ? "a"
    : prerelease === "beta"
    ? "b"
    : "fc";
  return `${major}.${minor}.${patch}${suffix}${prereleaseNumber}`;
}

export function renderMacInfoPlist(input: {
  readonly productVersion: string;
  readonly arch: ReleaseArch;
}): string {
  const { major, minor, patch } = parseProductVersion(input.productVersion);
  const shortVersion = `${major}.${minor}.${patch}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>io.github.u2bo.openchatgptskin</string>
  <key>CFBundleName</key>
  <string>OpenChatGPTSkin</string>
  <key>CFBundleDisplayName</key>
  <string>OpenChatGPTSkin</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>OpenChatGPTSkin</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleShortVersionString</key>
  <string>${escapeXml(shortVersion)}</string>
  <key>CFBundleVersion</key>
  <string>${escapeXml(toAppleBundleVersion(input.productVersion))}</string>
  <key>OpenChatGPTSkinProductVersion</key>
  <string>${escapeXml(input.productVersion)}</string>
  <key>OpenChatGPTSkinArchitecture</key>
  <string>${escapeXml(input.arch)}</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSMultipleInstancesProhibited</key>
  <true/>
</dict>
</plist>
`;
}

export function renderMacLauncher(productVersion: string): string {
  parseProductVersion(productVersion);
  return `#!/bin/sh
set -eu
contents="$(CDPATH= cd "$(dirname "$0")/.." && pwd -P)"
payload="$contents/Resources/payload"
export OPEN_CHATGPT_SKIN_INSTALL_ROOT="$payload"
export OPEN_CHATGPT_SKIN_VERSION="${productVersion}"
exec "$payload/runtime/node" "$payload/node_modules/@open-chatgpt-skin/theme-studio-service/dist/cli.js" "$@"
`;
}
