#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import {
  createOcskinFiles,
  OCSKIN_MAX_ARCHIVE_BYTES,
  packTheme,
  unpackTheme,
} from "./archive.js";
import { loadThemeCatalog } from "./catalog.js";
import { loadThemeDirectory, ThemeDirectoryError } from "./directory.js";
import { ThemeValidationError } from "./errors.js";
import type { ValidatedThemeBundle } from "./types.js";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

class CliUsageError extends Error {}
class CliWriteError extends Error {}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new CliUsageError(`Missing required option: --${flag}`);
  return resolve(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWriteNewFile(path: string, bytes: Uint8Array): Promise<void> {
  if (await pathExists(path)) throw new CliWriteError(`Destination already exists: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  try {
    await link(temporary, path);
  } catch (error) {
    await unlink(temporary);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CliWriteError(`Destination already exists: ${path}`);
    }
    throw error;
  }
  await unlink(temporary);
}

async function readArchive(path: string): Promise<Uint8Array> {
  const info = await stat(path);
  if (!info.isFile()) throw new CliWriteError(`Archive is not a file: ${path}`);
  if (info.size > OCSKIN_MAX_ARCHIVE_BYTES) {
    throw new ThemeValidationError("PACKAGE_TOO_LARGE", "archive exceeds 32 MB");
  }
  return readFile(path);
}

async function writeBundleDirectory(
  directory: string,
  bundle: ValidatedThemeBundle,
): Promise<void> {
  if (await pathExists(directory)) {
    throw new CliWriteError(`Destination already exists: ${directory}`);
  }
  await mkdir(dirname(directory), { recursive: true });
  const staging = `${directory}.staging-${process.pid}-${randomUUID()}`;
  await mkdir(staging, { recursive: false });
  for (const [name, bytes] of createOcskinFiles(bundle)) {
    const target = join(staging, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await rename(staging, directory);
}

function classifyError(error: unknown): {
  readonly exitCode: number;
  readonly code: string;
  readonly message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const systemCode = (error as NodeJS.ErrnoException).code ?? "";
  if (error instanceof CliUsageError || systemCode.startsWith("ERR_PARSE_ARGS")) {
    return { exitCode: 64, code: "CLI_USAGE", message };
  }
  if (error instanceof ThemeValidationError) {
    return { exitCode: 65, code: error.code, message };
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return { exitCode: 65, code: "INPUT_INVALID", message };
  }
  if (error instanceof CliWriteError || error instanceof ThemeDirectoryError) {
    return { exitCode: 73, code: "CLI_WRITE", message };
  }
  if (["EACCES", "EPERM", "EEXIST", "ENOENT", "ENOTDIR", "ENOTEMPTY"].includes(systemCode)) {
    return { exitCode: 73, code: `FS_${systemCode}`, message };
  }
  return { exitCode: 70, code: "INTERNAL_ERROR", message };
}

export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === "catalog") {
      const parsed = parseArgs({
        args: rest,
        options: { root: { type: "string" } },
        allowPositionals: false,
      });
      const catalog = await loadThemeCatalog(resolve(parsed.values.root ?? "themes"));
      io.stdout(`${JSON.stringify(catalog, null, 2)}\n`);
      return 0;
    }

    if (command === "validate") {
      const parsed = parseArgs({
        args: rest,
        options: { dir: { type: "string" } },
        allowPositionals: false,
      });
      const bundle = await loadThemeDirectory(required(parsed.values.dir, "dir"));
      io.stdout(`${JSON.stringify({
        valid: true,
        id: bundle.theme.id,
        version: bundle.theme.version,
        totalBytes: bundle.totalBytes,
      })}\n`);
      return 0;
    }

    if (command === "pack") {
      const parsed = parseArgs({
        args: rest,
        options: {
          dir: { type: "string" },
          out: { type: "string" },
        },
        allowPositionals: false,
      });
      const bundle = await loadThemeDirectory(required(parsed.values.dir, "dir"));
      const output = required(parsed.values.out, "out");
      await atomicWriteNewFile(output, packTheme(bundle));
      io.stdout(`${JSON.stringify({ packed: true, output, id: bundle.theme.id })}\n`);
      return 0;
    }

    if (command === "unpack") {
      const parsed = parseArgs({
        args: rest,
        options: {
          file: { type: "string" },
          out: { type: "string" },
        },
        allowPositionals: false,
      });
      const input = required(parsed.values.file, "file");
      const output = required(parsed.values.out, "out");
      const bundle = await unpackTheme(await readArchive(input));
      await writeBundleDirectory(output, bundle);
      io.stdout(`${JSON.stringify({ unpacked: true, output, id: bundle.theme.id })}\n`);
      return 0;
    }

    throw new CliUsageError(`Unknown command: ${command ?? ""}`);
  } catch (error) {
    const failure = classifyError(error);
    io.stderr(`${JSON.stringify({ error: { code: failure.code, message: failure.message } })}\n`);
    return failure.exitCode;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  });
}
