# OpenChatGPTSkin Custom Theme Guide

[简体中文](custom-theme-guide.md) · [English](custom-theme-guide.en.md) · [Back to README](../README.en.md)

This guide covers two supported customization paths:

1. Use Codex or another coding agent with a copy-ready prompt to package local assets into a validated, shareable `.ocskin` file.
2. Use Theme Studio to customize a theme visually from the built-in library.

![Customizing a theme in Theme Studio](assets/screenshots/theme-studio.webp)

> [!IMPORTANT]
> This preview runs from source and supports Windows 11 and macOS. Fully quit the regular Codex app before applying a theme. Themes may contain data and local media only—never arbitrary JavaScript, HTML, CSS, executables, remote asset URLs, or custom DOM selectors. Real-app visual acceptance on macOS must still be completed on a Mac using the [macOS Runtime guide](runtime-macos.en.md).

## Choose a workflow

| Workflow | Best for | Advantages | What you provide |
|---|---|---|---|
| AI-packaged `.ocskin` | Git/CLI users, batch generation, precise configuration | Reusable, reviewable, PR-friendly | Local paths, rights, visual direction |
| Theme Studio UI | Visual iteration and immediate preview | Fast, validated, no handwritten JSON | No schema knowledge required |

Both workflows produce the same Theme Schema v2 data and can import/export each other. A practical approach is to find the desired look in Theme Studio, export it, and use AI packaging only for automation or batch work.

## Customizable areas

| Category | Controls |
|---|---|
| Colors | Accent, secondary, primary/secondary/muted text, link, input, placeholder, code/terminal, panel, border, success/warning/danger/info |
| Background | Image, portrait, appearance, focal point, scale, blur, brightness, overlay, safe area, task mode and opacity |
| Surfaces | Base, elevated, and terminal opacity and glass blur |
| Typography | UI/code family, sizes, scale, weights, line height, local WOFF2 fonts |
| Decorations | Particles, ribbon, butterflies, polaroid, badge, sparkles, local image decorations |
| Layout | Allowed module order, visibility, size, alignment, spacing, sidebar density, composer width, card columns |
| Metadata | Theme ID, name, description, version, author, and rights |

Protected regions such as the project picker, sidebar, top bar, composer, and content layer must remain visible. The project picker always uses Codex's native size, position, and stacking; only its theme colors change. Theme Studio does not accept arbitrary coordinates, overlays, or CSS.

## Workflow 1: AI-assisted theme packaging

### 1. Prepare assets and requirements

Prepare:

- A 16:9 background, ideally at least `1600 × 900`, in PNG/JPEG/WebP and no larger than 16 MB after preparation.
- Optional portrait, decoration images, and WOFF2 fonts.
- A name, lowercase hyphenated ID such as `my-forest-theme`, author, and version.
- Light/dark direction, primary colors, subject focal point, and text safe area.
- Source and license information for every asset.

For private use or uncertain rights, use:

```json
{
  "licenseId": "LicenseRef-User-Supplied",
  "localOnly": true
}
```

Do not publicly share themes containing unlicensed images, recognizable people, commercial fonts, logos, or copyrighted characters.

### 2. Copy-ready packaging prompt

Attach your local assets to Codex or another coding agent, open the OpenChatGPTSkin repository, and replace the placeholders below:

