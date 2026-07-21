import {
  access,
  rm,
} from "node:fs/promises";

export async function assertPathMissing(
  path: string,
  label: string,
): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists: ${path}`);
}

export async function rethrowAfterRemoving(
  path: string,
  failure: unknown,
  message: string,
  recursive = false,
): Promise<never> {
  try {
    await rm(path, { recursive, force: true });
  } catch (cleanupError) {
    throw new AggregateError([failure, cleanupError], message);
  }
  throw failure;
}
