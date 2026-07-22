# OpenChatGPTSkin `.ocskin` 归档格式 v1 / Theme Schema v3

An OpenChatGPTSkin theme is a structured `.ocskin` ZIP archive. It contains data and media only; JavaScript, HTML, CSS, executables, absolute paths, path traversal, duplicate entries, symbolic-link extraction, and unknown top-level entries are not supported.

## Archive layout

```text
theme.ocskin
├── manifest.json
├── theme.json
├── preview.webp                 # optional, at most 2 MB
├── assets/
│   ├── background.webp
│   ├── portrait.webp            # optional
│   ├── profile-avatar.webp       # optional account avatar
│   ├── suggestion-card1.webp     # optional; card2-card4 use the same rule
│   └── decorations/             # optional PNG/JPEG/WebP files
└── fonts/
    └── optional-font.woff2      # optional
```

Images must live below `assets/`; fonts must live below `fonts/`. Paths use `/`, must already be Unicode NFC, may not be absolute, and may not contain empty, `.` or `..` segments, Windows-reserved names, control characters, or Windows-invalid punctuation. Paths that differ only by letter case are treated as duplicates. `preview.webp` is the only supported package file outside those directories besides the two JSON files.

## `theme.json`

The document is strict: unknown properties fail validation.

### Metadata

| Field | Rule |
|---|---|
| `schemaVersion` | exactly `3` for newly saved themes; v1 and v2 are deterministically migrated when read |
| `kind` | `theme` or `recipe` |
| `id` | 3–80 lowercase letters, digits, and single hyphen-separated segments; Windows-reserved names are rejected |
| `name` | 1–80 characters |
| `description` | optional, 1–240 characters |
| `version` | numeric `major.minor.patch` without leading zeroes |
| `author` | 1–80 characters |
| `metadata.homepage` | optional HTTPS theme or project page, at most 500 characters |
| `metadata.localized.zh-CN` | optional localized `name` and `description` overrides |
| `metadata.localized.en` | optional localized `name` and `description` overrides |

The root `name` and `description` remain the canonical fallback. Localized metadata only overrides presentation for the matching Theme Studio language, so packages keep one source of truth and remain readable by clients that do not implement localization.

### Assets

`assets.background` is required for `kind: "theme"`. `assets.portrait`, `assets.profileAvatar`, the four optional `assets.suggestionIcons.card1` through `card4`, named `assets.decorations`, and named `assets.fonts` are optional. Multiple slots may reference the same local image path, so a theme can reuse `assets.background` without duplicating the binary file. A `kind: "recipe"` document must have `assets: {}` and `rights.localOnly: true`.

When an interface-image slot references `assets.background`, Theme Studio and Runtime use the same fixed `cover` crop positions: `profileAvatar 50% 35%`, `card1 20% 25%`, `card2 80% 25%`, `card3 20% 75%`, and `card4 80% 75%`. Independently uploaded avatar and suggestion images use centered `50% 50%` crops. Omitting or clearing a slot keeps the native ChatGPT icon or avatar.

### Colors

All color values are six-digit hex or `rgb(...)` / `rgba(...)` strings. Required tokens are:

- `accent`, `secondary`, `text`, `textSecondary`, `muted`, `link`, `inputText`, `placeholder`, `codeText`, `panel`, and `border`;
- `success`, `warning`, `danger`, and `info` status colors.

### Typography

| Field | Range |
|---|---|
| `uiFamily`, `codeFamily` | 1–120 characters |
| `uiFontAssetKey`, `codeFontAssetKey` | optional key declared in `assets.fonts` |
| `scale` | `0.85`–`1.3` |
| `uiSize` | `12`–`22` |
| `codeSize` | `11`–`22` |
| `uiWeight`, `codeWeight` | `400`, `500`, `600`, or `700` |
| `lineHeight` | `1.2`–`1.8` |

Only system fonts and package WOFF2 fonts are supported. Font licensing remains the theme author's responsibility.

### Background

| Field | Range |
|---|---|
| `positionX`, `positionY` | `0`–`1` |
| `scale` | `0.5`–`3` |
| `blur` | `0`–`30` |
| `brightness` | `0.3`–`1.5` |
| `overlay` | `0`–`0.9` |

### Decorations

At most 16 decorations are allowed. A decoration has a `type` of `particles`, `ribbon`, `butterflies`, `polaroid`, `badge`, `sparkles`, or `image`, an `enabled` flag, and `intensity` from `0` to `1`. Optional controls are `placement` (`background`, `corners`, `hero`, or `cards`), `opacity` from `0` to `1`, and `scale` from `0.25` to `3`. An `image` decoration must name an `assetKey` that exists in `assets.decorations`. Runtime decoration layers must remain non-interactive.

### Safe module layout

The layout object contains:

- `heroHeight`: integer `180`–`560`;
- `cardColumns`: integer `2`–`4`;
- `composerWidth`: `0.5`–`1`;
- `sidebarDensity`: `compact` or `comfortable`;
- `moduleGap`: integer `0`–`48`;
- exactly one entry for each module: `sidebar`, `topbar`, `hero`, `suggestions`, `project-picker`, `composer`, `task-background`, and `content-layer`.

