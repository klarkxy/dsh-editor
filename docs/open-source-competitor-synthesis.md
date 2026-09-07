# 开源竞品吸收报告

更新日期：2026-09-07

## 结论

DSH Editor 不需要复制另一套 Agent、Provider、RAG 或工作流引擎。最值得吸收的是四个开源项目在作者工作流上的互补长处：

| 项目 | 许可证 | 选择理由 | 吸收重点 |
| --- | --- | --- | --- |
| [NarraLume](https://github.com/abligail/narralume) | Apache-2.0 | AI 辅助长篇写作工作台，正文、修订和故事变更在作者接受前保持候选态 | 候选 → 对比 → 接受、推迟或拒绝；canon 冲突交回作者裁决 |
| [Linetta](https://github.com/devlikebear/linetta) | AGPL-3.0-only | 本地优先小说工作台，AI 修改遵循 propose → review → apply，并保留版本快照和备份 | 修改前后的安全状态、可撤销写入、正在编辑内容不被后台替换 |
| [novelWriter](https://github.com/saga-soft/novelWriter) | GPL-3.0 | 维护成熟的纯文本小说编辑器，项目树、交叉引用、统计和成稿构建完整 | 章节/场景状态、写作进度、参考资料关联、发布前 Build Manuscript 闭环 |
| [Manuskript](https://github.com/olivierkes/manuskript) | GPL-3.0-or-later | 从构思到初稿的传统小说工作台，大纲、卡片、角色、情节和故事线视图互补 | 大纲树与卡片板共享同一数据；渐进式 premise；独立结构视图 |

以上项目均只借鉴产品原则和交互，不复制 GPL/AGPL 实现代码。NarraLume 也只作为行为参考；若将来复用其 Apache-2.0 代码，必须另行核对 NOTICE 与具体文件来源。

## 与当前产品的差距

当前 DSH Editor 已有项目/卷章组织、侧栏全文搜索、稿内查找替换、自动保存与冲突保护、快照恢复、FIM、选区改写、触发式世界书（稿纸下可视化表单）、自然 Chat、作者确认后写入，以及预检后导出 Markdown/TXT/DOCX/EPUB。章节状态（草稿/修订中/已定稿）已回到 `chapter.statusSet` + `.dsh-editor/chapter-status.json`，并由作品概览与文件树徽标消费；人物卡/世界书面板、引用导航、导出预检也已落地。差距集中在：

1. AI 修改建议已有“应用/忽略”，但缺少推迟后重新决策和应用后的就地撤销（P0 曾落地，此处仅作回顾）。
2. 章节状态与全书进度已有消费面（概览页的状态分布、写作曲线、树标记）；仍不做可配置工作流引擎，也不把状态当作上下文或写入门禁。
3. 故事线、关系图、卡片拖放、手写摘要、章节—大纲绑定继续后置。

## 吸收顺序

### P0：作者裁决与可恢复修改

- 将文件修改建议保持为可见候选；在当前提案卡生命周期内，可以“稍后处理”并重新核对，也可以明确忽略。
- 已应用的文本修改在当前提案卡仍在、且目标文件未再次变化时可安全撤销；继续沿用 DSH/Manuscript 的版本校验，不增加第二套历史记录。
- 新建文件暂不提供自动删除式撤销，避免为对称 UI 引入危险删除能力；仍可使用现有归档流程处理。
- 这些决定状态暂不另行持久化：切换后重新打开时，以 DSH durable conversation 中的原提案重新核对；若真实使用证明需要跨启动的“待处理箱”，再基于 DSH 会话回执扩展，而不是新建浏览器存储。

本轮已落地这一项。

### P1：作品进度，而非项目管理系统

- 为章节增加少量固定状态：草稿、修订中、已定稿；不做可配置工作流引擎。
- 作品概览显示章节数、总字数、状态分布、字数条与最近编辑项，并画近 30 日 / 12 周写作曲线（`progress.history`）。
- 状态数据跟随作品，人类可读地写在 `.dsh-editor/chapter-status.json`，不另建云端或全局数据库。

本轮已落地：`chapter.statusSet`、概览页下拉、文件树状态标记，以及保存后 5 秒防抖的 `progress.record`。`novel_set_chapter_status` 工具未恢复；agent 侧只读 `novel_overview` 可以看到状态。

### P2：结构多视图与发布闭环

- 在同一人物卡/世界书文件上增加轻量卡片目录（`cards.list` / `cards.metaSet` / `cards.create`），不复制 Manuskript 的全套策划表单。
- 导出前提供章节顺序、空章、总字数预览；Markdown/TXT/DOCX/EPUB 均从同一份预检缓存生成。
- 设定/人物与正文的关联先做来源可见与引用导航（`cards.references`），不建设关系图或向量数据库。

本轮已落地最小闭环：卡片面板（人物/设定页签、结构化 frontmatter、引用跳转）、导出预检与四种格式、世界书稿纸下触发表单。卡片拖放、手写摘要、关系图、后台索引和章节—大纲绑定均未引入。

## 明确不吸收

- NarraLume 自有的 Provider 分配、连续任务 runtime 和完整 story database。
- Linetta 的 SQLite 资产层、模型接入层或协议服务。
- novelWriter 的自定义标记语法和 Qt 技术栈。
- Manuskript 的全套前置表单、强制 Snowflake 流程和所有策划模块。
- 任何第二套 Chat、Session、审批、文件权限、Provider Registry、RAG 服务或工作流编排器。

DSH 继续拥有 Agent、会话、模型、工具、审批、权限和 durable conversation state；DSH Editor 只补作者看得见、能理解、能撤回的写作体验。
