export function derivedBuiltinThemeId(
  personalThemeId: string,
  builtinThemeIds: readonly string[],
): string | null {
  for (const builtinId of [...builtinThemeIds].sort((left, right) => right.length - left.length)) {
    const stableId = `${builtinId}-custom`;
    if (personalThemeId === stableId) return builtinId;
    if (!personalThemeId.startsWith(`${stableId}-`)) continue;
    const legacySuffix = personalThemeId.slice(stableId.length + 1);
    if (/^[0-9a-f]{6}$/i.test(legacySuffix)) return builtinId;
  }
  return null;
}

export function personalThemeGroupKey(
  personalThemeId: string,
  builtinThemeIds: readonly string[],
): string {
  const builtinId = derivedBuiltinThemeId(personalThemeId, builtinThemeIds);
  return builtinId ? `builtin:${builtinId}` : `personal:${personalThemeId}`;
}