Each module has a unique `order` from `0` to `7`, `visible`, `size` (`compact`, `regular`, or `expanded`), `align` (`start`, `center`, `end`, or `stretch`), and `spacing` from `0` to `48`. The protected native regions `sidebar`, `topbar`, `project-picker`, `composer`, and `content-layer` must remain visible. `project-picker` geometry fields are retained for format compatibility but ignored by preview and Runtime: Codex's native size, position, and stacking always win, while theme colors still apply. This is the safety boundary for template-plus-modular layout; arbitrary coordinates and overlays are not accepted.

Theme Studio 隔离预览会消费允许调整的安全模块布局。真实 Codex Runtime 当前只投影稳定子集：`sidebarDensity`、`composerWidth` 和 `moduleGap`；`project-picker` 永远使用官方几何，其余字段保留在版本化主题中，等待对应 Codex 版本具备经过兼容性验证的固定映射。

### Rights

| Field | Rule |
|---|---|
| `licenseId` | required, 1–100 characters |
| `attribution` | optional in schema, but required for every public theme |
| `source` | optional URL, at most 500 characters |
| `localOnly` | boolean |

Public built-ins additionally ship `LICENSE.md` with author, license, generation method, source prompt or brief, source SHA-256, and prepared-background SHA-256. A local recipe contains no third-party image, logo artwork, font, or recognizable likeness.

## `manifest.json`

The manifest records `schemaVersion`, `themeId`, `themeVersion`, and the exact set of files other than `manifest.json`. Every entry records its byte length and lowercase SHA-256. Import fails if the archive file set, byte count, hash, theme ID, or theme version differs from the manifest.

## Media and size limits

| Item | Limit | Validation |
|---|---:|---|
| user-selected or build source image | 50 MB | source file size before processing |
| prepared PNG/JPEG/WebP image | 16 MB each | extension plus magic bytes |
| `preview.webp` | 2 MB | RIFF/WEBP magic bytes |
| WOFF2 font | 5 MB each | `wOF2` magic bytes |
| compressed `.ocskin` archive | 32 MB | checked before decompression |
| expanded package including JSON | 32 MB | streaming cumulative limit |

PNG, JPEG, WebP, and WOFF2 signatures are checked; changing an executable's extension does not make it a valid asset. Archive entries are streamed into memory under the expanded-size ceiling and are never extracted by trusting ZIP paths or link metadata.

## Catalog behavior

Public themes are ready immediately after a clean checkout:

- `future-idol-cyan`
- `rose-carpet-star`
- `mountain-mist`
- `glacier-aurora`

Asset-free recipes require a user-authorized local image and are never public-ready:


Catalog paths are constrained to `builtin/<id>` or `recipes/<id>` and must match the entry kind and ID.

## CLI

```powershell
open-chatgpt-skin-theme catalog --root themes
open-chatgpt-skin-theme validate --dir themes/builtin/mountain-mist
open-chatgpt-skin-theme pack --dir themes/builtin/mountain-mist --out mountain-mist.ocskin
open-chatgpt-skin-theme unpack --file mountain-mist.ocskin --out unpacked/mountain-mist
```

The CLI parses and validates `theme.json` before following any referenced path. Pack output is written to a same-directory temporary file and atomically published with a create-only hard link. Unpack output is written to a staging directory and atomically renamed. Existing output paths are never overwritten. Every failure is emitted as one JSON object in the form `{"error":{"code":"STABLE_CODE","message":"Readable explanation"}}`.

CLI exit codes:

- `0`: success;
- `64`: `CLI_USAGE`, command or option usage error;
- `65`: a validation code such as `THEME_SCHEMA_INVALID` or `ARCHIVE_HASH_MISMATCH`;
- `73`: `CLI_WRITE` or `FS_<errno>`, input/output path or permission error;
- `70`: `INTERNAL_ERROR`, unexpected internal error.

## Stable validation error codes

Asset and rights errors include `THEME_SCHEMA_INVALID`, `RIGHTS_ATTRIBUTION_REQUIRED`, `RECIPE_ASSET_FORBIDDEN`, `ASSET_MISSING`, `ASSET_UNSUPPORTED`, `ASSET_UNDECLARED`, `ASSET_PATH_COLLISION`, `ASSET_SIGNATURE_INVALID`, `IMAGE_TOO_LARGE`, `FONT_TOO_LARGE`, `PREVIEW_TOO_LARGE`, and `PACKAGE_TOO_LARGE`.

Storage errors include `THEME_REF_INVALID`, `THEME_VERSION_CONFLICT`, `THEME_STATE_INVALID`, `STORED_THEME_INVALID`, `STORED_THEME_IDENTITY_MISMATCH`, and `ROLLBACK_UNAVAILABLE`.

Archive errors include `PACKAGE_EXPANDED_TOO_LARGE`, `ARCHIVE_ENTRY_UNSAFE`, `ARCHIVE_ENTRY_DUPLICATE`, `ARCHIVE_ENTRY_UNSUPPORTED`, `ARCHIVE_ENTRY_SIZE_INVALID`, `ARCHIVE_ENTRY_TOO_LARGE`, `ARCHIVE_REQUIRED_FILE_MISSING`, `ARCHIVE_MANIFEST_INVALID`, `ARCHIVE_THEME_JSON_INVALID`, `ARCHIVE_MANIFEST_MISMATCH`, `ARCHIVE_HASH_MISMATCH`, and `ARCHIVE_IDENTITY_MISMATCH`.

Validation fails closed. The Foundation contains no Codex, CDP, API-key, authentication, WindowsApps, or project-code mutation logic.
