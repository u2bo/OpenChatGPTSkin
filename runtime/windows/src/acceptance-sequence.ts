import {
  RUNTIME_BUILTIN_THEME_IDS,
  type RuntimeBuiltinThemeId,
} from "./themes/ids.js";

function buildDirectedSwitchCycle(
  themeIds: readonly RuntimeBuiltinThemeId[],
): readonly (readonly [RuntimeBuiltinThemeId, RuntimeBuiltinThemeId])[] {
  const remaining = new Map(themeIds.map((source) => [
    source,
    themeIds.filter((target) => target !== source),
  ]));
  const stack: RuntimeBuiltinThemeId[] = [themeIds[0]!];
  const circuit: RuntimeBuiltinThemeId[] = [];
  while (stack.length > 0) {
    const source = stack.at(-1)!;
    const target = remaining.get(source)!.shift();
    if (target) stack.push(target);
    else circuit.push(stack.pop()!);
  }
  const path = circuit.reverse();
  return path.slice(0, -1).map((source, index) => [
    source,
    path[index + 1]!,
  ] as const);
}

export const ACCEPTANCE_SWITCH_EDGES = buildDirectedSwitchCycle(
  RUNTIME_BUILTIN_THEME_IDS,
);
