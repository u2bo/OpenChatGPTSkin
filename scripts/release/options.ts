export function releaseOption(
  args: readonly string[],
  name: string,
): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Release option requires a value: ${name}`);
  }
  return value;
}

export function requiredReleaseOption(
  args: readonly string[],
  name: string,
): string {
  const value = releaseOption(args, name);
  if (!value) throw new Error(`Release option is required: ${name}`);
  return value;
}
