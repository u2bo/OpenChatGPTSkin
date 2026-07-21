# macOS Runtime and Real-Mac Acceptance (Developer Preview)

[简体中文](runtime-macos.md) · [Back to README](../README.en.md)

OpenChatGPTSkin now has a macOS Runtime adapter. Theme Studio, the theme engine, CDP Adapter, Controller, and recovery state machine are shared with Windows. A macOS provider owns application discovery, process inspection, launching, directory permissions, and the local control channel.

> [!WARNING]
> The implementation passes TypeScript, unit tests, and macOS command-contract tests on Windows. It has not yet completed the visual Codex loop on a real Mac. Publish it as a developer preview; do not treat expected behavior in this document as real-device evidence.

GitHub Actions assembles bundled Node.js, native `sharp`, the single-file Theme Studio, and all four themes on separate macOS x64 and ARM64 runners, then runs the same portable Release Acceptance used for Windows. These builds remain CI contract artifacts only. They are not attached to a public GitHub Release until the real-device, signing, notarization, and Gatekeeper checklist on this page is complete.

## Requirements

- A Mac with the official Codex Desktop app installed.
- The app at `/Applications/Codex.app` or `~/Applications/Codex.app`.
- Node.js `>=22.0.0` with npm.
- `npm ci` completed at the repository root.
- Before applying a theme, choose **Quit Codex** and ensure the regular app has fully exited.

OpenAI's official troubleshooting manual retains this Codex App compatibility path:

```bash
/Applications/Codex.app/Contents/Resources/codex --version
```

It also documents the macOS app log directory as `~/Library/Logs/com.openai.codex/YYYY/MM/DD`. See [OpenAI Codex troubleshooting](https://learn.chatgpt.com/docs/troubleshooting). The Runtime does not hard-code the GUI executable name; it reads `CFBundleExecutable` from `Contents/Info.plist`.

## Usage

The commands are the same on both platforms:

```bash
npm run studio:dev
npm run runtime -- list-themes
npm run runtime -- launch --theme mountain-mist
npm run runtime -- switch --theme glacier-aurora
npm run runtime -- status
npm run runtime -- pause
npm run runtime -- resume
npm run runtime -- restore
```

Import a local theme with:

```bash
npm run runtime -- import --theme-file "$HOME/Themes/personal-theme.ocskin"
```

`launch` starts a managed instance only when no regular Codex root is running. After `restore`, quit from the Codex menu; do not use Force Quit or `kill -9`.

## Security boundary

- Validate `CFBundleIdentifier=com.openai.codex`, the expected Apple Team ID, deep `codesign --verify --deep --strict`, and the `spctl` notarization result together.
- Derive the GUI entry from the verified bundle's `CFBundleExecutable`; never accept an arbitrary executable path from the command line.
- Require CDP to listen only on `127.0.0.1`, then trace the `lsof` owner through its process ancestors to the managed Codex root.
- Store Runtime data in `~/Library/Application Support/OpenChatGPTSkin`; directories must be owned by the current UID with mode `0700`.
- Use `/tmp/OpenChatGPTSkin-<identity-hash>.sock` without exposing the raw UID; the socket must be owned by the current UID with mode `0600`.
- Never modify `Codex.app`, `app.asar`, account/API settings, project files, or chat content.
- Fail with a structured error on any identity, signature, notarization, endpoint, process-tree, DOM, or cleanup mismatch; do not silently fall back.

Enumerating macOS windows normally requires Accessibility consent. OpenChatGPTSkin does not request that broad permission for theming. Activation readiness is established by bundle activation, the managed root, and its loopback CDP process tree.

## Platform differences

| Capability | Windows | macOS |
|---|---|---|
| Install source | Appx registration | `.app` under `/Applications` or `~/Applications` |
| Identity | Appx Manifest, signatures, BlockMap | Info.plist, Developer ID, deep codesign, notarization |
| Local control | Named Pipe secured to current user + SYSTEM | Unix socket owned by current UID, mode `0600` |
| Data root | `%LOCALAPPDATA%\OpenChatGPTSkin` | `~/Library/Application Support/OpenChatGPTSkin` |
| Automated Probe/Acceptance | Available | Not yet; use the manual checklist |

The historical path and package name `runtime/windows` / `@open-chatgpt-skin/windows-runtime` remain for compatibility and to avoid an unrelated repository-wide move. Its Controller and public provider interface are now platform-neutral.

## Real-Mac acceptance checklist

Use a test account/workspace with no private projects or sensitive chats:

1. Fully quit Codex, then run `npm run build` and the macOS-related tests.
2. Verify the official identity:

   ```bash
   /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' /Applications/Codex.app/Contents/Info.plist
   /usr/bin/codesign -dv --verbose=4 /Applications/Codex.app 2>&1
   /usr/bin/codesign --verify --deep --strict /Applications/Codex.app
   /usr/sbin/spctl --assess --type execute --verbose=4 /Applications/Codex.app
   ```

3. Run `launch` and three `switch` commands. Check all four built-in themes across home, history, tasks, settings, plugins, menus, overlays, composers, sidebars, and terminal.
4. Run `pause` and `resume`. Pause must remove projection; resume must reapply only the selected theme.
5. Run `restore`, verify the official appearance, and quit from the Codex menu so cleanup can finish.
6. During the run, `ls -l /tmp/OpenChatGPTSkin-*.sock` must show a current-user `srw-------` socket. The endpoint must disappear after Controller exit.
7. Start official Codex normally. It must not inherit `--remote-debugging-address` or `--remote-debugging-port`, and the regular app must remain unthemed.
8. Record Codex/macOS versions, four-theme results, restore result, and sanitized screenshots. Do not record PIDs, ports, usernames, paths, command lines, project names, or chat content.

`npm run runtime:probe` and `npm run runtime:acceptance` currently return `RUNTIME_ENVIRONMENT_INVALID` on macOS. That is an explicit platform boundary, not a silent downgrade.

## Known risks

- Codex updates may change signing metadata, process structure, or DOM surface contracts and require adapter updates plus new acceptance.
- The first real-Mac run must confirm that the Apple Team ID in code matches the current official Codex signature. If it differs, verify the official source first; never weaken the policy to accept any valid signature.
- Do not claim complete macOS compatibility or full real-app UI validation before this checklist is completed on a Mac.
