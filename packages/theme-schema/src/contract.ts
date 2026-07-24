import {
  DEFAULT_THEME_INTERFACE_IMAGES,
  DEFAULT_THEME_SURFACES,
} from "./theme.js";

export const THEME_SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4] as const;

export const THEME_MIGRATION_CONTRACT = {
  targetVersion: 4,
  sources: [
    { version: 1, addsSemanticColors: true, addsV4Defaults: true },
    { version: 2, addsSemanticColors: false, addsV4Defaults: true },
    { version: 3, addsSemanticColors: false, addsV4Defaults: true },
    { version: 4, addsSemanticColors: false, addsV4Defaults: true },
  ],
  defaults: {
    appearance: "auto",
    composition: { layers: [] },
    interfaceImages: DEFAULT_THEME_INTERFACE_IMAGES,
    surfaces: DEFAULT_THEME_SURFACES,
    background: {
      safeArea: "auto",
      taskMode: "full",
      taskOpacity: 0.82,
    },
  },
} as const;

export const THEME_SEMANTIC_CASES = [
  { name: "complete v4 theme", valid: true, expectedSchemaVersion: 4 },
  { name: "v1 semantic color migration", valid: true, sourceVersion: 1, expectedSchemaVersion: 4 },
  { name: "v2 migration", valid: true, sourceVersion: 2, expectedSchemaVersion: 4 },
  { name: "v3 migration", valid: true, sourceVersion: 3, expectedSchemaVersion: 4 },
  { name: "future schema version", valid: false, expectedErrorCode: "THEME_SCHEMA_VERSION_UNSUPPORTED", expectedPath: "/schemaVersion" },
  { name: "unsafe welcome placeholder", valid: false, expectedErrorCode: "THEME_WELCOME_INVALID", expectedPath: "/home/welcome" },
  { name: "missing display font", valid: false, expectedErrorCode: "THEME_DISPLAY_FONT_MISSING", expectedPath: "/typography/displayFontAssetKey" },
  { name: "undeclared composition asset", valid: false, expectedErrorCode: "THEME_COMPOSITION_INVALID", expectedPath: "/composition/layers/0/asset" },
  { name: "draft may omit background", valid: true, documentKind: "draft" },
  { name: "saved theme requires background", valid: false, documentKind: "theme", expectedErrorCode: "THEME_SCHEMA_INVALID", expectedPath: "/assets/background" },
] as const;
