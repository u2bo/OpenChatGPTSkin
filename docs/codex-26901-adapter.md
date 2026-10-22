# Codex 26.901 surface compatibility / 界面适配

## 中文

Codex 26.901 的会话、设置与标签页面可能挂载在旧 shell main 之外，输入框也改用了组件局部变量。仅遍历旧 main 会漏掉这些区域；在滚动、输入或面板变化后重新测量整个页面，则会增加布局开销并让新页面短暂显示原生颜色。

编译后的主题使用静态 CSS 选择器和主题变量匹配当前及后续挂载的界面。启动时保留一次兼容性识别，之后只为输入框、账户/项目图标、欢迎语和 diff/file-tree 的 Shadow DOM 初始化局部内容。输入和历史列表滚动不会触发全页布局测量；首页的欢迎语/装饰层仍在相关尺寸或滚动变化时局部定位。旧的无 surfaceStrategy 编译结果保留原协调路径。

- 会话保留 off、ambient、banner、full 背景模式；面板与终端分别使用自己的透明度。
- 新输入框使用原生组件变量；清除首次识别留下的重复外壳着色。
- 顶部及输入框渐变通过原生语义结构匹配，避免重新出现原生底色。
- blur 为 0 时使用 none，避免无效果的滤镜层。
- 账户头像通过菜单语义匹配，排除会话和项目列表；保留主题配置的素材和尺寸。
- 原生建议卡片保留文字及点击行为，页面重挂载时恢复主题图标。

测试使用合成 HTML 和内置主题，不包含实际聊天、项目数据或个人素材。范围以观察到的 Windows Codex 26.901 结构为准；未来 DOM 变化仍可能需要适配，macOS 未实机验收。

本修复不加入自定义四卡片、提示词替换或特定主题布局。这些是独立扩展，也不修改主题 schema、Runtime 启停、身份认证或受管理实例策略。

## English

Codex 26.901 can mount conversation, settings and tab content outside the legacy shell main. Its composer also uses component-local paint variables. Traversing only the old main misses these surfaces; repeatedly measuring the entire document during interaction adds layout work and delays theme colors on new mounts.

Compiled themes use native CSS selectors and theme variables for present and future surfaces. One initial compatibility pass is retained. Subsequent imperative work is scoped to composer bindings, account/project imagery, welcome content and diff/file-tree shadow roots. Typing and history scrolling do not schedule full-page geometry passes. Home welcome/composition overlays still update locally on relevant size/scroll changes. Previously compiled payloads without surfaceStrategy retain the legacy reconciliation path.

Conversation modes and independent panel/terminal opacity are preserved. Modern composer variables supply the input paint while stale wrapper paint is cleared. Native fade selectors prevent default-color strips. Disabled blur emits none. Semantic account-menu matching excludes task/project rows. Native suggestion labels and click handlers remain untouched; imagery is restored after remounting.

Regression coverage uses synthetic HTML and built-in themes. The compatibility evidence concerns Windows Codex 26.901, not future DOM versions or a macOS device run. No custom prompt-card feature, theme schema, personal assets, Runtime transitions, authentication or managed-instance ownership changes are included.
