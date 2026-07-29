import { z } from "zod";
import { CommunityCatalogSchema, type CommunityCatalog } from "./schema.js";
import { CommunityCatalogValidationError, type CommunityCatalogIssue } from "./errors.js";

export const CommunityCatalogTrustPolicySchema = z.object({
  releaseRepository: z.string().regex(
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  ),
  siteOrigin: z.string().regex(
    /^https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~-]+)*$/,
  ),
}).strict();

export type CommunityCatalogTrustPolicy = z.infer<typeof CommunityCatalogTrustPolicySchema>;

export function parseCommunityCatalogTrustPolicy(input: unknown): CommunityCatalogTrustPolicy {
  return CommunityCatalogTrustPolicySchema.parse(input);
}

const downloadableStatuses: ReadonlySet<string> = new Set([
  "verified",
  "needs-reverification",
]);

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function issue(path: string, message: string): CommunityCatalogIssue {
  return { code: "COMMUNITY_CATALOG_INVALID", path, message };
}

export function validateCommunityCatalog(
  input: unknown,
  policy: CommunityCatalogTrustPolicy,
): CommunityCatalog {
  const trustedPolicy = parseCommunityCatalogTrustPolicy(policy);
  const mediaPrefix = `${trustedPolicy.siteOrigin}/`;
  const releasePrefix = `${trustedPolicy.releaseRepository}/releases/download/`;
  const shape = CommunityCatalogSchema.safeParse(input);
  if (!shape.success) {
    throw new CommunityCatalogValidationError(shape.error.issues.map((entry: z.ZodIssue) =>
      issue(`/${entry.path.join("/")}`, entry.message)));
  }
  const catalog = shape.data;
  const issues: CommunityCatalogIssue[] = [];
  const themeIds = catalog.themes.map(({ id }) => id);
  if ([...themeIds].sort().join("\0") !== themeIds.join("\0")) {
    issues.push(issue("/themes", "themes must be sorted by ID"));
  }
  const ids = new Set<string>();
  for (const [themeIndex, theme] of catalog.themes.entries()) {
    const themePath = `/themes/${themeIndex}`;
    if (ids.has(theme.id)) {
      issues.push(issue(`${themePath}/id`, "theme IDs must be unique"));
    }
    ids.add(theme.id);
    if ([...theme.tags].sort().join("\0") !== theme.tags.join("\0") ||
        new Set(theme.tags).size !== theme.tags.length) {
      issues.push(issue(`${themePath}/tags`, "tags must be unique and sorted"));
    }
    const versionOrder = theme.versions.map(({ version }) => version);
    const descendingVersions = [...versionOrder].sort(compareVersions).reverse();
    if (descendingVersions.join("\0") !== versionOrder.join("\0")) {
      issues.push(issue(`${themePath}/versions`, "theme versions must be sorted newest first"));
    }
    const versions = new Set<string>();
    for (const [versionIndex, version] of theme.versions.entries()) {
      const versionPath = `${themePath}/versions/${versionIndex}`;
      if (versions.has(version.version)) {
        issues.push(issue(`${versionPath}/version`, "theme versions must be unique"));
      }
      versions.add(version.version);
      const screenshotKinds = new Set(version.screenshots.map(({ kind }) => kind));
      if (!screenshotKinds.has("home") ||
          (!screenshotKinds.has("task") && !screenshotKinds.has("conversation"))) {
        issues.push(issue(`${versionPath}/screenshots`, "screenshots require home and task or conversation"));
      }
      for (const [mediaIndex, media] of [version.preview, ...version.screenshots].entries()) {
        if (!media.url.startsWith(mediaPrefix)) {
          issues.push(issue(`${versionPath}/media/${mediaIndex}/url`, "media URL is outside the trusted site origin"));
        }
      }
      if (version.archive && !version.archive.url.startsWith(releasePrefix)) {
        issues.push(issue(`${versionPath}/archive/url`, "archive URL is outside the trusted release repository"));
      }
      if (version.supportStatus === "yanked") {
        if (version.archive !== null) {
          issues.push(issue(`${versionPath}/archive`, "yanked version must not expose an archive"));
        }
        if (version.yankedReason === null) {
          issues.push(issue(`${versionPath}/yankedReason`, "yanked version requires a reason"));
        }
      } else if (version.yankedReason !== null) {
        issues.push(issue(`${versionPath}/yankedReason`, "non-yanked version must not expose a yank reason"));
      }
      if (downloadableStatuses.has(version.supportStatus) && version.archive === null) {
        issues.push(issue(`${versionPath}/archive`, "downloadable version requires an archive"));
      }
    }
    const latest = theme.versions
      .filter((version) => downloadableStatuses.has(version.supportStatus) && version.archive !== null)
      .map((version) => version.version)
      .sort(compareVersions)
      .at(-1) ?? null;
    if (theme.latestVersion !== latest) {
      issues.push(issue(`${themePath}/latestVersion`, "latestVersion must select the highest downloadable version"));
    }
  }
  if (issues.length > 0) throw new CommunityCatalogValidationError(issues);
  return catalog;
}

export function serializeCommunityCatalog(catalog: CommunityCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}
