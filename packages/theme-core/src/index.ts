import { createRequire } from "node:module";

const packageMetadata = createRequire(import.meta.url)("../package.json") as {
  readonly version?: unknown;
};
if (typeof packageMetadata.version !== "string") {
  throw new Error("Theme Core package version is missing");
}
export const THEME_CORE_VERSION = packageMetadata.version;
export * from "./archive.js";
export * from "./assets.js";
export * from "./catalog.js";
export * from "./cli.js";
export * from "./directory.js";
export * from "./errors.js";
export * from "./storage.js";
export * from "./types.js";
