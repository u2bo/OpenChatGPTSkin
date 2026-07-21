# 参与贡献 / Contributing

[中文](#中文) · [English](#english)

## 中文

感谢你帮助改进 OpenChatGPTSkin。我们欢迎以下贡献：

- Codex 新版本 UI surface 适配；
- Theme Studio 体验、可访问性和性能；
- Runtime 安全性、恢复能力和 Windows/macOS 兼容性；
- Theme Schema、`.ocskin` 工具和测试；
- 原创、授权清晰的主题；
- 文档、翻译和问题复现。

### 开发环境

```powershell
npm ci
npm run verify:foundation
```

日常聚焦验证可以按顺序运行：

```powershell
npm run test
npm run typecheck
npm run build
npm run studio:build
```

### 提交 Issue

请包含：

- 操作系统与版本、Node.js 和 Codex 版本；
- 主题 ID/版本；
- 页面路径和最小复现步骤；
- 期望结果与实际结果；
- 已脱敏的截图或结构化错误码。

不要上传用户名、项目名、聊天内容、本地路径、PID、端口、命令行、令牌、账号或认证信息。

### 提交 Pull Request

1. 从最新分支创建聚焦的功能分支；
2. 先写或更新能复现问题的测试；
3. 从根因修复，不添加任意 CSS、用户选择器、静默 fallback 或强制结束 Codex 的逻辑；
4. 运行与改动直接相关的测试、类型检查和构建；
5. 在 PR 中说明用户可见变化、验证证据、兼容性影响和剩余风险。

UI surface 适配必须包含确定性的 HTML fixture/测试；不要依赖开发者机器上的真实聊天或项目数据。涉及 Codex 新版本时，保留身份验证、`127.0.0.1`、受管理实例和安全恢复不变量。macOS Runtime 改动还必须保留官方 bundle 签名/公证校验、当前 UID 身份和 `0600` Unix socket 权限，并说明是否在真实 Mac 上验收。

### 贡献主题

公共主题必须：

- 使用稳定的小写连字符 ID 和语义化版本；
- 通过 Theme Schema、素材、对比度和 Runtime-ready 校验；
- 提供作者、许可证、attribution、生成 Prompt/创作说明和素材 SHA-256；
- 不包含未授权人物、角色、Logo、字体或第三方素材；
- 在首页、任务、历史、设置、插件、菜单、输入和终端中可读；
- 能成功打包、导入、应用并恢复官方外观。

授权不确定的主题只能设置 `localOnly: true`，不应作为公共内置主题提交。

### 文档和语言

影响用户流程的改动需要同时更新中文默认 README 和英文 README；自定义主题流程同时更新两种语言的指南。命令、错误码和行为说明必须与当前代码一致。

### 行为准则

请保持尊重、具体和建设性。讨论技术事实和用户影响，不攻击个人，不发布他人的私人数据或未授权素材。维护者可以关闭骚扰、歧视、恶意披露或明显侵犯版权的内容。

## English

Thank you for helping improve OpenChatGPTSkin. Contributions are welcome in:

- UI surface adaptation for new Codex builds;
- Theme Studio UX, accessibility, and performance;
- Runtime safety, recovery, and Windows/macOS compatibility;
- Theme Schema, `.ocskin` tooling, and tests;
- Original themes with clear redistribution rights;
- Documentation, translation, and reproducible bug reports.

### Development setup

```powershell
npm ci
npm run verify:foundation
```

For focused day-to-day validation:

```powershell
npm run test
npm run typecheck
npm run build
npm run studio:build
```

### Issues

Include:

- operating system/version, Node.js, and Codex versions;
- theme ID/version;
- route and minimal reproduction steps;
- expected and actual behavior;
- a sanitized screenshot or structured error code.

Never attach usernames, project names, chat content, local paths, PIDs, ports, command lines, tokens, account data, or authentication information.

### Pull requests

1. Create a focused branch from the latest project branch.
2. Add or update a test that reproduces the behavior.
3. Fix the root cause; do not add arbitrary CSS, user selectors, silent fallbacks, or force-termination behavior.
4. Run directly affected tests, type checking, and builds.
5. Describe the user-visible change, evidence, compatibility impact, and remaining risk.

UI surface changes must include deterministic HTML fixtures/tests and must not depend on real chats or projects from a developer machine. New Codex-build support must preserve identity checks, loopback-only CDP, managed-instance ownership, and safe recovery. macOS Runtime changes must also preserve official bundle signature/notarization checks, current-UID identity, `0600` Unix-socket permissions, and must state whether they were accepted on a real Mac.

### Theme contributions

Public themes must:

- use a stable lowercase hyphenated ID and semantic version;
- pass schema, asset, contrast, and Runtime-ready validation;
- include author, license, attribution, generation prompt/creative brief, and asset SHA-256 records;
- contain no unlicensed people, characters, logos, fonts, or third-party assets;
- remain readable across home, tasks, history, settings, plugins, menus, composers, and terminals;
- pack, import, apply, and restore successfully.

Themes with uncertain rights must remain `localOnly: true` and should not be proposed as public built-ins.

### Documentation and language

User-flow changes should update both the default Chinese README and English README. Custom-theme workflow changes should update both language guides. Commands, error codes, and behavior descriptions must match current code.

### Conduct

Be respectful, specific, and constructive. Discuss technical facts and user impact rather than attacking people. Do not publish private data or unlicensed material. Maintainers may remove harassment, discrimination, malicious disclosure, or clear copyright infringement.
