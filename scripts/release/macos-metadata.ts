import type { ReleaseArch } from "./payload.js";

const MACOS_PRODUCT_VERSION =
  /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseProductVersion(productVersion: string): RegExpExecArray {
  const match = MACOS_PRODUCT_VERSION.exec(productVersion);
  if (!match) {
    throw new Error(`Unsupported macOS product version: ${productVersion}`);
  }
  return match;
}

export function toAppleBundleVersion(productVersion: string): string {
  const [, major, minor, patch, prerelease, number] =
    parseProductVersion(productVersion);
  if (!prerelease) return `${major}.${minor}.${patch}`;
  const suffix = prerelease === "alpha"
    ? "a"
    : prerelease === "beta"
    ? "b"
    : "fc";
  return `${major}.${minor}.${patch}${suffix}${number}`;
}

export function renderMacInfoPlist(input: {
  readonly productVersion: string;
  readonly arch: ReleaseArch;
}): string {
  const shortVersion = parseProductVersion(input.productVersion)
    .slice(1, 4)
    .join(".");
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
