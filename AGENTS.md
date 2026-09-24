# DSH Editor: instructions for coding agents

适用整个仓库。更深目录的 AGENTS.md 补充本文件；用户明确的新要求优先于旧设计约定。

## 开工前

- 先阅读 [产品原则](docs/product-principles.md) 和 [架构决策](docs/architecture.md)，再读修改目录下的指南。
- **凡涉及可见界面，包括插件面板、设置、消息卡片，先读 [UI 施工约定](docs/ui-agent-guide.md) 和 [设计说明](docs/ui-design.md)。** 不能只凭“做得更现代”重新设计。
- 本仓库固定 React / Electron / Radix / CodeMirror。普通功能任务不迁移框架、不新增第二套 UI 库或主题系统。

## 不随功能任务改变的边界

DSH 是会话、模型、权限与运行时状态的权威；Editor 保持稿纸中心。不要为美化复制状态、改变审批/写入契约、重置作者排版或按主题重新挂载编辑器。尊重插件边界和中文输入法。

视觉基准是当前仓库的生产 tokens、组件和设计系统预览；官方 Kimi Web 的历史源码只是已锁定的来源。不要换成第三方同名客户端，也不要重新取一份“最新主题”覆盖它。

## 交付

UI 改动使用 `.github/pull_request_template.md` 的清单，报告改动范围、检查命令、截图和未验证事项。先运行 `node --test scripts/check-ui-drift.test.mjs`、`node scripts/check-ui-drift.mjs --base <任务起点或目标分支>`，再按 UI 指南执行设计检查、构建和适用的浏览器/桌面验证。未运行不能写“通过”。

用户授权的改动可在任务分支提交；没有授权不合并、不打标签、不发布。不要为了让 CI 变绿删除断言、移动文件到检查范围外或自动重置视觉基准。
