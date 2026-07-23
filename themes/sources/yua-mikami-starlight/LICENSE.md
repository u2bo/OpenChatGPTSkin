# 三上悠亚·星光粉素材授权说明

本文件记录作者源素材的授权边界。构建器会在生成目录中追加每个输出文件的 SHA-256。

## 人物背景

- 文件：`assets/background.png`
- 授权标识：`LicenseRef-OpenChatGPTSkin-Authorized-Portrait`
- 来源：由项目维护者提供，并确认可在 OpenChatGPTSkin 主题包中公开分发。
- 限制：该人物肖像及衍生裁剪不适用 MIT、SIL OFL 或其他开源代码许可证；不得据此推定肖像权或商业代言授权扩大到本项目之外。

## 建议卡片图标

- 文件：`assets/suggestion-card1.png` 至 `assets/suggestion-card4.png`
- 图形：Phosphor Icons `MagicWand`、`Gift`、`Code`、`Heart`
- 包版本：`@phosphor-icons/react@2.1.10`
- 上游许可证：MIT
- 来源：<https://github.com/phosphor-icons/core>
- 处理：使用主题粉色和柔光效果渲染为透明 PNG。

## 装饰素材

- 文件：`hero-signature.png`、`corner-signature.png`、`vertical-tag.png`、`love-code-create.png`
- 授权标识：`LicenseRef-OpenChatGPTSkin-Authorized-Generated`
- 来源：由项目维护者按 `ASSET_PROMPTS.md` 生成、提供并确认可随本主题公开分发。
- 处理：三张烘焙棋盘背景素材已在本地转换为真实 Alpha PNG；文字、构图和霓虹线条保持不变。

## 字体

本主题不内置字体文件。完整 `Noto Serif SC Medium` 候选 WOFF2 为 5,795,776 字节，超过项目 5 MiB 单字体上限，因此已移除。展示文本使用 `Arial`，中文字符由 Windows/macOS 的系统字体回退完成。
