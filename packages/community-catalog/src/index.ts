import { createRequire } from "node:module";

const packageMetadata = createRequire(import.meta.url)("../package.json") as {
  readonly version?: unknown;
};
if (typeof packageMetadata.version !== "string") {
  throw new Error("Community Catalog package version is missing");
}
export const COMMUNITY_CATALOG_PACKAGE_VERSION = packageMetadata.version;
export * from "./schema.js";
export * from "./errors.js";
export * from "./validation.js";
