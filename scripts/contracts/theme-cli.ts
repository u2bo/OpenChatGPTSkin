import {
  OCSKIN_MAX_ARCHIVE_BYTES,
  OCSKIN_MAX_EXPANDED_BYTES,
  THEME_MAX_FONT_BYTES,
  THEME_MAX_IMAGE_BYTES,
  THEME_MAX_PACKAGE_BYTES,
  THEME_MAX_PREVIEW_BYTES,
} from "../../packages/theme-core/src/index.js";
import {
  THEME_SCHEMA_ERROR_CODES,
  THEME_SCHEMA_VERSION,
} from "../../packages/theme-schema/src/index.js";

export const THEME_CLI_PROTOCOL_VERSION = 1 as const;
export const THEME_CLI_CONTRACT_VERSION = 1 as const;
export const THEME_CLI_MAX_JSON_BYTES = 1024 * 1024;

const THEME_CLI_COMMAND_ERROR_CODES = [
  "CLI_ARGUMENT_INVALID",
  "CLI_READ",
  "CLI_WRITE",
  "THEME_NOT_FOUND",
  "STUDIO_IMPORT_INVALID",
  "ASSET_UNSUPPORTED",
  "ASSET_SIGNATURE_INVALID",
  "THEME_PATCH_INVALID",
  "PACKAGE_TOO_LARGE",
  "PACKAGE_EXPANDED_TOO_LARGE",
  "ARCHIVE_ENTRY_UNSAFE",
  "ARCHIVE_ENTRY_DUPLICATE",
  "ARCHIVE_ENTRY_UNSUPPORTED",
  "ARCHIVE_ENTRY_TOO_LARGE",
  "ARCHIVE_REQUIRED_FILE_MISSING",
  "ARCHIVE_MANIFEST_INVALID",
  "ARCHIVE_MANIFEST_MISMATCH",
  "ARCHIVE_HASH_MISMATCH",
  "ARCHIVE_IDENTITY_MISMATCH",
] as const;

export function buildThemeCLIContract(
  themeSchema: unknown,
  draftSchema: unknown,
  archive: unknown,
) {
  return {
    contractVersion: THEME_CLI_CONTRACT_VERSION,
    role: "theme",
    protocolVersion: THEME_CLI_PROTOCOL_VERSION,
    themeSchemaVersion: THEME_SCHEMA_VERSION,
    commands: {
      contract: "contract",
      create: "create --dir <path> --id <id> --name <name> --author <author> [--version <semver>] [--appearance <auto|light|dark>] [--background <file>]",
      config: "config --dir <path> --patch <json-file>",
      show: "show --dir <path>",
      validate: "validate --dir <path> [--draft]",
      pack: "pack --dir <path> --out <file.ocskin>",
      unpack: "unpack --file <file.ocskin> --out <path>",
    },
    limits: {
      themeJsonBytes: THEME_CLI_MAX_JSON_BYTES,
      archiveBytes: OCSKIN_MAX_ARCHIVE_BYTES,
      expandedBytes: OCSKIN_MAX_EXPANDED_BYTES,
      packageBytes: THEME_MAX_PACKAGE_BYTES,
      imageBytes: THEME_MAX_IMAGE_BYTES,
      fontBytes: THEME_MAX_FONT_BYTES,
      previewBytes: THEME_MAX_PREVIEW_BYTES,
    },
    exitCodes: { success: 0, failure: 1, usage: 2 },
    output: {
      success: { stream: "stdout", values: 1, format: "json" },
      failure: {
        stream: "stderr",
        values: 1,
        format: "json",
        shape: { error: { code: "string", message: "string" } },
      },
    },
    errorCodes: [
      ...THEME_CLI_COMMAND_ERROR_CODES,
      ...THEME_SCHEMA_ERROR_CODES,
      "INTERNAL",
    ],
    themeSchema,
    draftSchema,
    archive,
  } as const;
}
