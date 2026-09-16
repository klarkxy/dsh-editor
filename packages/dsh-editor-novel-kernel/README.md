# dsh-editor-novel-kernel

桌面私有、仅 Host 的小说工具边界。包版本 `0.1.0`，不是桌面应用 `0.2.0`。`editor-novel-kernel` 在 profile 顶层 disabled。通用 / 文章 / 技术写作 Preset 不挂本包。

`resolveNovelKernelMode`（`src/index.ts`）决定注册面。mode 必填：省略 config 与未知 mode 一样 fail closed；`legacy` 与历史别名 `full` 落完整表面。

| 模式 | 谁挂载 | 本包注册 |
| --- | --- | --- |
| `knowledge-only` | 可见的新 `dsh-editor-novel` 必须显式传入 | 仅 `novel_knowledge`。不注册提案 / 索引 / scratch / overview / memory，不装 `editorToolGuard`，不写 `dsh-editor:novel-kernel` 提示段 |
| `legacy` | 隐藏的历史 `dsh-editor`（显式 `mode: legacy`；`full` 是其历史别名） | `novel_knowledge`、`novel_propose`、`novel_index_write`、scratch 三件套，并调用 workbench `installNovelWorkbenchTools` 挂 `novel_overview` / `novel_memory_update`；装 guard 与 prompt 段 |

采访、自动索引、`context.compile`、scratch 与 frontmatter 自动管线只服务 legacy 会话，不由 knowledge-only 启动。可见小说会话的写入合同是 workbench 的 `writing_propose` V2 与共用的 `author_observe`，不在本包。

`./contracts` 浏览器安全：工具名与提案标记解析，供 Shell 内联。作者侧写 marker / `parseAuthorMemoryMarker` 再导出自 `dsh-editor-workbench/contracts`。

## 工具

`author_observe` 由 `dsh-editor-workbench/tools` 注册一次，本包不重复注册。`createAuthorObserveTool` 仅兼容再导出。

知乎工具由 `dsh-zhihu/tools` 注册。旧 `novel_search` / `project_knowledge` 不再注册。legacy 的 `novel_propose` 只发 Markdown `edit` / `create` / `split` / `merge` / `renames` 标记，不写文件。索引只经 `novel_index_write` 直写。

## 注入

`tools`、`systemPrompt`、`fs`、`sandboxPolicy`、`sessions`、`workspaceRegistry`。legacy 提示段名 `dsh-editor:novel-kernel`。替换时：knowledge-only 只保留 `novel_knowledge`；legacy 保留完整工具名、标记 schema、守卫语义与该段。只保留一个 `editor-novel-kernel` 入口。

`resources/novel-knowledge/` 是运行时知识卡，不是文档。

## 文档

[插件架构](../../docs/plugin-architecture.md) · [组合指南](../../docs/plugin-composition-guide.md)
