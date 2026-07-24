import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseThemeDocument } from "../packages/theme-schema/src/index.js";
import {
  ThemeCatalogSchema,
  type ThemeCatalogEntry,
} from "../packages/theme-core/src/index.js";
import { buildCharacterTheme } from "./character-theme-builder.js";

const ROOT = resolve("themes");
const SOURCE_ROOT = join(ROOT, "sources");
const BUILTIN_ROOT = join(ROOT, "builtin");
const RECIPES: readonly string[] = [];

async function atomicWrite(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, path);
}

const sourceEntries = await readdir(SOURCE_ROOT, { withFileTypes: true });
const sourceIds = sourceEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const builtins: ThemeCatalogEntry[] = [];
for (const id of sourceIds) {
  builtins.push(await buildCharacterTheme(
    join(SOURCE_ROOT, id),
    join(BUILTIN_ROOT, id),
  ));
}

const recipes: ThemeCatalogEntry[] = [];
for (const id of RECIPES) {
  const path = join(ROOT, "recipes", id, "recipe.json");
  const recipe = parseThemeDocument(JSON.parse(await readFile(path, "utf8")));
  recipes.push({
    id: recipe.id,
    name: recipe.name,
    version: recipe.version,
    kind: "recipe",
    path: `recipes/${recipe.id}`,
    ready: false,
    localOnly: true,
    licenseId: recipe.rights.licenseId,
  });
}

builtins.sort((left, right) => left.id.localeCompare(right.id));
recipes.sort((left, right) => left.id.localeCompare(right.id));
const catalog = ThemeCatalogSchema.parse({ schemaVersion: 1, builtins, recipes });
await atomicWrite(join(ROOT, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
