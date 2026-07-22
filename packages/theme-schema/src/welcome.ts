import type { ThemeLocale } from "./theme.js";

export type WelcomeToken =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "projectName" };

export type CompiledWelcomeLine = readonly WelcomeToken[];

export interface WelcomeContext {
  readonly locale: ThemeLocale;
  readonly projectName?: string;
}

export type ResolvedWelcome =
  | { readonly kind: "native" }
  | { readonly kind: "custom"; readonly lines: readonly string[] };

const PROJECT_TOKEN = "{projectName}";

export function compileWelcomeLines(
  lines: readonly string[],
): readonly CompiledWelcomeLine[] {
  return lines.map((line) => line.split(PROJECT_TOKEN).flatMap((part, index, parts) => [
    ...(part ? [{ kind: "text" as const, value: part }] : []),
    ...(index < parts.length - 1 ? [{ kind: "projectName" as const }] : []),
  ]));
}

export function resolveHomeWelcome(
  localized: Readonly<Partial<Record<
    ThemeLocale,
    readonly CompiledWelcomeLine[]
  >>> | undefined,
  context: WelcomeContext,
): ResolvedWelcome {
  const lines = localized?.[context.locale];
  if (!lines) return { kind: "native" };

  const projectName = context.projectName?.trim();
  const needsProjectName = lines.some((line) =>
    line.some((token) => token.kind === "projectName")
  );
  if (needsProjectName && !projectName) return { kind: "native" };

  return {
    kind: "custom",
    lines: lines.map((line) => line.map((token) =>
      token.kind === "text" ? token.value : projectName!
    ).join("")),
  };
}
