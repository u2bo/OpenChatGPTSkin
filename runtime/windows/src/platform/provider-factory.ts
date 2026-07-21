import type { RuntimePaths } from "../paths.js";
import type { DesktopRuntimeProvider } from "../types.js";
import { RuntimeError } from "../errors.js";
import { MacOsRuntimeProvider } from "../macos/macos-provider.js";
import { PowerShellWindowsProvider } from "../windows/powershell-provider.js";

export function createProductionDesktopProvider(
  paths: RuntimePaths,
  platform: NodeJS.Platform = process.platform,
): DesktopRuntimeProvider {
  if (platform === "win32") {
    return new PowerShellWindowsProvider(undefined, paths.dataRoot);
  }
  if (platform === "darwin") {
    return new MacOsRuntimeProvider({ dataRoot: paths.dataRoot });
  }
  throw new RuntimeError(
    "RUNTIME_ENVIRONMENT_INVALID",
    `Unsupported desktop platform: ${platform}`,
    "Use OpenChatGPTSkin on Windows or macOS.",
  );
}
