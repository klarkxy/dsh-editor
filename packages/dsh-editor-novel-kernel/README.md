# dsh-editor-novel-kernel

桌面私有、仅 Host 的小说工具边界：捆绑知识卡、预览提案、工具守卫与系统提示。包版本 `0.1.0`，不是桌面应用 `0.2.0`。Feature `assistant`（smart / full）；basic 不装。

`./contracts` 浏览器安全：工具名与提案 / 记忆标记解析，供 Shell 内联。

## 工具

本 Host 注册（`src/index.ts`）：`novel_knowledge`、`novel_propose`、`author_observe`、`novel_index_write`、`novel_scratch_write`、`novel_scratch_read`、`novel_scratch_list`。

`novel_overview` 由 `dsh-editor-workbench/tools` 同名注册，内核守卫仍放行。知乎工具由 `dsh-zhihu/tools` 注册。旧 `novel_search` / `project_knowledge` 不再注册。`novel_propose` 只发 Markdown `edit` / `create` / `split` / `merge` / `renames` 标记，不写文件。索引只经 `novel_index_write` 直写。

## 注入

`tools`、`systemPrompt`、`fs`、`sandboxPolicy`。提示段名 `dsh-editor:novel-kernel`。替换时保留工具名、标记 schema、守卫语义与该段，且只保留一个 `editor-novel-kernel` 入口。

`resources/novel-knowledge/` 是运行时知识卡，不是文档。

## 文档

[插件架构](../../docs/plugin-architecture.md) · [组合指南](../../docs/plugin-composition-guide.md)
