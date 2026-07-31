# Native Theme CLI Guide for Agents

The production Windows and macOS builds of OpenChatGPTSkin include the same Theme CLI. An agent can invoke the final executable directly to create, configure, inspect, validate, and package a theme. The target machine does not need Node.js, npm, Go, or Git.

## Entry points

Windows installer or portable build:

```powershell
& "$env:LOCALAPPDATA\Programs\OpenChatGPTSkin\OpenChatGPTSkin.exe" theme contract
```

macOS app:

```bash
/Applications/OpenChatGPTSkin.app/Contents/MacOS/OpenChatGPTSkin theme contract
```

`npm run --silent theme -- contract` is only a source-checkout convenience. Give end users and other agents the native executable path.

## Discover the contract first

Run `theme contract` before integrating an unfamiliar build. Its machine-readable JSON includes:

- `protocolVersion`, `contractVersion`, and `themeSchemaVersion`;
- supported commands and arguments;
- the Theme, Draft, and `.ocskin` Manifest JSON Schemas;
- size limits, stable error codes, and archive validation cases;
- output streams and exit codes.

The current protocol writes exactly one JSON value to stdout on success and leaves stderr empty. On failure it writes one `{ "error": { "code", "message" } }` JSON value to stderr. The exit codes 0 / 1 / 2 mean success, command failure, and CLI usage error. Automation should branch on the exit code and stable `error.code`, never on the human-readable message.

If the agent does not recognize the returned `protocolVersion` or `contractVersion`, stop before writing and request an adapter update. Do not assume a future contract accepts today's fields.

## Complete workflow

```powershell
$Exe = "$env:LOCALAPPDATA\Programs\OpenChatGPTSkin\OpenChatGPTSkin.exe"
& $Exe theme contract
& $Exe theme create --dir D:\Themes\agent-demo --id agent-demo --name "Agent Demo" --author "Theme Agent" --appearance dark --background D:\Assets\background.png
& $Exe theme config --dir D:\Themes\agent-demo --patch .\examples\theme-cli\theme-patch.json
& $Exe theme show --dir D:\Themes\agent-demo
& $Exe theme validate --dir D:\Themes\agent-demo
& $Exe theme pack --dir D:\Themes\agent-demo --out D:\Themes\agent-demo.ocskin
& $Exe theme unpack --file D:\Themes\agent-demo.ocskin --out D:\Themes\agent-demo-unpacked
& $Exe theme validate --dir D:\Themes\agent-demo-unpacked
```

`theme create` only creates a new directory and never overwrites an existing path. With `--background`, it copies and validates a PNG, JPEG, or WebP and creates a complete theme. Without it, the result is an editable draft; use `theme validate --draft` first.

`theme config` accepts a JSON Merge Patch. `null` removes an optional field, objects merge recursively, and arrays replace the whole previous array. The CLI validates the patched Theme Schema and atomically writes `theme.json`. Use `theme show` to observe the agent's changes before running `theme validate`.

Both `theme pack` and `theme unpack` refuse to overwrite an existing target. After packing, unpack into a new directory and run `theme validate` again so archive round-tripping is part of acceptance.

## Executable examples

- Windows PowerShell: [agent-workflow.ps1](../examples/theme-cli/agent-workflow.ps1)
- macOS/Linux POSIX shell: [agent-workflow.sh](../examples/theme-cli/agent-workflow.sh)
- JSON Merge Patch: [theme-patch.json](../examples/theme-cli/theme-patch.json)

PowerShell:

```powershell
.\examples\theme-cli\agent-workflow.ps1 -Executable .\OpenChatGPTSkin.exe -Background D:\Assets\background.png -ThemeDirectory D:\Themes\agent-demo -Archive D:\Themes\agent-demo.ocskin
```

macOS:

```bash
sh ./examples/theme-cli/agent-workflow.sh /Applications/OpenChatGPTSkin.app/Contents/MacOS/OpenChatGPTSkin ./background.png ./agent-demo ./agent-demo.ocskin
```

Both examples refuse to delete or overwrite caller-owned directories and archives. To retry, the caller must choose fresh target paths or explicitly manage its own previous outputs.

## Repository maintainer black-box acceptance

A repository maintainer can run the same black-box acceptance against any staged, portable, or installed native executable:

```powershell
npm run theme:agent-acceptance -- --executable "D:\Apps\OpenChatGPTSkin\OpenChatGPTSkin.exe" --label "Windows portable Release"
```

```bash
npm run theme:agent-acceptance -- --executable "/Applications/OpenChatGPTSkin.app/Contents/MacOS/OpenChatGPTSkin" --label "macOS installed Release"
```

The command invokes the real process boundary through the complete workflow and uses paths containing both spaces and non-ASCII characters. It also verifies six stable failures: a missing required option returns `CLI_ARGUMENT_INVALID`, a missing background returns `CLI_READ`, existing project or archive targets return `CLI_WRITE`, a patch that removes a required Theme field returns `THEME_SCHEMA_INVALID`, and unpacking to an existing directory also returns `CLI_WRITE`. Every failure must write exactly one JSON error object to stderr and use the exit code declared by the Contract.

This npm entry point is only a source-repository release and regression tool; the released application itself remains Node-free, and agents or end users need only the native OpenChatGPTSkin executable. On success, the command writes machine-readable evidence to stdout with Contract versions, the successful workflow, path coverage, and failure scenarios.

## Agent safety boundary

- Pass only user-authorized local media to `--background`; do not scan user directories for images.
- Do not modify the install directory, built-in themes, ChatGPT/Codex application files, or account settings.
- Do not bypass format, path, signature, hash, or size validation. Treat CLI errors as structured failures.
- Confirm that targets do not exist before creating them. Validate `.ocskin` and `checksums.txt` before distribution, and never upload themes or media automatically.

See [Theme format](theme-format.md) for field, asset-path, and archive constraints.
