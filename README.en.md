# OpenChatGPTSkin

[简体中文](README.md) · [English](README.en.md)

![Status](https://img.shields.io/badge/status-stable-2ea44f)
![Platform](https://img.shields.io/badge/release-Windows%20x64%20%7C%20macOS%20Preview-0078d4)
![Node.js](https://img.shields.io/badge/Node.js-22%20bundled-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![License](https://img.shields.io/badge/code%20%26%20docs-MIT-2563eb)
[![LINUX DO Community](https://img.shields.io/badge/community-LINUX%20DO-f0b90b)](https://linux.do/)

**OpenChatGPTSkin is an open-source theme system for Codex Desktop. It does more than replace the home-page background: one color, background, typography, decoration, and safe-layout model is projected across every Codex UI surface currently recognized by the Runtime.**

### Theme Studio home previews

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/index1.webp" alt="Theme Studio light home"></td>
    <td width="50%"><img src="docs/assets/screenshots/index2.webp" alt="Theme Studio dark home"></td>
  </tr>
  <tr>
    <td align="center">Light home</td>
    <td align="center">Dark home</td>
  </tr>
</table>

<details>
  <summary>View the Theme Studio editor workspace</summary>
  <br>
  <img src="docs/assets/screenshots/theme-studio.webp" alt="OpenChatGPTSkin Theme Studio editor workspace">
</details>

## Theme concepts

The three complete concept images below show how far OpenChatGPTSkin can be customized across portrait, anime, and high-energy sci-fi directions. Each image keeps its original aspect ratio without cropping.

> [!NOTE]
> These images demonstrate visual capabilities. “Yua Mikami Starlight” is now implemented as a mixed-license authorized theme; the other images remain concepts. The concept images themselves are not shipped in release packages and do not imply an official relationship with any depicted person, work, or rights holder. Follow each theme's separate asset license before public use or redistribution.

### Yua Mikami pink-mist concept

<img src="docs/assets/concepts/yua-mikami.png" width="100%" alt="Complete Yua Mikami pink-mist OpenChatGPTSkin concept">

### Ichigo Hoshimiya stage concept

<img src="docs/assets/concepts/ichigo-hoshimiya.png" width="100%" alt="Complete Ichigo Hoshimiya stage OpenChatGPTSkin concept">

### Super Saiyan engine concept

<img src="docs/assets/concepts/super-saiyan-goku.png" width="100%" alt="Complete Super Saiyan Goku OpenChatGPTSkin concept">

> [!IMPORTANT]
> `v0.1.0` is the first stable release, providing a **stable Windows x64 build** and an **unsigned macOS preview**. Windows includes an x64 portable ZIP and per-user Setup; macOS includes separate Apple Silicon ARM64 and Intel x64 DMGs/portable archives. Every artifact bundles Node.js and requires neither Git nor development dependencies. macOS has not completed the real-Codex visual loop, Developer ID signing, or notarization. Use the standard Control-click → **Open** flow below and do not disable Gatekeeper. Save your work and **fully quit the regular Codex app** before applying or restoring a theme. OpenChatGPTSkin manages only the Codex instance it launches and never modifies `WindowsApps`, `Codex.app`, `app.asar`, account settings, or API configuration.

## Contents

- [Overview](#overview)
- [Theme concepts](#theme-concepts)
- [Features](#features)
- [Full UI coverage](#full-ui-coverage)
- [Built-in themes](#built-in-themes)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Custom themes](#custom-themes)
- [Runtime commands](#runtime-commands)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Overview

OpenChatGPTSkin consists of three constrained layers:

1. **Theme Schema and `.ocskin`** define a validated, migratable, and shareable data-and-assets format.
2. **Theme Studio** provides visual editing, isolated preview, immutable versions, import/export, and application to a real Codex instance.
3. **Desktop Runtime (Windows / macOS)** safely launches a managed official Codex instance, projects a theme through a CDP connection bound only to `127.0.0.1`, and supports pause, resume, and restore.

Themes are data, not arbitrary code. An `.ocskin` package cannot contain JavaScript, HTML, CSS, executables, remote asset URLs, or user-supplied DOM selectors. This keeps customization expressive while preserving validation and recovery boundaries.

### Project status

| Capability | Status |
|---|---|
| Theme Schema v4 and `.ocskin` validation/migration/pack/unpack | Complete |
| Five ready-to-use built-in themes | Complete |
| Windows Runtime launch/switch/pause/restore | Stable |
| Windows x64 portable ZIP and per-user Setup | Stable |
| macOS ARM64/x64 DMG and Runtime launch/switch/restore | Unsigned preview; real-Mac acceptance pending |
| Theme Studio editing/preview/version/import/export/apply | Stable |
| Codex plugin-market installation | Not available yet |
| Automatic updates, SEA single-file executable, theme marketplace | Planned |

## Features

- Edit accent, secondary, primary/secondary/muted text, link, input, placeholder, code, and status colors.
- Use local PNG, JPEG, or WebP backgrounds, portraits, and decorative assets.
- Configure system fonts or package-local WOFF2 UI and code fonts.
- Control appearance, focal point, scale, blur, brightness, overlay, and text safe area.
- Configure transparency and glass effects for base panels, elevated surfaces, and terminals.
- Use a template-based module layout for allowed ordering, spacing, density, and width changes.
- Preview both the home screen and task workspace in isolation.
- Keep property changes local until **Save version** is explicitly selected.
- Keep exactly one draft per theme, with an explicit **Load existing draft / Overwrite existing draft** choice.
- Import, export, and install `.ocskin` packages from Theme Studio or the Runtime CLI.
- Preserve the previous appearance or enter an explicit recovery state when application fails.

## Full UI coverage

OpenChatGPTSkin is not a home-page wallpaper overlay. The Runtime uses a shared surface contract to recognize and theme the major UI surfaces in the current Codex Desktop build:

| Area | Covered examples |
|---|---|
| App shell | Main window, title bar, sidebar, top bar, application menu |
| Home and modes | Hero, suggestion cards, project picker, composer, Codex/ChatGPT, Chat/Work switcher |
| Tasks and history | Task workspace, history, resource/file cards, right sidebar, terminal, bottom panel |
| Feature pages | Search, plugins, scheduled tasks, pull requests, sites, toolbars and search fields |
| Settings | Settings navigation and panels, plugin list, environments, worktrees, form controls |
| Overlays | Menus, model selector, list boxes, dialogs, side panels, and scroll fades |

<table>
  <tr>
    <td width="33%"><img src="docs/assets/screenshots/surface-chatgpt-work.webp" alt="Themed ChatGPT Work view"></td>
    <td width="33%"><img src="docs/assets/screenshots/surface-plugins.webp" alt="Themed Plugins settings"></td>
    <td width="33%"><img src="docs/assets/screenshots/surface-settings.webp" alt="Themed Codex settings"></td>
  </tr>
  <tr>
    <td align="center">ChatGPT / Work</td>
    <td align="center">Plugins</td>
    <td align="center">Settings</td>
  </tr>
</table>

> Codex updates may change its internal DOM. The Runtime rejects unverified structures instead of silently injecting into them. Adapt a new Codex build by running the compatibility probe and adding deterministic page fixtures/tests.

## Built-in themes

Each built-in theme includes a complete theme document, preview, provenance record, and SHA-256 hashes. All five are ready after a clean checkout. The first four use project-original AI backgrounds; Yua Mikami Starlight uses separately authorized portrait and generated assets that are not covered by the project MIT License.

> The current Git source includes the fifth theme. Published `v0.1.0` binaries still contain the original four-theme set; the fifth theme will enter installers in the next release.

### Future Idol `future-idol-cyan`

A bright cyan, silver, and restrained magenta sci-fi theme. The focal subject stays on the right while the left side remains a safe area for UI text.

![Future Idol theme](docs/assets/screenshots/future-idol-cyan.webp)

### Rose Carpet Star `rose-carpet-star`

A warm rose-gold, champagne, and burgundy theme with light translucent panels for an elegant desktop appearance.

![Rose Carpet Star theme](docs/assets/screenshots/rose-carpet-star.webp)

### Mountain Mist `mountain-mist`

A light natural theme built around sunrise, clouds, and forest-green mountains, tuned for comfortable long sessions.

![Mountain Mist theme](docs/assets/screenshots/mountain-mist.webp)

### Glacier Aurora `glacier-aurora`

A dark navy, glacial cyan, and aurora-violet theme for low-light environments and users who prefer high contrast.

![Glacier Aurora theme](docs/assets/screenshots/glacier-aurora.webp)

### Yua Mikami Starlight `yua-mikami-starlight`

A dark immersive theme built from soft-pink neon, starlight, and an authorized portrait background. It uses Theme Schema v4 localized dynamic welcome text, real project-name interpolation, four independent suggestion icons, a profile avatar, and four non-interactive visual layers. Its display typography uses lightweight `Arial` plus normal system glyph fallback instead of bundling an oversized font.

![Yua Mikami Starlight theme concept](docs/assets/concepts/yua-mikami.png)

Portrait and decoration assets carry separate authorization identifiers and source hashes. Read the generated theme `LICENSE.md`; do not treat these assets as MIT-licensed.

## Installation

### Windows Setup (recommended)

1. Download `OpenChatGPTSkin_0.1.0_windows_x64_Setup.exe` and `checksums.txt` from [GitHub Releases](https://github.com/u2bo/OpenChatGPTSkin/releases).
2. Verify SHA-256, then run Setup. It installs for the current user under `%LOCALAPPDATA%\Programs\OpenChatGPTSkin` and does not request administrator privileges.
3. Start OpenChatGPTSkin from the Start menu. The production Theme Studio opens in your default browser only after its local health check succeeds.

The installer is unsigned, so Windows SmartScreen may warn. Download only from this project's GitHub Release and compare against `checksums.txt`. Choose **More info → Run anyway** only after you have verified the source and hash.

### Windows portable ZIP

Download `OpenChatGPTSkin_0.1.0_windows_x64.zip`, verify it, extract it to a stable writable directory, and double-click `OpenChatGPTSkin.cmd`. The portable build does not register an installation and needs no global Node.js or Git. Personal themes remain under `%LOCALAPPDATA%\OpenChatGPTSkin`, outside the program directory.

### macOS DMG (unsigned developer preview)

1. On Apple Silicon (M-series), download `OpenChatGPTSkin_0.1.0_macos_arm64.dmg`. On an Intel Mac, download `OpenChatGPTSkin_0.1.0_macos_x64.dmg`. Intel x64 compatibility depends on an official Codex build for that architecture and has not completed real-device validation.
2. Verify SHA-256 as shown below, open the DMG, and drag `OpenChatGPTSkin.app` to Applications.
3. On first launch, Control-click the app, choose **Open**, and confirm the standard macOS prompt. Do not disable Gatekeeper or use `xattr` to remove quarantine metadata.
4. Theme Studio opens in the default browser after its health check succeeds. Replacing or deleting the `.app` keeps personal themes, drafts, and Runtime state under `~/Library/Application Support/OpenChatGPTSkin`.

Developers can also download `OpenChatGPTSkin_0.1.0_macos_arm64.tar.gz` or `OpenChatGPTSkin_0.1.0_macos_x64.tar.gz`. Most users should choose the DMG.

Maintainers can open **Actions → Build and Release → Run workflow** and manually trigger `workflow_dispatch`. GitHub-hosted Windows, ARM64 macOS, and Intel macOS runners build Windows x64, macOS ARM64, and macOS x64 test artifacts. Download `windows-release`, `macos-arm64-release`, `macos-x64-release`, and their diagnostics from the completed run. A manual run never creates a tag or GitHub Release.

### Verify downloads

Run from the download directory:

```powershell
Get-FileHash .\OpenChatGPTSkin_0.1.0_windows_x64.zip -Algorithm SHA256
Get-FileHash .\OpenChatGPTSkin_0.1.0_windows_x64_Setup.exe -Algorithm SHA256
Get-Content .\checksums.txt
```

macOS Terminal:

```bash
shasum -a 256 OpenChatGPTSkin_0.1.0_macos_arm64.dmg
# On Intel:
shasum -a 256 OpenChatGPTSkin_0.1.0_macos_x64.dmg
cat checksums.txt
```

Each hash must exactly match the corresponding line in `checksums.txt`. Do not run a mismatched artifact.

### Install from source

Source development requires Windows 11 or macOS, official Codex Desktop, Node.js `>= 22.0.0`, and npm. Git can be replaced with a downloaded source archive.

Clone or download the repository from GitHub, then run from its root:

```powershell
git clone https://github.com/u2bo/OpenChatGPTSkin.git
cd OpenChatGPTSkin
npm ci
npm run verify:foundation
```

`verify:foundation` rebuilds the catalog, runs tests and type checking, builds the workspace, and validates all five built-in themes. Source-mode commands run from the repository root.

When upgrading from the pre-rename development build, the first CLI or Theme Studio start atomically adopts the previous personal themes, drafts, and Runtime state only when the new-brand data directory does not exist. If both directories exist, the new directory wins and neither side is merged or overwritten.

Installing a newer Setup, replacing a portable directory, or replacing the macOS `.app` updates program files without moving or overwriting `%LOCALAPPDATA%\OpenChatGPTSkin` or `~/Library/Application Support/OpenChatGPTSkin`. Windows uninstall keeps personal themes, drafts, versions, and Runtime state by default. The data directory is removed only when an interactive uninstall explicitly selects deletion and confirms the irreversible warning.

## Quick start

### Theme Studio (recommended)

1. Save your work and choose **Quit Codex** from the Codex menu or system tray. Make sure the regular app is fully closed.
2. Windows Setup users launch from the Start menu, portable users double-click `OpenChatGPTSkin.cmd`, macOS users launch `OpenChatGPTSkin.app` from Applications, and source users run:

   ```powershell
   npm run studio:dev
   ```

3. Release builds open the browser after the random `127.0.0.1` service passes its health check. Source development mode prints the URL for manual opening.
4. Select a built-in theme. Theme Studio enters the editor immediately when no draft exists. If a draft already exists, choose **Load existing draft** or **Overwrite existing draft**; Cancel leaves the theme library unchanged.
5. Edit colors, background, typography, decorations, or safe module layout, and preview the home/task views.
6. Select **Save version**. Property edits do not create versions automatically.
7. Select **Apply to Codex**. Theme Studio sends the exact saved `{id, version}` to the Runtime.
8. Use **Restore original skin** when you want the official appearance back. Source developers may also run `npm run runtime -- restore`.

Theme Studio links to `https://github.com/u2bo/OpenChatGPTSkin.git` by default. Fork and mirror maintainers may set `OPEN_CHATGPT_SKIN_REPOSITORY_URL` before a source launch; only `https://github.com/` URLs are accepted.

### Runtime directly (source developers)

```powershell
npm run runtime -- list-themes
npm run runtime -- launch --theme mountain-mist
npm run runtime -- switch --theme glacier-aurora
npm run runtime -- status
```

The regular Codex app must be fully closed before `launch`. The Runtime manages only the instance it launches and never attaches to or force-closes an existing Codex process.

## Custom themes

Read the complete [Custom Theme Guide](docs/custom-theme-guide.en.md). It documents two supported paths:

1. **AI-assisted packaging**: give a background, visual direction, and rights information to Codex or another coding agent, then use the copy-ready prompt to create, validate, and pack an `.ocskin` file.
2. **Theme Studio UI**: start from a built-in theme and visually configure colors, background, typography, decorations, and layout.

See [Theme Format and Safety Rules](docs/theme-format.md) for the complete schema and limits.

### Import and export `.ocskin`

Theme Studio imports and exports `.ocskin` packages. The Runtime can also install a package from an explicit file:

```powershell
npm run runtime -- import --theme-file "D:\Themes\personal-theme.ocskin"
```

Import validates the schema, media signatures, size limits, manifest hashes, and Zip Slip safety. It does not start the Controller or connect to Codex.

## Runtime commands

These commands are for source developers. Setup and portable users can apply, switch, and restore themes from Theme Studio.

```powershell
npm run runtime -- list-themes
npm run runtime -- import --theme-file "D:\Themes\personal-theme.ocskin"
npm run runtime -- launch --theme mountain-mist
npm run runtime -- switch --theme glacier-aurora
npm run runtime -- pause
npm run runtime -- resume
npm run runtime -- status
npm run runtime -- restore
```

- `pause` retains the selected theme but stops projecting it into page DOM.
- `resume` reapplies the selected theme.
- `restore` restores the official appearance and waits for a normal managed-Codex exit to finish cleanup.
- Do not use Task Manager to force-close Codex while restore is pending.

See [Windows Runtime and Compatibility](docs/runtime-windows.md) and [macOS Runtime and Acceptance](docs/runtime-macos.en.md) for the platform safety boundaries. macOS DMGs complete package, bundled-Runtime, Theme Studio, and four-theme acceptance on native ARM64/x64 runners. Real-Codex Runtime probes and visual-loop acceptance still require the manual real-device checklist.

### Compatibility probe and real-app acceptance (Windows)

After a Codex update, fully quit the regular app and run the two-phase compatibility probe:

```powershell
npm run runtime:probe -- --record-evidence
# Quit the managed Codex instance normally from the Codex menu
npm run runtime:probe -- --finalize
```

For a release candidate, run the full Runtime acceptance flow:

```powershell
npm run runtime:acceptance -- --begin
# Quit managed Codex normally, then start official Codex normally from Start
npm run runtime:acceptance -- --finalize
```

Acceptance evidence must remain sanitized and must not contain PIDs, ports, paths, command lines, project names, chat content, or screenshots.

macOS packages receive automated acceptance on native CI runners; the real-Codex visual and Runtime loop still uses a manual checklist. On a real Mac, verify `codesign`, `spctl`, Unix-socket permissions, all five built-in themes, restore, and a regular Codex restart as described in [macOS Runtime and Acceptance](docs/runtime-macos.en.md).

## FAQ

### What does `The Runtime command was rejected safely` mean?

The Runtime refused to proceed because an identity, state, or lifecycle safety condition was not satisfied. Run:

```powershell
npm run runtime -- status
```

Fully quit the regular Codex app through **Quit Codex**, then retry the original command. Do not use Task Manager or Force Quit to terminate a managed instance. Structured failures are not hidden by a silent fallback.

### Why can I not install this from the Codex Plugins page?

OpenChatGPTSkin is a separate local Theme Studio and Desktop Runtime, not a Codex plugin-market plugin. Windows users install the Setup or portable ZIP; macOS users install the DMG for their architecture. It does not modify Codex installation files and does not appear in the Codex Plugins page.

### Why is **Apply to Codex** disabled after an edit?

Theme Studio does not auto-save versions. Resolve contrast or asset validation errors and choose **Save version** first. Only an exact saved version can be applied or exported.

### Why can preview and the real Codex app differ?

Preview and Runtime share the same color, background, surface, and safe-layout model, but a Codex update may change internal structure. Open an issue with the Codex version, page route, reproduction steps, and a sanitized screenshot. Do not hide the mismatch with arbitrary CSS or fragile selectors.

### Can I use remote images, commercial fonts, celebrities, or copyrighted characters?

Theme packages accept local assets only, not remote URLs. You must have the right to use and redistribute every image, font, and likeness. When rights are uncertain, keep `localOnly: true` and do not publish the `.ocskin` file.

### How do I restore the official appearance?

Use **Restore original skin** in Theme Studio or:

```powershell
npm run runtime -- restore
```

Then quit Codex normally through its menu or system tray to complete cleanup.

## Repository layout

```text
apps/theme-studio/            Theme Studio React frontend
packages/theme-schema/        Theme Schema v4, migrations, and visual model
packages/theme-core/          Validation, catalog, archive, storage
packages/cdp-adapter/         Codex UI surface recognition and compilation
packages/theme-studio-core/   Theme Studio contracts and validation
runtime/windows/              Desktop Runtime, Controller, recovery (historical package path)
runtime/theme-studio-service/ Local Theme Studio service
themes/builtin/               Built-in themes and asset provenance
tests/                        Schema, Runtime, UI, and documentation tests
```

## Contributing

Contributions are welcome for themes, new Codex-build adaptation, tests, documentation, accessibility, and installation UX. Read [CONTRIBUTING.md](CONTRIBUTING.md#english) before opening a pull request.

```powershell
npm ci
npm run test
npm run typecheck
npm run build
```

UI adaptation changes must include deterministic page fixtures/tests. Theme contributions must include provenance, rights, generation prompt or creative brief, and asset hashes. Never attach chat content, real project names, usernames, local paths, ports, tokens, or other sensitive data to issues or pull requests.

## Documentation

- [v0.1.0 Release Notes](docs/releases/v0.1.0.md)
- [v0.1.0-alpha.1 Historical Release Notes](docs/releases/v0.1.0-alpha.1.md)
- [Custom Theme Guide](docs/custom-theme-guide.en.md)
- [Theme Studio Developer Guide](docs/theme-studio.md)
- [Theme Format and Safety Rules](docs/theme-format.md)
- [Windows Runtime and Compatibility](docs/runtime-windows.md)
- [macOS Runtime and Acceptance](docs/runtime-macos.en.md)

## License

Source code and project documentation are available under the [MIT License](LICENSE). Built-in theme backgrounds, previews, source images, and product screenshots are not automatically covered by MIT; they remain subject to each theme's `LICENSE.md`, theme `rights` metadata, and the relevant asset-owner permissions. Users are responsible for the rights and redistribution status of imported assets.

## Disclaimer

OpenChatGPTSkin is a community project and is not affiliated with or endorsed by OpenAI. “Codex,” “ChatGPT,” and related product names belong to their respective owners. The project does not modify official installation packages, bypass signatures, or access account/API credentials. Codex updates may still require a Runtime adapter update.
