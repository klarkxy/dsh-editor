# 插件与共享包

安装与使用说明由各包维护。根 workspace 不能直接作为 DSH 插件安装。

| 包 | 用途 |
| --- | --- |
| [dsh-zhihu](dsh-zhihu/docs/README.zh-CN.md) | 知乎资料；npm 包名 `@klarkxy/dsh-zhihu` |
| [dsh-web-search-manager](dsh-web-search-manager/docs/README.zh-CN.md) | 网络搜索；npm 包名 `@klarkxy/dsh-web-search-manager` |
| [dsh-manuscript](dsh-manuscript/README.md) | 稿纸编辑；独立 Web 使用本地 tarball |
| [dsh-proofread](dsh-proofread/README.md) | 中文校对；独立 Web 使用本地 tarball |
| [dsh-ai-services](dsh-ai-services/docs/README.zh-CN.md) | 共享的模型角色、调用限额、取消与用量记录；无独立功能开关；npm 包名 `@klarkxy/dsh-ai-services` |
| [dsh-current-title](dsh-current-title/docs/README.zh-CN.md) | 按当前任务更新会话标题，保留手动命名；npm 包名 `@klarkxy/dsh-current-title` |
| [dsh-mood](dsh-mood/docs/README.zh-CN.md) | 需求澄清与可修订的任务约定；npm 包名 `@klarkxy/dsh-mood` |
| [dsh-recap](dsh-recap/docs/README.zh-CN.md) | 后台回顾与独立开关的 Agent 检查点；npm 包名 `@klarkxy/dsh-recap` |
| [dsh-memory](dsh-memory/docs/README.zh-CN.md) | 作者用语、偏好与近期状态；内含 Dream 观察与整理；npm 包名 `@klarkxy/dsh-memory` |
| [dsh-self-improvement](dsh-self-improvement/docs/README.zh-CN.md) | 明确方法要求与候选结果观察、审计撤回与 Skill 导出；复用 Memory；npm 包名 `@klarkxy/dsh-self-improvement` |
| [dsh-model-center](dsh-model-center/docs/README.zh-CN.md) | 供应商、快速／对话／思考／幻想档位与用途配置；npm 包名 `@klarkxy/dsh-model-center` |
| [dsh-fusion](dsh-fusion/docs/README.zh-CN.md) | Fusion 协作：主助手委派任务、持久执笔搭档产出候选、作者采用后写入；预装、默认关闭；npm 包名 `@klarkxy/dsh-fusion` |
| [dsh-editor-shell](dsh-editor-shell/README.md) | 桌面写作界面 |
| [dsh-editor-workbench](dsh-editor-workbench/README.md) | 作品管理与写作提案 |
| [dsh-editor-plugins](dsh-editor-plugins/README.md) | 插件设置与社区安装 |
| [dsh-editor-novel-kernel](dsh-editor-novel-kernel/README.md) | 小说知识与小说创作模式 |
| [dsh-editor-writing-presets](dsh-editor-writing-presets/README.md) | 文章与技术文档模式 |
| [dsh-editor-cards](dsh-editor-cards/README.md) | 人物卡与世界书 |
| [dsh-editor-memory-panel](dsh-editor-memory-panel/README.md) | 记忆维护 |
| [dsh-editor-overview-panel](dsh-editor-overview-panel/README.md) | 文档概览 |
| [dsh-editor-proofread-panel](dsh-editor-proofread-panel/README.md) | 桌面校对 |
| [dsh-editor-seats](dsh-editor-seats/README.md) | 界面扩展合同 |
| [dsh-editor-workspace-kit](dsh-editor-workspace-kit/README.md) | 工作区共享库 |

`dsh-editor-*` 为桌面私有包。入口、依赖与默认开关以各包 `package.json` 为准；组合定义在 [desktop.json](../apps/desktop/resources/compositions/desktop.json)，`basic` / `smart` / `full` 是同一组合的兼容别名。

这六个 AI 功能预装并默认启用，仍可分别停用；Fusion 协作预装但默认关闭。Dream、Agent 与语义检查点等自动行为默认开启，可分别关闭；共享服务只提供机制，不会自行调用模型。使用顺序与宿主限制见 [AI 插件说明](../docs/ai-plugins-implementation.md)。

[发布维护](PUBLISHING.md) · [桌面使用指南](../docs/user-guide.md)

Dream 与 Self Improve 的数据分流、独立 Web 依赖和后续维护约束见 [可移植学习边界](../docs/portable-learning.md)。
