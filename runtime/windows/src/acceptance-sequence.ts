import type { RuntimeBuiltinThemeId } from "./themes/ids.js";

export const ACCEPTANCE_SWITCH_EDGES = [
  ["future-idol-cyan", "rose-carpet-star"],
  ["rose-carpet-star", "future-idol-cyan"],
  ["future-idol-cyan", "mountain-mist"],
  ["mountain-mist", "future-idol-cyan"],
  ["future-idol-cyan", "glacier-aurora"],
  ["glacier-aurora", "rose-carpet-star"],
  ["rose-carpet-star", "mountain-mist"],
  ["mountain-mist", "rose-carpet-star"],
  ["rose-carpet-star", "glacier-aurora"],
  ["glacier-aurora", "mountain-mist"],
  ["mountain-mist", "glacier-aurora"],
  ["glacier-aurora", "future-idol-cyan"],
] as const satisfies readonly (readonly [RuntimeBuiltinThemeId, RuntimeBuiltinThemeId])[];
