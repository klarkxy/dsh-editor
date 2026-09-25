# dsh-editor-writing-presets

桌面「文章与自媒体」（`dsh-editor-article`）和「技术文档」（`dsh-editor-technical`）写作模式。

在「设置 → 插件 → 写作模式」开关，新对话创建时选择；进行中的对话不受影响。文件修改先提案、由作者确认。模式内容见 [presets/](presets/)。

## 两个 preset

- 文章与自媒体：面向文章与自媒体的写作搭档，目录约定 选题/、资料/、主稿/、渠道稿/；引用资料时用人类可读的「依据与基线」写清路径和版本，不另建隐藏索引。附带 `article-writing`、`prose-revision` 两个 skills。
- 技术文档：面向技术文档的写作搭档，目录约定 需求/、决策/、文档/、验收/，按需求 → 决策 → 文档 → 验收推进；新会话先盲读已有文件，不把上一会话的记忆当成已落盘的事实。附带 `technical-writing`、`prose-revision` 两个 skills。

目录约定不预建：缺少的目录只在作者确认的 `writing_propose` 需要时随采用创建，不为选中 preset 或填空建目录、补模板。`prose-revision` 只负责已有文稿的语言、节奏、衔接与去 AI 腔修订，两个 preset 各带一份。

## 受限工具面

两个 preset 共用同一套最小工具面：bash / pwsh 禁用，不挂 shell、jobs、subagent、goal、todo，也不挂 write、edit 等会直接改文件的工具。一切内容变更必须走 `writing_propose`，形成可预览提案，待作者确认后才由产品写入。skills 经 `@deepseek-ai/dsh-skill-filesystem` 从各 preset 的 `skills/` 目录加载。
