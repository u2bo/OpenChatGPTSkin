export interface CommunityCatalogIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export class CommunityCatalogValidationError extends Error {
  public readonly code = "COMMUNITY_CATALOG_INVALID";

  constructor(public readonly issues: readonly CommunityCatalogIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "CommunityCatalogValidationError";
  }
}
