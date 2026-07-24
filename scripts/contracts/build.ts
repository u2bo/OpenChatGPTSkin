import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  STUDIO_ERROR_HTTP_STATUS,
  STUDIO_BODY_LIMITS,
  STUDIO_HTTP_SEMANTIC_CASES,
  STUDIO_PROTOCOL_VERSION,
  STUDIO_ROUTE_DEFINITIONS,
  STUDIO_SECURITY_HEADERS,
  STUDIO_RESPONSE_POLICIES,
  StudioApplyResultSchema,
  StudioBootstrapSchema,
  StudioCreateDraftInputSchema,
  StudioDeleteThemeInputSchema,
  StudioDraftCommandInputSchema,
  StudioDraftSchema,
  StudioEventSchema,
  StudioExportedThemeSchema,
  StudioImportThemeInputSchema,
  StudioRuntimeStatusSchema,
  StudioSaveResultSchema,
  StudioSessionExchangeSchema,
  StudioThemeLibrarySchema,
  StudioThemeRefSchema,
  StudioUpdateDraftInputSchema,
  StudioUploadAssetInputSchema,
} from "../../packages/theme-studio-core/src/index.js";
import {
  OCSKIN_ARCHIVE_SEMANTIC_CASES,
  OCSKIN_MAX_ARCHIVE_BYTES,
  OCSKIN_MAX_EXPANDED_BYTES,
  OcskinManifestSchema,
  ThemeRefSchema,
  ThemeStateSchema,
} from "../../packages/theme-core/src/index.js";
import {
  THEME_MIGRATION_CONTRACT,
  THEME_SCHEMA_ERROR_CODES,
  THEME_SCHEMA_VERSION,
  THEME_SEMANTIC_CASES,
  ThemeDocumentSchema,
  ThemeDocumentV2Schema,
  ThemeDocumentV3FieldsSchema,
  ThemeDocumentV4InputFieldsSchema,
  ThemeDraftDocumentSchema,
  LegacyThemeDocumentSchema,
} from "../../packages/theme-schema/src/index.js";
import {
  ControlErrorSchema,
  ControlRequestSchema,
  ControlResponseSchema,
  ControllerLockRecordSchema,
  RecentRequestSchema,
  RUNTIME_CONTROL_CONTRACT,
  RUNTIME_CONTROL_SEMANTIC_CASES,
  RUNTIME_RECOVERY_SEMANTIC_CASES,
  RUNTIME_STATE_TRANSITIONS,
  RuntimeSessionStateSchema,
  RuntimeStatusViewSchema,
  TrustedCodexInstallSchema,
} from "../../runtime/windows/src/index.js";
import {
  DraftRecordSchema,
  PersistedDraftRecordSchema,
} from "../../runtime/theme-studio-service/src/workspace.js";
import { ReleaseManifestSchema } from "../release/payload.js";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const GENERATED_FILES = [
  "data/v1/cases/compatibility.json",
  "data/v1/schemas/index.json",
  "runtime/v1/cases/semantics.json",
  "runtime/v1/frames.json",
  "runtime/v1/schemas/index.json",
  "studio/v2/cases/http.json",
  "studio/v2/routes.json",
  "studio/v2/schemas/index.json",
  "theme/v4/archive-cases.json",
  "theme/v4/draft-schema.json",
  "theme/v4/migrations.json",
  "theme/v4/schema.json",
  "theme/v4/semantic-cases.json",
] as const;

const GENERATED_ROOTS = ["studio/v2", "runtime/v1", "theme/v4", "data/v1"] as const;

