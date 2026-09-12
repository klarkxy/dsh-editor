# DSH Editor 产品原则

本文记录维护期仍须遵守的产品边界。改其中任何一条都等于改产品身份，需要单独授权。界面与 token 见 [ui.md](ui.md)，运行时权威见 [architecture.md](architecture.md)。

0.2.0 的界面调整遵守这些边界：桌面校对暂停，知乎配置移入设置；辅助配置文件从作者文件树和搜索中隐藏，原文件与搭档读取能力保留。

## 作者写，模型协助

- 作者写正文。模型只提供短补全、选段改写、讨论和可忽略的文件提案。
- 应用不是 AI 小说家，也不是章节工厂。界面不出现「生成第 N 章」「一键写十章」「Keep all agent edits」。
- 补全是光标处的 ghost FIM：半句到两句，Tab 采纳、Esc 关掉，最多三条候选。空白章不会自动生成正文。
- 右侧是同一套 DSH 对话，用来对质剧情和审稿，不是第二套 Chat 产品，也不把生成章节直接倒进文件。
- 作品是普通文件夹。新建只预建空的 `正文/`；`大纲/`、`人物卡/`、`世界书/` 在实际创建后出现。不预写向导，不用隐藏 JSON 当作作品结构。

## 先提案，再由作者确认

文件修改保持为可见候选：应用或忽略。已应用的文本修改在提案卡仍在、且目标文件未再变化时可撤销。新建文件不提供自动删除式撤销；不需要的文件走归档。

这些决定不另存浏览器存储。切换后重新打开时，以 DSH durable conversation 中的原提案重新核对。

DSH 拥有 Agent、会话、模型、工具、审批、权限和对话历史。DSH Editor 只补作者看得见、能理解、能撤回的写作体验。没有 BFF、第二份 Chat 历史、provider registry、数据库、工作流引擎、索引服务或云同步。

## 进度属于作品

章节只有三种固定状态：草稿、修订中、已定稿。状态写在作品旁路 `.dsh-editor/chapter-status.json`，由概览和文件树消费。Agent 只读 `novel_overview`，状态不是写入门禁，也不是可配置工作流。

人物卡和世界书是同一批 Markdown 文件上的轻量目录，带引用导航，不做关系图或向量库。导出前预检章节顺序、空章和总字数，再生成 Markdown / TXT / DOCX / EPUB。

## 明确不做

不是待办，而是约束：

- 第二套 Chat、Session、审批、文件权限、Provider Registry、RAG 或工作流编排器
- Copilot 式句内卡片、`/` / `@` 命令面板、审阅 gutter
- 卡片拖放、手写摘要、章节—大纲绑定、关系图、向量检索、后台索引
- Git UI、minimap、LSP、终端、activity bar
- 紫色渐变、玻璃拟态、霓虹 AI 装饰、英文-only 界面
- 把稿纸缩成聊天旁边的窄条
- 把 chrome 与稿纸做成同一套冷灰 IDE 表面；稿纸必须保持暖色纸面，chrome 可以更中性，但强调色仍是墨蓝
- 把常用 chrome 做成小于 13px 的字或小于 32px 的主控件；顶栏应接近 52px，而不是工具条细条
- Android、远程多用户、云同步
- 未经授权的 commit、push、tag、release 或代码签名

三个公开插件 `dsh-manuscript`、`dsh-proofread`、`dsh-zhihu` 仍可独立安装到普通 DSH Web profile。桌面写作会话走专属 `dsh-editor` agent preset，不挂载官方编码工具目录。

## 参考过、但不复制的开源产品

维护时只借鉴下列产品的作者工作流原则，不复制 GPL/AGPL 实现。NarraLume 若将来复用其 Apache-2.0 代码，必须另行核对 NOTICE 与具体文件来源。

| 项目 | 许可证 | 已吸收为当前行为 |
| --- | --- | --- |
| [NarraLume](https://github.com/abligail/narralume) | Apache-2.0 | 候选 → 对比 → 接受或拒绝；冲突交回作者 |
| [Linetta](https://github.com/devlikebear/linetta) | AGPL-3.0-only | 正在编辑的内容不被后台替换；写入可恢复 |
| [novelWriter](https://github.com/saga-soft/novelWriter) | GPL-3.0 | 章节状态、写作进度、导出前预检 |
| [Manuskript](https://github.com/olivierkes/manuskript) | GPL-3.0-or-later | 人物卡 / 世界书与正文共用同一批 Markdown |

明确不吸收：NarraLume 的 Provider 分配和 story database；Linetta 的 SQLite 资产层与模型接入；novelWriter 的自定义标记与 Qt 栈；Manuskript 的全套前置表单和强制 Snowflake 流程。
