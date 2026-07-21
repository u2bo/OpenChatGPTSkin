import { RuntimeThemeError } from "@open-chatgpt-skin/cdp-adapter";
import { RuntimeError, isRuntimeErrorCode } from "../errors.js";
import {
  RuntimeThemeRepository,
  type LoadedRuntimeTheme,
  type RuntimeThemeLookup,
} from "../themes/runtime-theme-repository.js";
import type { RuntimePageSession } from "./page-session.js";

function runtimeFailure(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  const code = error instanceof RuntimeThemeError && isRuntimeErrorCode(error.code)
    ? error.code
    : "INTERNAL";
  const mapped = new RuntimeError(code, "Theme operation failed");
  Object.defineProperty(mapped, "cause", {
    configurable: false,
    enumerable: false,
    value: error,
  });
  return mapped;
}

export class ThemeEngine {
  constructor(private readonly repository: RuntimeThemeRepository) {}

  load(theme: RuntimeThemeLookup): Promise<LoadedRuntimeTheme> {
    return this.repository.load(theme);
  }

  async apply(session: RuntimePageSession, theme: LoadedRuntimeTheme): Promise<void> {
    try {
      await session.adapter.apply(theme.compiled);
      const verification = await session.adapter.verify();
      if (!verification.valid) {
        throw new RuntimeError("THEME_VERIFY_FAILED", "Theme verification failed");
      }
    } catch (error) {
      throw runtimeFailure(error);
    }
  }

  async cleanup(session: RuntimePageSession): Promise<void> {
    try {
      await session.adapter.remove();
      const official = await session.adapter.verifyOfficialAppearance();
      if (!official.valid) {
        throw new RuntimeError("THEME_CLEANUP_FAILED", "Official appearance is unverified");
      }
    } catch (error) {
      throw runtimeFailure(error);
    }
  }
}
