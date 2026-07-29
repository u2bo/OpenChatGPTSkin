import { describe, expect, it } from "vitest";
import {
  CommunityCatalogValidationError,
  parseCommunityCatalogTrustPolicy,
  serializeCommunityCatalog,
  validateCommunityCatalog,
} from "@open-chatgpt-skin/community-catalog";
import { cloneValidCommunityCatalog } from "./fixtures/community-catalog.js";

const policy = {
  releaseRepository: "https://github.com/u2bo/OpenChatGPTSkin-Community",
  siteOrigin: "https://u2bo.github.io/OpenChatGPTSkin-Community",
} as const;

describe("community catalog invariants", () => {
  it("accepts the fixture and serializes it deterministically", () => {
    const parsed = validateCommunityCatalog(cloneValidCommunityCatalog(), policy);
    const reorderedInput = cloneValidCommunityCatalog() as any;
    const reordered = {
      themes: reorderedInput.themes,
      catalogRevision: reorderedInput.catalogRevision,
      schemaVersion: reorderedInput.schemaVersion,
    };
    const serialized = serializeCommunityCatalog(parsed);

    expect(serialized).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(serializeCommunityCatalog(validateCommunityCatalog(reordered, policy))).toBe(serialized);
    expect(serialized).not.toContain("\r");
  });

  it("parses only the strict trust-policy shape", () => {
    expect(parseCommunityCatalogTrustPolicy(policy)).toEqual(policy);
    expect(() => parseCommunityCatalogTrustPolicy({ ...policy, unknown: true })).toThrow();
  });

  it("rejects an invalid trust policy passed directly to the validation boundary", () => {
    const invalidPolicy = {
      releaseRepository: "https://evil.example/OpenChatGPTSkin-Community",
      siteOrigin: "https://evil.example",
    };

    expect(() => validateCommunityCatalog(cloneValidCommunityCatalog(), invalidPolicy))
      .toThrow();
  });

  it("rejects duplicate theme IDs with a stable domain error", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes.push(structuredClone(catalog.themes[0]));

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("reports schema failures as stable domain errors", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.unknown = true;

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("rejects unsorted tags", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].tags.reverse();

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("rejects duplicate tags", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].tags = ["landscape", "landscape"];

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("rejects duplicate versions within a theme", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].versions.push(structuredClone(catalog.themes[0].versions[0]));

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("rejects an untrusted preview URL", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].versions[0].preview.url = "https://evil.example/preview.webp";

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("rejects an untrusted screenshot URL", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].versions[0].screenshots[0].url = "https://evil.example/home.webp";

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("rejects an untrusted archive URL", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].versions[0].archive.url = "https://evil.example/theme.ocskin";

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);
  });

  it("requires home plus task or conversation screenshots", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].versions[0].screenshots[1].kind = "dark";

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(/screenshot/i);
  });

  it("requires latestVersion to select the highest downloadable version", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    const version = structuredClone(catalog.themes[0].versions[0]);
    version.version = "2.0.0";
    catalog.themes[0].versions.unshift(version);

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);

    catalog.themes[0].latestVersion = "2.0.0";
    expect(validateCommunityCatalog(catalog, policy).themes[0].latestVersion).toBe("2.0.0");
  });

  it("requires yanked versions to remove the archive and carry a reason", () => {
    const withArchive = cloneValidCommunityCatalog() as any;
    withArchive.themes[0].versions[0].supportStatus = "yanked";
    withArchive.themes[0].versions[0].yankedReason = { "zh-CN": "权利投诉。", en: "Rights complaint." };
    withArchive.themes[0].latestVersion = null;
    expect(() => validateCommunityCatalog(withArchive, policy)).toThrow(CommunityCatalogValidationError);

    const withoutReason = cloneValidCommunityCatalog() as any;
    withoutReason.themes[0].versions[0].supportStatus = "yanked";
    withoutReason.themes[0].versions[0].archive = null;
    withoutReason.themes[0].latestVersion = null;
    expect(() => validateCommunityCatalog(withoutReason, policy)).toThrow(CommunityCatalogValidationError);

    withoutReason.themes[0].versions[0].yankedReason = { "zh-CN": "权利投诉。", en: "Rights complaint." };
    expect(validateCommunityCatalog(withoutReason, policy).themes[0].latestVersion).toBeNull();
  });

  it("requires downloadable archives and forbids yank reasons on active versions", () => {
    const withoutArchive = cloneValidCommunityCatalog() as any;
    withoutArchive.themes[0].versions[0].archive = null;
    withoutArchive.themes[0].latestVersion = null;
    expect(() => validateCommunityCatalog(withoutArchive, policy)).toThrow(CommunityCatalogValidationError);

    const withYankReason = cloneValidCommunityCatalog() as any;
    withYankReason.themes[0].versions[0].yankedReason = { "zh-CN": "错误原因。", en: "Invalid reason." };
    expect(() => validateCommunityCatalog(withYankReason, policy)).toThrow(CommunityCatalogValidationError);
  });

  it("excludes incompatible versions from latestVersion", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    catalog.themes[0].versions[0].supportStatus = "incompatible";
    catalog.themes[0].latestVersion = null;

    expect(validateCommunityCatalog(catalog, policy).themes[0].latestVersion).toBeNull();
  });

  it("requires themes to be sorted by ID", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    const earlierTheme = structuredClone(catalog.themes[0]);
    earlierTheme.id = "alpine-community";
    catalog.themes.push(earlierTheme);

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);

    catalog.themes.reverse();
    expect(validateCommunityCatalog(catalog, policy).themes.map(({ id }: any) => id))
      .toEqual(["alpine-community", "mountain-mist-community"]);
  });

  it("requires versions to be sorted newest first", () => {
    const catalog = cloneValidCommunityCatalog() as any;
    const olderVersion = structuredClone(catalog.themes[0].versions[0]);
    olderVersion.version = "0.9.0";
    catalog.themes[0].versions.unshift(olderVersion);

    expect(() => validateCommunityCatalog(catalog, policy))
      .toThrow(CommunityCatalogValidationError);

    catalog.themes[0].versions.reverse();
    expect(validateCommunityCatalog(catalog, policy).themes[0].versions.map(({ version }: any) => version))
      .toEqual(["1.0.0", "0.9.0"]);
  });
});