```text
You are working inside the OpenChatGPTSkin repository. Package my supplied local assets as a safe,
validated Theme Schema v2 theme and .ocskin file. Do not modify Runtime, Theme Studio, or unrelated code.

Theme requirements:
- Name: <theme name>
- ID: <lowercase hyphenated ID, for example my-forest-theme>
- Author: <author>
- Initial version: 1.0.0
- Appearance: <auto / light / dark>
- Visual direction: <mood, accent, secondary, and text colors>
- Subject position: <left / center / right>
- Text safe area: <left / center / right / none>
- Task background mode: <full / ambient / banner / off>
- Asset source and license: <source, license, redistribution status>
- Local-only: <true / false>

Constraints:
1. Read docs/theme-format.md completely and use themes/builtin/mountain-mist as the structural reference.
2. Create theme.json, assets/, and an optional preview.webp in a new theme directory.
3. Use only local PNG/JPEG/WebP/WOFF2 assets I explicitly supplied. Do not download remote assets.
4. Do not add JavaScript, HTML, CSS, executables, arbitrary DOM selectors, or hidden fallbacks.
5. Configure the complete Theme Schema v2 semantic color set. Primary, input, and code text
   must pass Theme Studio's contrast gate.
6. Derive positionX/positionY, safeArea, overlay, brightness, and surface values from the artwork,
   keeping menus, settings, history, tasks, terminals, and composers readable in real Codex.
7. Keep protected layout regions visible. Do not change project-picker coordinates or stacking.
8. Make rights accurate. When uncertain, set licenseId=LicenseRef-User-Supplied and localOnly=true,
   and do not claim public redistribution rights.
9. Run npm run build, then:
   node packages/theme-core/dist/cli.js validate --dir <theme-directory>
   node packages/theme-core/dist/cli.js pack --dir <theme-directory> --out <theme-id>-1.0.0.ocskin
10. Report validation output, generated paths, a configuration summary, and unresolved rights risks.

Do not swallow validation errors. Preserve the structured error code, fix the root cause, and validate again.
```

### 3. Copy-ready background-generation prompt

If you do not have artwork yet, use this template with an image model. A good UI background needs a focal region and a low-detail text-safe region.

```text
Create an original 16:9, 4K desktop theme background for Codex Desktop UI.
Style: <nature / sci-fi / minimal / retro / other>.
Main subject: <description>, positioned on the <right/left>, detailed but away from window edges.
Reserve a large low-detail, low-contrast, text-free UI-safe area on the <left/right> for the sidebar,
headings, cards, and composer. Use <primary color> with <secondary color>, avoiding pure-white highlights
behind text. No logos, brands, words, watermarks, known characters, celebrity likenesses, or distinctive
copyrighted costumes. The image must work beneath translucent panels.
```

Review likeness, branding, and rights manually. AI generation does not automatically grant redistribution rights.

### 4. Theme directory

```text
my-theme/
├── theme.json
├── preview.webp                 # optional, max 2 MB
├── assets/
│   ├── background.webp          # required for kind: theme
│   ├── portrait.webp            # optional
│   └── decorations/             # optional
└── fonts/
    └── ui.woff2                  # optional
```

The pack command generates `manifest.json` from the actual files, byte sizes, and SHA-256 values. Do not maintain it manually.

### 5. Validate and pack

```powershell
npm run build
node packages/theme-core/dist/cli.js validate --dir D:\Themes\my-theme
node packages/theme-core/dist/cli.js pack --dir D:\Themes\my-theme --out D:\Themes\my-theme-1.0.0.ocskin
```

Outputs use create-only semantics. If the destination already exists, choose a new version or output name instead of overwriting an immutable version.

### 6. Import and test

Import from the Theme Studio library, or use the Runtime:

```powershell
npm run runtime -- import --theme-file "D:\Themes\my-theme-1.0.0.ocskin"
npm run runtime -- launch --theme my-theme
```

Fully quit the regular Codex app before `launch`.

## Workflow 2: Theme Studio UI

### 1. Start Theme Studio

```powershell
npm ci
npm run studio:dev
```

Open the one-time `127.0.0.1` URL printed by the command. Theme Studio binds only to the local loopback interface.

### 2. Select or import a theme

- Selecting a built-in theme loads it and enters **Editing tools** automatically.
- When a draft already exists, choose **Load existing draft** or **Overwrite existing draft**.
- **Cancel** closes the prompt and keeps the theme library unchanged.
- A theme has one draft and one personal-theme identity, so reopening it does not create duplicate cards.
- You can also import an existing `.ocskin` from the library.

