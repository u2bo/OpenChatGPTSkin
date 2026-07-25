# Go Host Gate A 决策记录

## 决策

**状态：本地 cutover 已收口；本次不推送、不发布。**

2026-07-24，项目负责人明确要求不以 Gate A 阻断后续 Go Host tickets。因此允许继续实现 Ticket 06–16，并保持 `feat/go-host` 作为隔离开发分支。

后续 Ticket 06–16 已按该决定继续实施。默认开发、Runtime、构建和 Release workflow 已切换到 Go，Node 生产 Host 与下载/stage/launcher 已删除；是否推送或创建 Release 仍由项目负责人单独决定。

## 已确认的证据

- v0.2.0 发布、协议、主题与数据格式基线已冻结。
- Studio v2、Runtime v1、Theme v4、Data v1 与 Release Manifest v2 contract 已生成；v0.2.0 Node 结果只以 reviewed golden/corpus 只读保留，不再执行旧 Node Host。
- 单 Go 二进制的 Studio、Controller、Runtime 已在 Windows 本地完成单元、合约、类型、构建和原生包测试。
- 项目负责人已明确确认 Windows、macOS ARM64/x64、五主题、自定义主题、恢复、v0.2.0 数据升级及 Go → Node 回滚实机验收成功。该条证据来自人工验收确认，不冒充当前会话运行的自动化证据。
- 选定图片实现为 CGo-free 的 `gen2brain-webp-wasm2go-nodynamic-plus-internal-pipeline`，不引入长期 native sidecar。
- Go 工具链已固定为 `1.25.12`；2026-07-25 在 `host/go` 执行 `govulncheck ./...`，结果为 0 个代码可达漏洞。

## 发布前仍需完成

- 在同一候选提交上运行 GitHub `windows-latest`、`macos-15` 和 `macos-15-intel` 原生矩阵，生成并验收六类产物；当前本地会话没有运行这些远端 Jobs。
- 合并三平台报告后重新生成 `checksums.txt`，确认六类产物精确 SHA-256，再决定是否创建 prerelease。
- Codex 更新后重新执行 Windows/macOS 真实设备清单，不能沿用旧版本视觉结论。

## 不变量

- 不引入长期 Node fallback、Node/Go 双写或平台功能分叉。
- 不把开发连续实施误报为真实设备兼容或可发布版本。
- 任何安全拒绝、未知数据或原生验收失败都保持显式错误和可恢复证据。
