# macOS Runtime 与实机验收（开发者预览）

[English](runtime-macos.en.md) · [返回 README](../README.md)

OpenChatGPTSkin 已实现 macOS Runtime 的平台适配：Theme Studio、主题引擎、CDP Adapter、Controller 和恢复状态机与 Windows 共用；安装发现、进程检查、启动、目录权限和本地控制通道由 macOS Provider 负责。

> [!WARNING]
> 当前实现已在 Windows 上通过 TypeScript、单元测试和 macOS 命令契约测试，但尚未在真实 Mac 上完成 Codex 视觉闭环验收。发布时应标记为开发者预览，不能把本页的“预期”当作实机通过证据。

GitHub Actions 会分别在 macOS x64 与 ARM64 Runner 组装内置 Node.js、原生 `sharp`、单 HTML Theme Studio 和四个主题，并运行与 Windows 相同的便携包 Release Acceptance。这些仅作为 CI contract artifact 保存；在本页实机、签名、公证和 Gatekeeper 清单完成前，不会附加到公开 GitHub Release。

## 前提

- 一台安装了官方 Codex Desktop 的 Mac；
- 官方 App 位于 `/Applications/Codex.app` 或 `~/Applications/Codex.app`；
- Node.js `>=22.0.0` 与 npm；
- 已在仓库根目录执行 `npm ci`；
- 应用主题前，通过 Codex 菜单执行 **Quit Codex**，确认普通 Codex 完全退出。

OpenAI 官方故障排查手册保留了以下 Codex App 兼容路径：

```bash
/Applications/Codex.app/Contents/Resources/codex --version
```

官方手册还给出 macOS App 日志目录：

```text
~/Library/Logs/com.openai.codex/YYYY/MM/DD
```

参考：[OpenAI Codex troubleshooting](https://learn.chatgpt.com/docs/troubleshooting)。Runtime 不硬编码 GUI 可执行文件名，而是从 `Contents/Info.plist` 的 `CFBundleExecutable` 读取入口。

## 使用方式

命令与 Windows 相同：

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

导入本地主题示例：

```bash
npm run runtime -- import --theme-file "$HOME/Themes/personal-theme.ocskin"
```

`launch` 只会在没有普通 Codex 根进程时启动受管理实例。`restore` 后请从 Codex 菜单正常退出，不要使用“强制退出”或 `kill -9`。

## 平台安全边界

- 通过 `CFBundleIdentifier=com.openai.codex`、Apple Team ID、深度 `codesign --verify --deep --strict` 和 `spctl` 公证结果共同验证官方 App；
- GUI 入口从已验证 App 的 `CFBundleExecutable` 推导，不接受命令行提供的任意可执行路径；
- CDP 必须只监听 `127.0.0.1`，并通过 `lsof` 与进程祖先链确认监听者属于受管理 Codex；
- Runtime 数据目录为 `~/Library/Application Support/OpenChatGPTSkin`，目录要求当前 UID 所有且权限为 `0700`；
- 控制端点为 `/tmp/OpenChatGPTSkin-<identity-hash>.sock`，不暴露原始 UID，socket 要求当前 UID 所有且权限为 `0600`；
- 不修改 `Codex.app`、`app.asar`、账号、API 配置、项目文件或聊天内容；
- 任何身份、签名、公证、端点、进程树、DOM 适配或清理验证失败都会结构化拒绝，不使用静默 fallback。

macOS 窗口枚举通常需要 Accessibility 权限。OpenChatGPTSkin 不为换肤请求该广泛权限；激活就绪由 bundle 激活、受管理根进程和其回环 CDP 进程树共同确认。

## 与 Windows 的差异

| 能力 | Windows | macOS |
|---|---|---|
| 安装来源 | Appx 注册 | `/Applications` 或 `~/Applications` 下的 `.app` |
| 身份验证 | Appx Manifest、签名、BlockMap | Info.plist、Developer ID、深度 codesign、公证 |
| 本地控制 | 当前用户 + SYSTEM ACL 的 Named Pipe | 当前 UID、权限 `0600` 的 Unix socket |
| 数据目录 | `%LOCALAPPDATA%\OpenChatGPTSkin` | `~/Library/Application Support/OpenChatGPTSkin` |
| 自动 Probe/Acceptance | 已提供 | 尚未提供，使用下方手动清单 |

仓库暂时保留历史目录和包名 `runtime/windows` / `@open-chatgpt-skin/windows-runtime`，避免在本次平台适配中进行无关的大范围搬迁；其中 Controller 和公共接口已经平台中立。

## 真实 Mac 验收清单

在没有私人项目或敏感聊天的测试账号/工作区执行：

1. 完全退出 Codex，运行 `npm run build` 和 macOS 相关测试。
2. 核对官方身份：

   ```bash
   /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' /Applications/Codex.app/Contents/Info.plist
   /usr/bin/codesign -dv --verbose=4 /Applications/Codex.app 2>&1
   /usr/bin/codesign --verify --deep --strict /Applications/Codex.app
   /usr/sbin/spctl --assess --type execute --verbose=4 /Applications/Codex.app
   ```

3. 依次执行 `launch`、三个 `switch`，检查四个内置主题在首页、历史、任务、设置、插件、菜单、弹层、输入框、侧边栏和终端中一致。
4. 执行 `pause` 与 `resume`，确认暂停完全移除投影、恢复只重新应用已选主题。
5. 执行 `restore`，确认官方外观恢复；从 Codex 菜单正常退出，使 Runtime 完成清理。
6. 检查控制 socket：

   ```bash
   ls -l /tmp/OpenChatGPTSkin-*.sock
   ```

   运行期间应为当前用户所有、权限 `srw-------`；Controller 退出后对应 socket 应被删除。
7. 正常启动官方 Codex，确认没有继承 `--remote-debugging-address` 或 `--remote-debugging-port`，且普通应用不受主题影响。
8. 记录 Codex 版本、macOS 版本、四主题结果、恢复结果和脱敏截图；不要记录 PID、端口、用户名、路径、命令行、项目名或聊天内容。

`npm run runtime:probe` 与 `npm run runtime:acceptance` 当前会在 macOS 返回 `RUNTIME_ENVIRONMENT_INVALID`，这是明确的平台边界，不是静默降级。

## 已知风险

- Codex 更新可能改变 bundle 签名信息、进程结构或 DOM surface contract，需要更新适配并重新验收；
- 首次实机验收必须确认代码中的 Apple Team ID 与当前官方 Codex 签名一致；不一致时应先核对官方来源，不能放宽为“接受任意有效签名”；
- 真实 Mac 验收完成前，不应发布“macOS 已完全兼容”或“所有 UI 已实机验证”的声明。
