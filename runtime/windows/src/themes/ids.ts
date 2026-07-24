import { z } from "zod";

export const RUNTIME_BUILTIN_THEME_IDS = [
  "future-idol-cyan",
  "rose-carpet-star",
  "mountain-mist",
  "glacier-aurora",
  "yua-mikami-starlight",
] as const;

export const RuntimeBuiltinThemeIdSchema = z.enum(RUNTIME_BUILTIN_THEME_IDS);
export type RuntimeBuiltinThemeId = z.infer<typeof RuntimeBuiltinThemeIdSchema>;
