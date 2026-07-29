#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { CommunityCatalogValidationError } from "./errors.js";
import {
  parseCommunityCatalogTrustPolicy,
  serializeCommunityCatalog,
  validateCommunityCatalog,
} from "./validation.js";

export interface CommunityCatalogCliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

class CliUsageError extends Error {}
class CliWriteError extends Error {}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new CliUsageError(`Missing required option: --${flag}`);
  return value;
}

async function atomicWriteNewFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CliWriteError(`Destination already exists: ${path}`);
    }
    throw error;
  } finally {
    await unlink(temporary);
  }
}

function classifyError(error: unknown): {
  readonly exitCode: number;
  readonly code: string;
  readonly message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const systemCode = (error as NodeJS.ErrnoException).code ?? "";
  if (error instanceof CliUsageError || error instanceof ZodError ||
      systemCode.startsWith("ERR_PARSE_ARGS")) {
    return { exitCode: 64, code: "CLI_USAGE", message };
  }
  if (error instanceof CommunityCatalogValidationError || error instanceof SyntaxError) {
    return { exitCode: 65, code: "COMMUNITY_CATALOG_INVALID", message };
  }
  if (error instanceof CliWriteError ||
      ["EACCES", "EPERM", "EEXIST", "ENOENT", "ENOTDIR"].includes(systemCode)) {
    return { exitCode: 73, code: "CLI_WRITE", message };
  }
  return { exitCode: 70, code: "INTERNAL_ERROR", message };
}

export async function runCommunityCatalogCli(
  args: readonly string[],
  io: CommunityCatalogCliIo,
): Promise<number> {
  try {
    const [command, ...rest] = args;
    if (command !== "validate" && command !== "canonicalize") {
      throw new CliUsageError(`Unknown command: ${command ?? ""}`);
    }
    const commonOptions = {
      file: { type: "string" },
      "release-repository": { type: "string" },
      "site-origin": { type: "string" },
    } as const;
    const parsed = parseArgs({
      args: rest,
      allowPositionals: false,
      options: { ...commonOptions, out: { type: "string" } as const },
    });
    if (command === "validate" && parsed.values.out !== undefined) {
      throw new CliUsageError("Option --out is only valid for canonicalize");
    }
    const file = resolve(required(parsed.values.file, "file"));
    const out = command === "canonicalize"
      ? resolve(required(parsed.values.out, "out"))
      : undefined;
    const policy = parseCommunityCatalogTrustPolicy({
      releaseRepository: required(parsed.values["release-repository"], "release-repository"),
      siteOrigin: required(parsed.values["site-origin"], "site-origin"),
    });
    const catalog = validateCommunityCatalog(
      JSON.parse(await readFile(file, "utf8")),
      policy,
    );
    if (out !== undefined) {
      await atomicWriteNewFile(out, serializeCommunityCatalog(catalog));
      io.stdout(`${JSON.stringify({ canonicalized: true, output: out })}\n`);
      return 0;
    }
    const versionCount = catalog.themes.reduce(
      (total, theme) => total + theme.versions.length,
      0,
    );
    io.stdout(`${JSON.stringify({
      valid: true,
      schemaVersion: catalog.schemaVersion,
      catalogRevision: catalog.catalogRevision,
      themeCount: catalog.themes.length,
      versionCount,
    })}\n`);
    return 0;
  } catch (error) {
    const failure = classifyError(error);
    io.stderr(`${JSON.stringify({ error: {
      code: failure.code,
      message: failure.message,
    } })}\n`);
    return failure.exitCode;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCommunityCatalogCli(process.argv.slice(2), {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  });
}
