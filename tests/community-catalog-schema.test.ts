import { describe, expect, it } from "vitest";
import { CommunityCatalogSchema } from "@open-chatgpt-skin/community-catalog";
import { cloneValidCommunityCatalog, validCommunityCatalog } from "./fixtures/community-catalog.js";

describe("community catalog schema", () => {
  it("parses one complete bilingual Theme Schema v4 catalog", () => {
    expect(CommunityCatalogSchema.parse(validCommunityCatalog)).toEqual(validCommunityCatalog);
  });

  it("rejects unknown fields instead of silently accepting them", () => {
    const catalog = cloneValidCommunityCatalog() as typeof validCommunityCatalog & { unknown?: true };
    catalog.unknown = true;
    expect(() => CommunityCatalogSchema.parse(catalog)).toThrow();
  });

  it("requires both generated locales", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    delete catalog.themes[0].localized.en;
    expect(() => CommunityCatalogSchema.parse(catalog)).toThrow();
  });

  it("rejects historical schemas, executable media, and oversized archives", () => {
    const historical = cloneValidCommunityCatalog() as any;
    historical.themes[0].versions[0].themeSchemaVersion = 3;
    expect(() => CommunityCatalogSchema.parse(historical)).toThrow();

    const executable = cloneValidCommunityCatalog() as any;
    executable.themes[0].versions[0].preview.contentType = "text/javascript";
    expect(() => CommunityCatalogSchema.parse(executable)).toThrow();

    const oversized = cloneValidCommunityCatalog() as any;
    oversized.themes[0].versions[0].archive.bytes = 32 * 1024 * 1024 + 1;
    expect(() => CommunityCatalogSchema.parse(oversized)).toThrow();
  });
});
