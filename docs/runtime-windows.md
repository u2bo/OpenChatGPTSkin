# Windows 兼容性门（实验性）

> Runtime 控制器更新（以本节为准）：当前仓库提供开发者预览命令与自动化测试，但尚未在本文档中声明真实 Codex 的视觉验收或本机 `runtime:acceptance` 证据已经完成。下面较早的 Probe 流程仍用于 Codex 包升级后的兼容性检查。

## Runtime 控制器开发者用法

前提：Windows 11、Node.js `>=22`、依赖已安装。先保存工作并完全退出普通 Codex；若发现普通实例仍在运行，Runtime 会拒绝接管，不会结束该实例。

新版 Codex 在官方 AUMID 激活期间可能短暂创建第二个同包根进程，或把窗口与 CDP
交接给新根。Runtime 不依赖 PID 必须保持不变，而是等待进程集合收敛，并要求最终根
唯一、入口路径仍等于已验证的官方 Appx 入口、可见窗口属于最终根进程树、原回环 CDP
端口也属于最终根进程树。只有四项同时成立才会更新受管会话并继续应用主题。

```powershell
npm run runtime -- list-themes
npm run runtime -- import --theme-file "D:\\Themes\\personal-theme.ocskin"
npm run runtime -- launch --theme mountain-mist
npm run runtime -- switch --theme glacier-aurora
npm run runtime -- pause
npm run runtime -- resume
npm run runtime -- restore
```

可用主题为 `future-idol-cyan`、`rose-carpet-star`、`mountain-mist`、`glacier-aurora`。`import --theme-file` 会使用现有 `.ocskin` 安全校验并原子安装个人主题，不启动 Controller；导入后使用 `launch` 或 `switch` 的 `--theme <id> --version <version>` 形式选择精确版本。`pause` 会移除已应用皮肤；暂停期间 `switch` 只更新选择，不修改 DOM；`resume` 才重新应用选择。`restore` 恢复官方外观后进入等待退出状态，不能继续切换主题。请从 Codex 菜单或系统托盘执行“退出 / Quit Codex”，不要使用任务管理器强制结束。

## 两阶段 Runtime 验收

自动化验收会通过固定公开控制协议验证四主题、12 条有向切换、暂停后切换、恢复、性能阈值和正常启动无远程调试参数。它只生成严格脱敏的 evidence，绝不写入 PID、端口、用户名、路径、命令行、WebSocket URL、项目内容、聊天内容或截图。

```powershell
npm run runtime:acceptance -- --begin
# 完全退出受控 Codex；从 Windows 开始菜单正常启动 Codex
npm run runtime:acceptance -- --finalize
```

`--begin` 后不得使用任务管理器结束受控实例。`--finalize` 仅在旧根进程已退出、旧 CDP 端口关闭、且正常 Codex 没有 `--remote-debugging-address` / `--remote-debugging-port` 时写入 `docs/runtime-acceptance/codex-<packageVersion>.json`。正常启动的 Codex 不会被关闭。

Theme Studio 完整本地闭环已经提供，包括主题编辑、图片与字体上传、首页 / 任务双视图预览、版本保存、导入导出和精确版本 Runtime 应用。Runtime 会在路由变化和 portal 弹层创建后持续重标记任务、工作台、终端、应用菜单与弹层。安装器、SEA、MCP 和可安装插件仍是后续工作。兼容性 Probe 命令继续保留，用于 Codex 升级后的安全检查。

> 当前结论：Windows 兼容性门已通过。本页描述的是开发验证流程，不是面向最终用户的换肤功能。

## 已验证的范围

本机对已安装的官方 Codex Desktop 完成了一次两阶段兼容性探测，并生成与包版本绑定的脱敏证据。探测确认：

- 官方 Appx 身份链和受管进程树通过验证；
- CDP 只监听 `127.0.0.1`，不会接受局域网、IPv6 或主机名端点；
- 当前页面具有主内容区、导航区和输入区所需能力；
- 仅创建并移除无视觉影响的受控标记，`markerRoundTrip` 成功；
- 标记清理后官方外观仍然存在；
- 用户完全退出受管 Codex 后，受管根进程和 CDP 监听均已关闭；
- 从开始菜单正常启动 Codex 时，没有 `--remote-debugging-port` 参数。

这份结论只适用于已记录的 Codex 包版本。升级 Codex 后必须重新运行兼容性门；证据文件名由经过验证的包版本自动推导，不能由命令行指定。

## 安全边界

- 只管理由 OpenChatGPTSkin 本次探测明确启动的 Codex；发现普通运行中的 Codex 会拒绝接管，不会结束它。
- CDP 仅允许 `127.0.0.1`，并验证端口所属进程和官方 Codex 进程树。
- 不接受来自主题包或命令行的任意 CSS、JavaScript、HTML、DOM 选择器、可执行路径或 CDP URL。
- 不会修改 WindowsApps、`app.asar`、认证信息、API 配置、项目文件或聊天内容。
- 任何身份、端点、Target、DOM 适配或清理检查失败都会停止探测，并保持或恢复官方外观。
- 不要使用任务管理器强制结束 Codex；等待应用正常退出，或使用应用菜单/系统托盘中的“退出”。

## 复现兼容性探测

前提：Windows 11、Node.js `>=22.0.0`，并已在仓库根目录安装依赖。

1. 如需首次建立可信安装缓存，可在普通 Codex 仍打开时执行：

   ```powershell
   npm run runtime:probe
   ```

   该命令预期拒绝普通实例并返回 `CODEX_ALREADY_RUNNING_UNMANAGED`；这不是失败后的强制接管，也不会关闭应用。

2. 保存工作并完全退出普通 Codex。随后执行第一阶段探测：

   ```powershell
   npm run runtime:probe -- --record-evidence
   ```

   命令会通过官方 App 身份启动一个受管实例，完成无视觉标记往返并恢复官方外观。完成后它会保留该实例，等待用户手动完全退出。

3. 使用 Codex 的“退出 / Quit Codex”命令完全退出该实例。不要只关闭窗口，也不要使用任务管理器强制结束。

4. 执行第二阶段收尾：

   ```powershell
   npm run runtime:probe -- --finalize
   ```

   只有受管根进程与 CDP 监听都已关闭时，这一步才会写入 `docs/runtime-probes/codex-<packageVersion>.json`。如果返回 `PROBE_EXIT_PENDING`，说明应用尚未完全退出；此时会话保留，供用户完成正常退出后重试。

5. 从 Windows 开始菜单正常启动 Codex，确认其可用且没有调试参数。此步骤验证普通启动不会继承本次探测的 CDP 暴露。

## 脱敏证据

当前开发机的证据为 [codex-26.707.12708.0.json](runtime-probes/codex-26.707.12708.0.json)。它仅包含包身份和版本、Target 分类、能力布尔值以及退出/清理结果；不包含 PID、端口号、WebSocket URL、用户名、磁盘路径、命令行、项目内容、聊天内容或认证信息。

## 当前未交付的能力

尚未提供可安装的 Codex 插件、安装器或 SEA 打包。Theme Studio 已交付安全会话、三栏编辑器、用户素材处理、不可变版本、导入导出、受约束模块布局以及编辑后应用到真实 Codex 的闭环。

Runtime Adapter 已覆盖 Hero、建议卡、任务路由、审阅 / 终端 / 浏览器 / 文件工作区、应用菜单和 portal 弹层；不会通过修改官方安装目录、接受用户 DOM 选择器或扩大 CDP 暴露范围来缩短路径。Codex 升级后仍需重新运行兼容性门和真实视觉验收。
