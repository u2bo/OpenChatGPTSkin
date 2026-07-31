# 面向智能体的原生 Theme CLI 指南

OpenChatGPTSkin 的正式 Windows 和 macOS 构建物内置同一套 Theme CLI。智能体可以直接调用最终可执行文件创建、配置、检查、校验和打包主题；目标机器不需要安装 Node.js、npm、Go 或 Git。

## 调用入口

Windows 安装版或便携版：

```powershell
& "$env:LOCALAPPDATA\Programs\OpenChatGPTSkin\OpenChatGPTSkin.exe" theme contract
```

macOS App：

```bash
/Applications/OpenChatGPTSkin.app/Contents/MacOS/OpenChatGPTSkin theme contract
```

源码仓库中的 `npm run --silent theme -- contract` 只用于开发；交付给最终用户或其他智能体时，应传递原生可执行文件路径。

## 先读取契约

每次接入一个未知版本时，先执行 `theme contract`。它输出完整的机器可读 JSON，包括：

- `protocolVersion`、`contractVersion` 和 `themeSchemaVersion`；
- 受支持命令及参数；
- Theme、Draft 和 `.ocskin` Manifest JSON Schema；
- 大小限制、稳定错误码及归档验证用例；
- 成功与失败的输出流和退出码。

当前协议要求成功时向 stdout 写入一个 JSON 值且 stderr 为空；失败时向 stderr 写入一个 `{ "error": { "code", "message" } }` JSON 值。退出码 0 / 1 / 2 分别表示成功、命令失败和参数用法错误。自动化应依据退出码和稳定的 `error.code` 分支，不要匹配自然语言错误信息。

如果智能体不认识返回的 `protocolVersion` 或 `contractVersion`，应停止写入并请求升级适配器。不要假设未来版本仍接受当前字段。

## 完整工作流

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

`theme create` 只创建新目录，不覆盖已有路径。提供 `--background` 时会复制并校验 PNG、JPEG 或 WebP，创建可直接校验的完整主题；省略时生成可编辑草稿，应先使用 `theme validate --draft`。

`theme config` 接受 JSON Merge Patch。`null` 删除可选字段；对象递归合并；数组整体替换。补丁应用后会重新执行 Theme Schema 校验，并以原子方式写回 `theme.json`。先用 `theme show` 确认智能体的改动已被观察到，再执行 `theme validate`。

`theme pack` 和 `theme unpack` 都拒绝覆盖已有目标。成功打包后仍应解包到新目录并再次运行 `theme validate`，把归档往返纳入验收。

## 可直接执行的示例

- Windows PowerShell：[agent-workflow.ps1](../examples/theme-cli/agent-workflow.ps1)
- macOS/Linux POSIX shell：[agent-workflow.sh](../examples/theme-cli/agent-workflow.sh)
- JSON Merge Patch：[theme-patch.json](../examples/theme-cli/theme-patch.json)

PowerShell：

```powershell
.\examples\theme-cli\agent-workflow.ps1 -Executable .\OpenChatGPTSkin.exe -Background D:\Assets\background.png -ThemeDirectory D:\Themes\agent-demo -Archive D:\Themes\agent-demo.ocskin
```

macOS：

```bash
sh ./examples/theme-cli/agent-workflow.sh /Applications/OpenChatGPTSkin.app/Contents/MacOS/OpenChatGPTSkin ./background.png ./agent-demo ./agent-demo.ocskin
```

两个示例都拒绝删除或覆盖调用者已有目录与归档。若要重试，请由调用者选择新的目标路径或显式处理自己的旧产物。

## 仓库维护者黑盒验收

仓库维护者可以把任意 staged、便携版或已安装的原生可执行文件交给同一套黑盒验收：

```powershell
npm run theme:agent-acceptance -- --executable "D:\Apps\OpenChatGPTSkin\OpenChatGPTSkin.exe" --label "Windows portable Release"
```

```bash
npm run theme:agent-acceptance -- --executable "/Applications/OpenChatGPTSkin.app/Contents/MacOS/OpenChatGPTSkin" --label "macOS installed Release"
```

该命令会通过真实进程边界运行完整工作流，并覆盖含中文和空格的路径。除成功链路外，它还验证六个稳定失败分支：缺少必填参数返回 `CLI_ARGUMENT_INVALID`，背景文件缺失返回 `CLI_READ`，重复创建项目或归档返回 `CLI_WRITE`，删除 Theme 必填字段的无效配置返回 `THEME_SCHEMA_INVALID`，重复解包到已有目录也返回 `CLI_WRITE`。每个失败都必须只向 stderr 写入一个 JSON 错误对象，并使用 Contract 声明的退出码。

这个 npm 入口只供源码仓库中的发布与回归验证使用；发布应用本身仍不依赖 Node.js，智能体和最终用户只需原生 OpenChatGPTSkin 可执行文件。命令成功时会向 stdout 输出机器可读的验收证据，包含 Contract 版本、成功工作流、路径覆盖和失败场景。

## 智能体安全边界

- 只把用户明确授权的本地素材传给 `--background`；不要扫描用户目录寻找图片。
- 不修改安装目录、内置主题、ChatGPT/Codex 程序文件或用户账号配置。
- 不绕过格式、路径、签名、Hash 或大小校验；把 CLI 错误原样作为结构化失败处理。
- 创建前确认目标不存在，发布前校验 `.ocskin` 和 `checksums.txt`，不要自动上传主题或素材。

字段、资源路径和归档限制的说明见 [Theme 格式](theme-format.md)。
