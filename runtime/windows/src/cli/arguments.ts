import { RuntimeError } from "../errors.js";
import {
  ThemeIdSchema,
  ThemeVersionSchema,
} from "@open-chatgpt-skin/theme-schema";
import {
  RuntimeBuiltinThemeIdSchema,
} from "../themes/ids.js";

export type RuntimeCliCommand =
  | { readonly kind: "list-themes" }
  | { readonly kind: "import"; readonly themeFile: string }
  | { readonly kind: "launch"; readonly themeId: string; readonly themeVersion?: string }
  | { readonly kind: "status" }
  | { readonly kind: "switch"; readonly themeId: string; readonly themeVersion?: string }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "restore" }
  | { readonly kind: "serve"; readonly mode: "new" | "recover"; readonly startupId: string };

type PublicRuntimeCliCommand = Exclude<RuntimeCliCommand, { readonly kind: "serve" }>;

function usageError(): RuntimeError {
  return new RuntimeError(
    "RUNTIME_ENVIRONMENT_INVALID",
    "Runtime accepts only fixed public command forms",
  );
}

function parseThemeCommand(
  kind: "launch" | "switch",
  args: readonly string[],
): PublicRuntimeCliCommand {
  if (args.length === 3 && args[1] === "--theme") {
    const themeId = RuntimeBuiltinThemeIdSchema.safeParse(args[2]);
    if (!themeId.success) throw usageError();
    return { kind, themeId: themeId.data };
  }
  if (args.length === 5 && args[1] === "--theme" && args[3] === "--version") {
    const themeId = ThemeIdSchema.safeParse(args[2]);
    const themeVersion = ThemeVersionSchema.safeParse(args[4]);
    if (!themeId.success || !themeVersion.success) throw usageError();
    return { kind, themeId: themeId.data, themeVersion: themeVersion.data };
  }
  throw usageError();
}

function parsePublicArguments(args: readonly string[]): PublicRuntimeCliCommand {
  if (args.length === 1 && args[0] === "list-themes") return { kind: "list-themes" };
  if (args.length === 3 && args[0] === "import" && args[1] === "--theme-file" &&
    args[2] && args[2].length <= 4096 && !args[2].includes("\0")) {
    return { kind: "import", themeFile: args[2] };
  }
  if (args.length === 1 && args[0] === "status") return { kind: "status" };
  if (args.length === 1 && args[0] === "pause") return { kind: "pause" };
  if (args.length === 1 && args[0] === "resume") return { kind: "resume" };
  if (args.length === 1 && args[0] === "restore") return { kind: "restore" };
  if (args[0] === "launch") return parseThemeCommand("launch", args);
  if (args[0] === "switch") return parseThemeCommand("switch", args);
  throw usageError();
}

export function parseRuntimeArguments(args: readonly string[]): PublicRuntimeCliCommand {
  return parsePublicArguments(args);
}

export function parseInternalRuntimeArguments(args: readonly string[]): RuntimeCliCommand {
  if (args[0] !== "serve") return parsePublicArguments(args);
  if (args.length !== 5 || args[1] !== "--mode" ||
    (args[2] !== "new" && args[2] !== "recover") || args[3] !== "--startup-id" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args[4]!)) {
    throw usageError();
  }
  return { kind: "serve", mode: args[2], startupId: args[4]! };
}
