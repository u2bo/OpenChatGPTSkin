# Community Catalog Contract (Schema v1)

The community catalog is a versioned, machine-readable directory of community themes. OpenChatGPTSkin remains the single source of truth for Theme Schema and `.ocskin` validation; community repositories publish catalog data and media, not alternate validators.

## Packages and versions

A product Release publishes these version-matched npm packages:

- `@open-chatgpt-skin/theme-schema`
- `@open-chatgpt-skin/theme-core`
- `@open-chatgpt-skin/community-catalog`

Catalog documents use `schemaVersion: 1`. The schema rejects unknown fields and enum values, requires both `zh-CN` and `en` generated metadata, and accepts new community submissions using Theme Schema v4 only. `themeId + version` is immutable; changed theme bytes require a higher semantic version.

The catalog package exports the strict Zod schema and inferred types, `validateCommunityCatalog`, `serializeCommunityCatalog`, the trust-policy parser, stable validation errors, and the CI CLI.

## CLI

Validate a catalog:

```bash
open-chatgpt-skin-community-catalog validate \
  --file catalog.json \
  --release-repository https://github.com/OWNER/REPOSITORY \
  --site-origin https://OWNER.github.io/REPOSITORY
```

Write canonical UTF-8 JSON with two-space indentation and one LF terminator:

```bash
open-chatgpt-skin-community-catalog canonicalize \
  --file catalog.json \
  --out canonical.json \
  --release-repository https://github.com/OWNER/REPOSITORY \
  --site-origin https://OWNER.github.io/REPOSITORY
```

`canonicalize` is create-only and never overwrites an existing destination. Both commands write one JSON value to stdout on success and one JSON error object to stderr on failure.

Validation success has this shape:

```json
{"valid":true,"schemaVersion":1,"catalogRevision":"<40 lowercase hex characters>","themeCount":1,"versionCount":1}
```

Canonicalization success is `{"canonicalized":true,"output":"<absolute destination path>"}`.

Stable CLI failures are:

- exit `64`, `CLI_USAGE`: invalid command, option, or trust policy;
- exit `65`, `COMMUNITY_CATALOG_INVALID`: invalid JSON, schema, lifecycle, ordering, or URL trust;
- exit `73`, `CLI_WRITE`: missing/inaccessible input or a destination that cannot be created;
- exit `70`, `INTERNAL_ERROR`: an unexpected internal failure.

## URL trust policy

`--release-repository` must be exactly `https://github.com/OWNER/REPOSITORY`, without a trailing slash, query, or fragment. Every non-null archive URL must begin with that repository's `/releases/download/` path.

`--site-origin` must be an HTTPS host with an optional fixed path and no trailing slash, query, or fragment. Preview and screenshot URLs must remain below that origin. Author homepages are untrusted display links and do not authorize archive or media downloads.

Catalog text is untrusted plain text. The contract does not permit HTML, CSS, JavaScript, executable content, DOM selectors, remote theme assets, or free-running code.

## Lifecycle and ordering

- `verified` and `needs-reverification` versions are downloadable and require an archive.
- `incompatible` and `yanked` versions cannot become `latestVersion`.
- `yanked` versions expose no archive and require a bilingual reason.
- Non-yanked versions expose no yank reason.
- `latestVersion` is the highest downloadable semantic version, or `null` when none is downloadable.
- Themes are sorted by ID, versions newest first, and tags are unique and sorted.

Each version requires a cover preview plus a `home` screenshot and either a `task` or `conversation` screenshot. Media is WebP with declared dimensions, byte size, and SHA-256.

## Rights and archive safety

`rightsDeclaration` is exactly `author-self-declared`. It records the submitter's declaration; it is not independent legal verification by the project.

A compressed `.ocskin` archive is limited to 32 MB and still passes through `@open-chatgpt-skin/theme-core` archive validation when a user imports it. Catalog metadata, status, hashes, or publication approval never weaken or replace that validator.

## Release artifacts

The same GitHub Release as the native application contains:

- `open-chatgpt-skin-theme-schema-VERSION.tgz`
- `open-chatgpt-skin-theme-core-VERSION.tgz`
- `open-chatgpt-skin-community-catalog-VERSION.tgz`
- `community-tooling.json`
- the shared `checksums.txt`

`community-tooling.json` has schema version 1, the exact product and Node.js versions, and each package's filename, byte size, and SHA-256. Release acceptance installs all three tarballs in a clean external project with lifecycle scripts disabled, then runs both installed CLIs. `checksums.txt` covers the three tarballs, the tooling manifest, and native application assets.

## Scope boundary

This core tooling release does not implement or authorize the community website, submission workflow, moderation UI, remote installation, background download, automatic updates, or catalog signing. Those capabilities belong to the separate community repository and require their own implementation plan after immutable Release URLs and checksums exist.
