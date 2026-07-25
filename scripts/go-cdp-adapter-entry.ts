import { compileTheme } from "../packages/cdp-adapter/src/compiler.js";
import {
  applyExpression,
  preflightExpression,
  REMOVE_EXPRESSION,
  VERIFY_EXPRESSION,
  VERIFY_OFFICIAL_EXPRESSION,
} from "../packages/cdp-adapter/src/scripts.js";

declare const Buffer: {
  byteLength(value: string): number;
  from(value: Uint8Array): { toString(encoding: "base64"): string };
};

interface StagedTheme {
  readonly theme: unknown;
  readonly totalBytes: number;
  readonly files: Map<string, string>;
}

let staged: StagedTheme | undefined;
const compiledThemeKey = "__openChatGPTSkinCompiledTheme";
const compiledThemeReference = `globalThis[${JSON.stringify(compiledThemeKey)}]`;
type BrowserCompiledTheme = ReturnType<typeof compileTheme>;

function installBrowserBuffer(): void {
  const global = globalThis as typeof globalThis & {
    Buffer?: { byteLength(value: string): number; from(value: Uint8Array): { toString(encoding: string): string } };
  };
  if (global.Buffer) return;
  global.Buffer = {
    byteLength: (value) => new TextEncoder().encode(value).byteLength,
    from: (value) => ({
      toString: (encoding: string) => {
        if (encoding !== "base64") throw new Error("unsupported browser buffer encoding");
        let binary = "";
        for (const byte of value) binary += String.fromCharCode(byte);
        return btoa(binary);
      },
    }),
  };
}

function decodeBase64(value: string): Uint8Array {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("staged theme asset is not base64");
  }
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function requiredStage(): StagedTheme {
  if (!staged) throw new Error("no theme is staged");
  return staged;
}

function compileStagedTheme(): BrowserCompiledTheme {
  const value = requiredStage();
  if (!Number.isInteger(value.totalBytes) || value.totalBytes < 1 || value.totalBytes > 32 * 1024 * 1024) {
    throw new Error("staged theme size is invalid");
  }
  return compileTheme({
    theme: value.theme as never,
    files: new Map([...value.files].map(([path, contents]) => [path, decodeBase64(contents)])),
    totalBytes: value.totalBytes,
  });
}

function adapterGlobal(): typeof globalThis & Record<string, unknown> {
  return globalThis as typeof globalThis & Record<string, unknown>;
}

function clearCompiledTheme(): void {
  delete adapterGlobal()[compiledThemeKey];
}

function storeCompiledTheme(theme: BrowserCompiledTheme): void {
  clearCompiledTheme();
  Object.defineProperty(globalThis, compiledThemeKey, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: theme,
  });
}

function requiredCompiledTheme(): BrowserCompiledTheme {
  const theme = adapterGlobal()[compiledThemeKey];
  if (!theme || typeof theme !== "object") throw new Error("no compiled theme is prepared");
  return theme as BrowserCompiledTheme;
}

function validVerification(value: Record<string, unknown>): boolean {
  return value.themeMarkers === 1 && value.welcomeValid === true &&
    value.requiredLayersResolved === true && value.fontMarkers !== undefined &&
    typeof value.fontMarkers === "number" && value.fontMarkers <= 1 &&
    value.decorationMarkers === 1 && value.decorationPointerEvents === "none" &&
    typeof value.surfaceMarkers === "number" && value.surfaceMarkers >= 3 &&
    value.mainSurfaceReady === true && value.sidebarSurfaceReady === true &&
    value.composerSurfaceReady === true && value.composerWithinViewport === true &&
    value.horizontalOverflow === false && value.mainVisible === true &&
    value.composerVisible === true && value.reviewShadowReady === true &&
    value.backgroundReady === true;
}

function validOfficialAppearance(value: Record<string, unknown>): boolean {
  return value.managedMarkers === 0 && value.horizontalOverflow === false &&
    value.mainVisible === true && value.navigationVisible === true && value.composerVisible === true;
}

installBrowserBuffer();

if (!Object.prototype.hasOwnProperty.call(globalThis, "__openChatGPTSkinAdapter")) {
  Object.defineProperty(globalThis, "__openChatGPTSkinAdapter", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
    begin(theme: unknown, totalBytes: number) {
      clearCompiledTheme();
      staged = { theme, totalBytes, files: new Map() };
      return true;
    },
    append(path: string, chunk: string) {
      if (!/^(?:assets\/)?[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$/.test(path) || path.includes("..") ||
        typeof chunk !== "string") throw new Error("staged theme asset path is invalid");
      const current = requiredStage();
      const next = (current.files.get(path) ?? "") + chunk;
      if (next.length > 24 * 1024 * 1024) throw new Error("staged theme asset is too large");
      current.files.set(path, next);
      return true;
    },
      prepareApply: () => {
        storeCompiledTheme(compileStagedTheme());
        staged = undefined;
        return true;
      },
      source: (name: string) => {
        switch (name) {
          case "preflight":
            return preflightExpression(requiredCompiledTheme(), compiledThemeReference);
          case "apply":
            return applyExpression(requiredCompiledTheme(), compiledThemeReference);
          case "verify":
            return VERIFY_EXPRESSION;
          case "remove":
            return REMOVE_EXPRESSION;
          case "verifyOfficial":
            return VERIFY_OFFICIAL_EXPRESSION;
          default:
            throw new Error("unknown Adapter expression");
        }
      },
      validatePreflight: (value: Record<string, unknown>) =>
        value?.valid === true && value.requiredLayersResolved === true,
      validateVerification: (value: Record<string, unknown>) => {
        const valid = validVerification(value);
        if (valid) clearCompiledTheme();
        return valid;
      },
      validateRestore: (removed: unknown, value: Record<string, unknown>) => {
        const valid = removed === 0 && validOfficialAppearance(value);
        clearCompiledTheme();
        staged = undefined;
        return valid;
      },
    }),
  });
}

true;
