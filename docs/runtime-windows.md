# Windows Runtime、发布包与兼容性验收

[返回 README](../README.md)

`v0.3.0-alpha.1` 的 Windows 生产包使用单一 Go Host 承担 Theme Studio、Controller 与 Runtime 角色。便携 ZIP 和当前用户 Setup 均不包含 Node.js 或 Node 业务 `node_modules`；React/Vite 前端、Theme/Contract 作者源与 TypeScript CDP Adapter 只在构建阶段使用。

## 安装与数据目录

- Setup 默认安装到 `%LOCALAPPDATA%\Programs\OpenChatGPTSkin`，不请求管理员权限；
- 便携 ZIP 解压后运行 `OpenChatGPTSkin.exe`；
- 用户数据位于 `%LOCALAPPDATA%\OpenChatGPTSkin`，覆盖安装和默认卸载不会删除个人主题、草稿或版本；
- 未签名安装包可能触发 SmartScreen，只应从项目 GitHub Release 下载并先核对 `checksums.txt`。

发布包必须包含 `release-manifest.json` schema v2。Manifest 记录 Go Host 版本/提交/入口 Hash、Contract Hash、CDP Adapter Hash、五个内置主题和 Stage 中每个文件的 SHA-256，并明确声明空 sidecar；验收会拒绝 `node.exe`、`node` 或 `node_modules`。

## 源码开发命令

源码开发需要 Windows 11、Go `1.25.12`、Node.js `>=22` 与 npm。Node 只用于前端、Contract 和 Adapter 构建，不进入用户包。

```powershell
npm run runtime -- list-themes
npm run runtime -- import --theme-file "D:\Themes\personal-theme.ocskin"
npm run runtime -- launch --theme mountain-mist
npm run runtime -- switch --theme glacier-aurora
npm run runtime -- launch --theme personal-theme --version 1.0.0
npm run runtime -- pause
npm run runtime -- resume
npm run runtime -- status
npm run runtime -- restore
```

五个内置主题是 `future-idol-cyan`、`glacier-aurora`、`mountain-mist`、`rose-carpet-star` 和 `yua-mikami-starlight`。内置主题可省略版本；个人主题必须使用 `--version <version>` 选择精确版本。

`list-themes` 与 `import --theme-file` 只访问主题仓库，不启动 Controller 或连接 Codex。导入仍经过 `.ocskin` Schema、大小、Hash 和路径安全校验，并原子安装到个人主题仓库。

## Runtime 行为

- `launch` 前必须完全退出普通 Codex；发现未受管理实例时会安全拒绝，不会接管或结束它；
- `switch` 只在受管理会话中切换主题；
- `pause` 移除主题投影但保留选择，`resume` 重新应用已选主题；
- `restore` 恢复官方外观并等待用户从 Codex 菜单或系统托盘正常退出；
- 不要通过任务管理器强制结束受管理实例，否则 Runtime 无法验证清理完成。

新版 Codex 在官方 App 激活期间可能短暂创建或交接根进程。Runtime 只有在官方包身份、唯一可信根、可见窗口和原回环 CDP 端口所有权同时成立后才继续，不依赖 PID 永远不变，也不会放宽为任意可执行文件或任意调试端点。

## 安全边界

- CDP 只允许 `127.0.0.1`，并验证端口属于受管理的官方 Codex 进程树；
- 主题不能携带 JavaScript、HTML、CSS、可执行文件、远程 URL、自定义 DOM 选择器或 CDP 地址；
- 不修改 `WindowsApps`、`app.asar`、官方签名、账号/API 配置、项目文件或聊天内容；
- 身份、Target、DOM Adapter、主题校验或恢复检查失败时返回结构化错误，不使用隐藏 fallback；
- Theme Studio 会把精确 `{id, version}` 交给同一个 Go Runtime，不存在 Node/Go 双写或第二业务后端。

## 真实 Windows 验收清单

在无私人项目或敏感聊天的测试工作区执行。当前 `v0.3.0-alpha.1` 候选代码已完成一次 Windows x64 实机换肤与恢复验收；Codex 更新后仍必须重新执行本清单。

1. 校验 Setup/ZIP SHA-256，分别完成安装/启动；确认 Theme Studio 能打开且用户数据不写入程序目录。
2. 完全退出普通 Codex，依次应用五个内置主题；检查首页、历史、任务、设置、插件、菜单、弹层、输入框、侧边栏和终端。
3. 导入并应用一个包含自定义背景、颜色、字体、装饰、头像、建议图标和项目图标的 `.ocskin`。
4. 执行 `pause`、`switch`、`resume`，确认暂停时官方外观可见，恢复时只应用已选主题。
5. 执行 `restore`，确认官方外观恢复；从 Codex 菜单或系统托盘正常退出，确认 Controller 清理完成。
6. 从开始菜单正常启动官方 Codex，确认未继承 `--remote-debugging-address` 或 `--remote-debugging-port`，且保持官方外观。
7. 验证覆盖安装和卸载默认保留 `%LOCALAPPDATA%\OpenChatGPTSkin` 下的个人主题、草稿与版本。
8. 记录 Codex/OpenChatGPTSkin/Windows 版本、主题结果和脱敏截图。公开记录不得包含 PID、端口、用户名、绝对路径、命令行、项目名或聊天内容。

旧 Node Host 的 `runtime:probe` 与 `runtime:acceptance` 已随 Go cutover 删除。历史脱敏证据 [codex-26.707.12708.0.json](runtime-probes/codex-26.707.12708.0.json) 只用于说明早期兼容性门，不是当前 Go 版本的自动验收结果，也不能替代上面的真实设备检查。

## 已知风险

- Codex 更新可能改变包身份、进程结构或 DOM surface contract，需要 Adapter 更新和重新验收；
- Windows 安装包尚未代码签名，SmartScreen 提示不会通过关闭系统安全功能规避；
- 尚未提供 Windows ARM64、自动更新、Codex 插件市场安装或单文件 SEA。
