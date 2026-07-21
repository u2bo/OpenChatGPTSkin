import {
  assertReleaseTarget,
  assertReleaseVersion,
  type ReleaseArch,
  type ReleasePlatform,
} from "./payload.js";

export function releasePlatformLabel(
  platform: ReleasePlatform,
): "windows" | "macos" {
  return platform === "win32" ? "windows" : "macos";
}

export function portableArtifactName(
  version: string,
  platform: ReleasePlatform,
  arch: ReleaseArch,
): string {
  assertReleaseVersion(version);
  assertReleaseTarget(platform, arch);
  const suffix = platform === "win32" ? ".zip" : ".tar.gz";
  return `OpenChatGPTSkin_${version}_${releasePlatformLabel(platform)}_${arch}${suffix}`;
}

export function macDmgArtifactName(
  version: string,
  arch: ReleaseArch,
): string {
  assertReleaseVersion(version);
  assertReleaseTarget("darwin", arch);
  return `OpenChatGPTSkin_${version}_macos_${arch}.dmg`;
}
