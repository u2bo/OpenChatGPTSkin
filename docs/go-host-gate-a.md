# Go Host Gate A 决策记录

## 决策

**状态：开发继续，发布未批准。**

2026-07-24，项目负责人明确要求不以 Gate A 阻断后续 Go Host tickets。因此允许继续实现 Ticket 06–16，并保持 `feat/go-host` 作为隔离开发分支。

此决定不是 `v0.3.0-alpha.1` 的发布、cutover 或删除 Node 生产宿主的批准。任何发布入口切换仍须完成本文件列出的原生验收和回滚证据。

## 已确认的证据

- v0.2.0 发布、协议、主题与数据格式基线已冻结。
- Studio v2、Runtime v1、Theme v4 与 Data v1 contract 已生成并由 Node baseline corpus 覆盖。
- 单 Go 二进制的 Studio、Controller、Runtime Spike 已在 Windows 本地测试；控制通道、锁、图片处理与包体均有自动化测试。
- Windows ZIP/Setup 与 macOS ARM64/x64 tar.gz Spike 产物均小于 v0.2.0 对应基线。
- 选定图片实现为 CGo-free 的 `gen2brain-webp-wasm2go-nodynamic-plus-internal-pipeline`，不引入长期 native sidecar。

机器可读包体、许可证与安全扫描记录见 `contracts/baseline/v0.2.0/go-spike-sizes.json`。

## 未完成的 Gate A / 发布门槛

- macOS ARM64 与 x64 必须在原生 Runner 产出 Unix socket 往返、App Bundle、DMG 和安装包 evidence。
- Go 1.25.5 的可达标准库漏洞必须升级到已修复的安全补丁版本后重新扫描。
- 所有六类产物必须以同一候选提交生成、验收并保存精确 SHA-256。
- Ticket 15 的真实 ChatGPT/Codex 三平台主题、恢复和 Go → Node 回滚验收不得以 CI fixture 或跨编译代替。

## 不变量

- 不引入长期 Node fallback、Node/Go 双写或平台功能分叉。
- 不把开发连续实施误报为真实设备兼容或可发布版本。
- 任何安全拒绝、未知数据或原生验收失败都保持显式错误和可恢复证据。