### 3. Edit colors

A useful order is:

1. Panel background and border.
2. Primary, secondary, and muted text.
3. Input, placeholder, and code/terminal text.
4. Accent, secondary, link, and status colors.

Theme Studio reports contrast and schema issues. Errors block saving and are never silently replaced with fallback colors.

### 4. Upload the background and media

In **Background**, upload a local PNG/JPEG/WebP and configure:

- appearance mode;
- focal point, scale, blur, brightness, and overlay;
- text safe area;
- task background mode and opacity;
- base, elevated, and terminal opacity/glass blur.

Lower overlays expose more artwork but reduce readability. Choose the safe area first, then lower the overlay carefully.

### 5. Typography, decorations, and layout

- Typography: UI/code families, sizes, scale, weights, and line height. Embedded fonts must be WOFF2.
- Decorations: up to 16 non-interactive layers.
- Layout: adjust supported modules, but never replace the native project-picker geometry.

### 6. Preview

Switch between **Home** and **Task workspace** above the isolated preview. Check:

- whether artwork covers important text;
- light/dark text and link contrast;
- composer, cards, menus, and terminal consistency;
- both home and task-surface transparency.

Preview and Runtime share the same visual model, but a Codex update can still change internal DOM. Record the Codex version and route, then update the adapter rather than adding arbitrary CSS.

### 7. Save, apply, and export

Theme Studio **does not auto-save versions**:

1. Property edits update only the current editor state and preview.
2. **Save version** creates a personal-theme version.
3. Only an exact saved `{id, version}` can be applied or exported.
4. Export `.ocskin` from the theme/version tools when ready to share.

Fully quit the regular Codex app before applying. To restore, use **Restore original skin**, then quit the managed Codex instance normally to finish cleanup.

## Version and draft rules

- Keep a published theme ID stable.
- Versions use `major.minor.patch`.
- Saved versions are immutable.
- Reopening a theme does not create a duplicate draft.
- **Load existing** preserves current work; **Overwrite existing** starts from the selected source theme.
- Deleting a personal theme removes grouped legacy aliases, versions, and drafts.

## Asset and package limits

| Item | Limit |
|---|---:|
| User-selected source image | 50 MB |
| Prepared PNG/JPEG/WebP | 16 MB each |
| `preview.webp` | 2 MB |
| WOFF2 font | 5 MB each |
| Compressed `.ocskin` | 32 MB |
| Expanded theme package | 32 MB |

See [Theme Format and Safety Rules](theme-format.md) for paths, signatures, schema fields, and error codes.

## Pre-publish checklist

- [ ] ID, name, author, and version are correct.
- [ ] Home, tasks, history, settings, plugins, menus, composer, and terminal are readable.
- [ ] Primary, input, and code text pass contrast validation.
- [ ] The project picker uses native size and position.
- [ ] No remote URLs, scripts, CSS, executables, or arbitrary selectors are included.
- [ ] Every image and font has documented rights.
- [ ] Public themes include attribution.
- [ ] `validate` and `pack` succeed.
- [ ] The theme works in real Codex and the official appearance can be restored.
- [ ] Screenshots contain no project names, usernames, chat content, paths, or tokens.

## Troubleshooting

### Save version is disabled

Inspect the validation panel and fix contrast, missing assets, or schema errors. Saving is available only when the draft has changes and validation passes.

### Apply to Codex is disabled

Choose **Save version** first. Temporary editor state cannot be sent directly to the Runtime.

### Background is missing or too blurred

Use a local PNG/JPEG/WebP and review scale, blur, brightness, overlay, task mode, and surface opacity. Remote image URLs are not supported.

### Runtime safely rejects the command

```powershell
npm run runtime -- status
```

Fully quit the regular Codex app, then retry. Do not force-close a managed Codex process through Task Manager.

### Restore the official appearance

```powershell
npm run runtime -- restore
```

Then quit Codex normally through its menu or system tray to complete cleanup.
