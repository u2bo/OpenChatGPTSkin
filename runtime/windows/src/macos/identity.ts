export const MACOS_CODEX_BUNDLE_ID = "com.openai.codex";
export const MACOS_CODEX_IDENTITY_NAME = "OpenAI.Codex";
export const MACOS_CODEX_TEAM_ID = "2DC432GLL2";
export const MACOS_CODEX_ENTRY_POINT = "macOS.Application";
export const MACOS_CODEX_NOTARIZATION_AUTHORITY = "Notarized Developer ID";
export const MACOS_CODEX_RESOURCE_SIGNER = "OpenAI, L.L.C.";

export function macOsEntryRelativePath(executableName: string): string {
  return `Contents/MacOS/${executableName}`;
}