const DATA_COMPATIBILITY_CASES = [
  { name: "draft v1", valid: true, schema: "draftRecord", version: 1 },
  { name: "theme store v1", valid: true, schema: "themeStore", version: 1 },
  { name: "runtime state v2", valid: true, schema: "runtimeState", version: 2 },
  { name: "trusted install cache v1", valid: true, schema: "trustedInstall", version: 1 },
  { name: "controller lock v1", valid: true, schema: "controllerLock", version: 1 },
  { name: "release manifest v1", valid: true, schema: "releaseManifest", version: 1 },
  { name: "unknown draft version", valid: false, schema: "draftRecord", expectedErrorCode: "DATA_SCHEMA_INVALID", expectedPath: "/schemaVersion" },
  { name: "dirty draft without history", valid: false, schema: "draftRecord", expectedErrorCode: "DATA_SCHEMA_INVALID", expectedPath: "/past" },
  { name: "runtime request ID mismatch", valid: false, schema: "runtimeState", expectedErrorCode: "RUNTIME_INVALID_STATE", expectedPath: "/recentRequests/0/requestId" },
  { name: "trusted cache identity mismatch", valid: false, schema: "trustedInstall", expectedErrorCode: "CODEX_IDENTITY_INVALID", expectedPath: "/packagePublisher" },
  { name: "lock without process identity", valid: false, schema: "controllerLock", expectedErrorCode: "RUNTIME_SESSION_STALE", expectedPath: "/startedAt" },
  { name: "release file hash malformed", valid: false, schema: "releaseManifest", expectedErrorCode: "RELEASE_MANIFEST_INVALID", expectedPath: "/files/sha256" },
] as const;

function portable(path: string): string {
  return path.split(sep).join("/");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, entry]) => [key, stable(entry)]));
}

function json(value: unknown): string {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function schema(value: ZodTypeAny, name: string): unknown {
  return zodToJsonSchema(value, {
    name,
    target: "jsonSchema7",
    $refStrategy: "none",
    errorMessages: true,
  });
}

function schemaIndex(
  version: number,
  values: Readonly<Record<string, ZodTypeAny>>,
): unknown {
  return {
    schemaVersion: version,
    schemas: Object.fromEntries(Object.entries(values).map(([name, value]) => [
      name,
      schema(value, name),
    ])),
  };
}

async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  const destination = join(root, ...path.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, json(value), "utf8");
}

async function walk(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await walk(root, path));
    else if (entry.isFile()) result.push(portable(relative(root, path)));
  }
  return result.sort();
}

