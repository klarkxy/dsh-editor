# DSH Editor 产品原则

本文记录维护期仍须遵守的产品边界。改其中任何一条都等于改产品身份，需要单独授权。界面与 token 见 [ui.md](ui.md)，运行时权威见 [architecture.md](architecture.md)。

最近的界面调整遵守这些边界：四个 Preset 共用中性文稿校对 UI（当前文档 / 全部可见 `.md`/`.txt`，五项 kind 不含 `card`），知乎配置移入设置；辅助配置文件从作者文件树和搜索中隐藏，原文件与搭档读取能力保留。

## 作者写，模型协助

- 作者写正文、决定剧情。模型提供短补全、选段改写、讨论与文件提案；人物卡、世界书和大纲/章纲在落笔前先讨论、预览并由作者采用。正文写完后不设置章节收尾步骤。
- 应用不是 AI 小说家，也不是章节工厂。界面不出现「生成第 N 章」「一键写十章」「Keep all agent edits」。
- 补全是光标处的 ghost FIM：半句到两句，Tab 采纳、Esc 关掉，最多三条候选。空白章不会自动生成正文。
- 右侧是同一套 DSH 对话，用来对质剧情和审稿，不是第二套 Chat 产品，也不把生成章节直接倒进文件。
- 作品是普通文件夹。不预建专业目录，也不生成故事模板。小说、文章或技术文档需要的目录，只在作者采用对应「新建文件」提案后才出现。不预写向导，不用隐藏 JSON 当作作品结构。

## 先提案，再由作者确认

正文修改、未经确认的设定和事实冲突保持为可见候选：应用或忽略。落笔前的初始人物卡、世界书和大纲/章纲都必须先形成可见提案；大纲与章纲统一保存为 `大纲/` 下的 Markdown，不写入正文隐藏元数据。hidden legacy `dsh-editor` 仍可用 `novel_memory_update` 对来源可靠且无冲突的人物或世界资料自动保存；可见四个新 Preset 没有该工具，修订已有内容一律先确认。已应用的文本修改在提案卡仍在、且目标文件未再变化时可撤销。新建文件不提供自动删除式撤销；不需要的文件走归档。

这些决定不另存到浏览器存储。切换后重新打开时，以 DSH durable conversation 中的原提案重新核对。

DSH 拥有 Agent、会话、模型、工具、审批、权限和对话历史。DSH Editor 只补作者看得见、能理解、能撤回的写作体验。没有 BFF、第二份 Chat 历史、provider registry、数据库、工作流引擎、索引服务或云同步。

## 进度属于作品

人物卡和世界书是同一批 Markdown 文件上的轻量目录，带引用导航，不做关系图或向量库。默认不装卡片或记忆面板，core 不强依赖它们。导出前预检可见文档顺序、空文档和总字数，再生成 Markdown / TXT / DOCX / EPUB。

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

三个公开插件 `dsh-manuscript`、`dsh-proofread`、`dsh-zhihu` 仍可独立安装到普通 DSH Web profile。桌面新对话默认 `dsh-editor-writing`，另有 `dsh-editor-novel`、`dsh-editor-article`、`dsh-editor-technical`，三者由第一方插件包提供，作者可在设置「插件 → 写作模式」里开关（进行中的对话不受影响）；`dsh-editor-writing` 是锁定的核心 fallback。历史 `dsh-editor` 只作为 legacy 会话。写作会话不挂载官方编码工具目录；开发者模式下可选的官方 Agent 模式保留自身完整工具，不受写作守卫限制。

Legacy 退出判据：3a 恢复测试与迁移入口已上线；下一个 minor 版本删除 legacy 采访 / 自动索引 / scratch 旧流程与 `dsh-editor` preset（保留 V1 提案解析与章节 frontmatter 解析做转录兼容），届时删除本判据。

## 参考过、但不复制的开源产品

维护时只借鉴下列产品的作者工作流原则，不复制 GPL/AGPL 实现。NarraLume 若将来复用其 Apache-2.0 代码，必须另行核对 NOTICE 与具体文件来源。

| 产品 | 许可证 | 已吸收为当前行为 |
| --- | --- | --- |
| [NarraLume](https://github.com/abligail/narralume) | Apache-2.0 | 候选 → 对比 → 接受或拒绝；冲突交回作者 |
| [Linetta](https://github.com/devlikebear/linetta) | AGPL-3.0-only | 正在编辑的内容不被后台替换；写入可恢复 |
| [novelWriter](https://github.com/saga-soft/novelWriter) | GPL-3.0 | 章节状态、写作进度、导出前预检 |
| [Manuskript](https://github.com/olivierkes/manuskript) | GPL-3.0-or-later | 人物卡 / 世界书与正文共用同一批 Markdown |

明确不吸收：NarraLume 的 Provider 分配和 story database；Linetta 的 SQLite 资产层与模型接入；novelWriter 的自定义标记与 Qt 栈；Manuskript 的全套前置表单和强制 Snowflake 流程。
