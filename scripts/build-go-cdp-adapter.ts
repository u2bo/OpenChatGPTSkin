import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { build } from "esbuild";
import { PROBE_EXPRESSION } from "../packages/cdp-adapter/src/scripts.js";

const adapterId = "current-2026-07";
const output = resolve("host/go/internal/cdp/generated/adapter-manifest.json");
const built = await build({
  absWorkingDir: resolve("."),
  bundle: true,
  entryPoints: ["scripts/go-cdp-adapter-entry.ts"],
  format: "iife",
  minify: true,
  platform: "browser",
  target: "es2022",
  tsconfig: "tsconfig.scripts.json",
  write: false,
});
const bundle = built.outputFiles[0]?.text;
if (!bundle) throw new Error("Go CDP Adapter browser bundle was not generated");
// esbuild's IIFE format intentionally discards the entrypoint's final
// expression. CDP bootstrap is a request/response boundary, so wrap the
// bundle in an expression that confirms the immutable Adapter registration.
const source = `(()=>{${bundle};return Object.prototype.hasOwnProperty.call(globalThis,"__openChatGPTSkinAdapter")&&Object.isFrozen(globalThis.__openChatGPTSkinAdapter)})()`;
const digest = createHash("sha256").update(`${adapterId}\n${PROBE_EXPRESSION}\n${source}`, "utf8").digest("hex");

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({
  schemaVersion: 1,
  adapterId,
  probeExpression: PROBE_EXPRESSION,
  source,
  sha256: digest,
}, null, 2)}\n`, "utf8");