export async function buildContracts(
  workspaceRootInput: string,
  outputRootInput = join(workspaceRootInput, "contracts"),
): Promise<void> {
  const workspaceRoot = resolve(workspaceRootInput);
  const outputRoot = resolve(outputRootInput);
  await readFile(join(workspaceRoot, "package.json"), "utf8");
  for (const root of GENERATED_ROOTS) {
    await rm(join(outputRoot, ...root.split("/")), { recursive: true, force: true });
  }

  await Promise.all([
    writeJson(outputRoot, "studio/v2/routes.json", {
      protocolVersion: STUDIO_PROTOCOL_VERSION,
      securityHeaders: STUDIO_SECURITY_HEADERS,
      bodyLimits: STUDIO_BODY_LIMITS,
      responsePolicies: STUDIO_RESPONSE_POLICIES,
      errorStatus: STUDIO_ERROR_HTTP_STATUS,
      routes: STUDIO_ROUTE_DEFINITIONS,
    }),
    writeJson(outputRoot, "studio/v2/schemas/index.json", schemaIndex(2, {
      sessionExchange: StudioSessionExchangeSchema,
      themeRef: StudioThemeRefSchema,
      runtimeStatus: StudioRuntimeStatusSchema,
      bootstrap: StudioBootstrapSchema,
      themeLibrary: StudioThemeLibrarySchema,
      draft: StudioDraftSchema,
      createDraft: StudioCreateDraftInputSchema,
      updateDraft: StudioUpdateDraftInputSchema,
      draftCommand: StudioDraftCommandInputSchema,
      deleteTheme: StudioDeleteThemeInputSchema,
      uploadAsset: StudioUploadAssetInputSchema,
      importTheme: StudioImportThemeInputSchema,
      exportedTheme: StudioExportedThemeSchema,
      saveResult: StudioSaveResultSchema,
      applyResult: StudioApplyResultSchema,
      event: StudioEventSchema,
    })),
    writeJson(outputRoot, "studio/v2/cases/http.json", {
      protocolVersion: STUDIO_PROTOCOL_VERSION,
      cases: STUDIO_HTTP_SEMANTIC_CASES,
    }),
    writeJson(outputRoot, "runtime/v1/frames.json", RUNTIME_CONTROL_CONTRACT),
    writeJson(outputRoot, "runtime/v1/schemas/index.json", schemaIndex(1, {
      request: ControlRequestSchema,
      response: ControlResponseSchema,
      status: RuntimeStatusViewSchema,
      error: ControlErrorSchema,
    })),
    writeJson(outputRoot, "runtime/v1/cases/semantics.json", {
      protocolVersion: RUNTIME_CONTROL_CONTRACT.protocolVersion,
      cases: RUNTIME_CONTROL_SEMANTIC_CASES,
      recoveryCases: RUNTIME_RECOVERY_SEMANTIC_CASES,
      stateTransitions: RUNTIME_STATE_TRANSITIONS,
    }),
    writeJson(outputRoot, "theme/v4/schema.json", {
      schemaVersion: THEME_SCHEMA_VERSION,
      errorCodes: THEME_SCHEMA_ERROR_CODES,
      schema: schema(ThemeDocumentSchema, "ThemeDocument"),
    }),
    writeJson(outputRoot, "theme/v4/draft-schema.json", {
      schemaVersion: THEME_SCHEMA_VERSION,
      schema: schema(ThemeDraftDocumentSchema, "ThemeDraftDocument"),
    }),
    writeJson(outputRoot, "theme/v4/migrations.json", {
      ...THEME_MIGRATION_CONTRACT,
      sourceSchemas: {
        v1: schema(LegacyThemeDocumentSchema, "ThemeDocumentV1"),
        v2: schema(ThemeDocumentV2Schema, "ThemeDocumentV2"),
        v3: schema(ThemeDocumentV3FieldsSchema, "ThemeDocumentV3"),
        v4: schema(ThemeDocumentV4InputFieldsSchema, "ThemeDocumentV4Input"),
      },
    }),
    writeJson(outputRoot, "theme/v4/semantic-cases.json", {
      schemaVersion: THEME_SCHEMA_VERSION,
      cases: THEME_SEMANTIC_CASES,
    }),
    writeJson(outputRoot, "theme/v4/archive-cases.json", {
      schemaVersion: 1,
      limits: {
        archiveBytes: OCSKIN_MAX_ARCHIVE_BYTES,
        expandedBytes: OCSKIN_MAX_EXPANDED_BYTES,
      },
      manifestSchema: schema(OcskinManifestSchema, "OcskinManifest"),
      cases: OCSKIN_ARCHIVE_SEMANTIC_CASES,
    }),
    writeJson(outputRoot, "data/v1/schemas/index.json", schemaIndex(1, {
      draftRecord: DraftRecordSchema,
      persistedDraftRecord: PersistedDraftRecordSchema,
      themeRef: ThemeRefSchema,
      themeStore: ThemeStateSchema,
      runtimeState: RuntimeSessionStateSchema,
      recentRuntimeRequest: RecentRequestSchema,
      trustedInstall: TrustedCodexInstallSchema,
      controllerLock: ControllerLockRecordSchema,
      releaseManifest: ReleaseManifestSchema,
    })),
    writeJson(outputRoot, "data/v1/cases/compatibility.json", {
      schemaVersion: 1,
      cases: DATA_COMPATIBILITY_CASES,
    }),
  ]);
}

export async function verifyGeneratedContracts(
  workspaceRootInput: string,
): Promise<{ readonly fileCount: 13; readonly verified: true }> {
  const workspaceRoot = resolve(workspaceRootInput);
  const expectedRoot = join(workspaceRoot, "contracts");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openchatgptskin-contracts-"));
  try {
    await buildContracts(workspaceRoot, temporaryRoot);
    const actualFiles = (await Promise.all(GENERATED_ROOTS.map(async (root) => {
      const directory = join(expectedRoot, ...root.split("/"));
      try {
        return (await walk(directory)).map((path) => `${root}/${path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    }))).flat().sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(GENERATED_FILES)) {
      throw new Error("Checked-in contract file list is stale; run npm run contracts:build");
    }
    for (const path of GENERATED_FILES) {
      const [expected, generated] = await Promise.all([
        readFile(join(expectedRoot, ...path.split("/"))),
        readFile(join(temporaryRoot, ...path.split("/"))),
      ]);
      if (!expected.equals(generated)) {
        throw new Error(`Checked-in contract is stale: ${path}`);
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return { fileCount: 13, verified: true };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  await buildContracts(process.cwd());
  process.stdout.write(`${json({ fileCount: GENERATED_FILES.length, generated: true })}`);
}
