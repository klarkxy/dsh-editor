# 插件与共享包

安装与使用说明由各包维护。根 workspace 不能直接作为 DSH 插件安装。

| 包 | 用途 |
| --- | --- |
| [dsh-zhihu](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/docs/README.zh-CN.md) | 知乎资料；npm 包名 `@klarkxy/dsh-zhihu` |
| [dsh-web-search-manager](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager/docs/README.zh-CN.md) | 网络搜索；npm 包名 `@klarkxy/dsh-web-search-manager` |
| [dsh-manuscript](dsh-manuscript/README.md) | 稿纸编辑；独立 Web 使用本地 tarball |
| [dsh-current-title](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title/docs/README.zh-CN.md) | 按当前任务更新会话标题，保留手动命名；npm 包名 `@klarkxy/dsh-current-title` |
| [dsh-mood](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-mood/docs/README.zh-CN.md) | 由当前 Agent 记录和更新需求，不额外调用模型；npm 包名 `@klarkxy/dsh-mood` |
| [dsh-recap](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-recap/docs/README.zh-CN.md) | 后台回顾与独立开关的 Agent 检查点；npm 包名 `@klarkxy/dsh-recap` |
| [dsh-editor-shell](dsh-editor-shell/README.md) | 桌面写作界面 |
| [dsh-editor-workbench](dsh-editor-workbench/README.md) | 作品管理与写作修改 |
| [dsh-editor-plugins](dsh-editor-plugins/README.md) | 发现搜索；安装清单由官方管理器负责 |
| [dsh-editor-novel-kernel](dsh-editor-novel-kernel/README.md) | 小说知识与资料维护工具 |
| [dsh-editor-cards](dsh-editor-cards/README.md) | 人物卡与世界书目录快捷入口 |
| [dsh-editor-memory-panel](dsh-editor-memory-panel/README.md) | 记忆维护 |
| [dsh-editor-overview-panel](dsh-editor-overview-panel/README.md) | 文档概览 |
| [dsh-editor-panel-base](dsh-editor-panel-base/README.md) | 面板公共基础设施（RPC / 请求 / 国际化） |
| [dsh-editor-seats](dsh-editor-seats/README.md) | 界面扩展合同 |
| [dsh-editor-workspace-kit](dsh-editor-workspace-kit/README.md) | 工作区共享库 |

功能在产品中的归属、开关与设置入口见[内置插件与设置](../docs/builtin-plugins.md)；库依赖不提供空开关。

## 官方 DSH 能力

| 官方包或能力 | Editor 中的用途 |
| --- | --- |
| DSH 0.2.2-rc.5 原生会话 | 搭档对话的各段会话、消息与审批；Editor 只在作品元数据记录段指针 |
| `@deepseek-ai/dsh-client-ui-shortcuts` | 「设置 → 快捷键」搜索、录制和重置；桌面修改持久化 |
| `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | 文件栏图片、PDF、Office 文档和表格预览 |
| `@deepseek-ai/dsh-mcp-resources` | 读取已配置 MCP 服务的资源，默认关闭 |
| `@deepseek-ai/dsh-experimental-voice-input-bundle` | 语音输入，随包启用；首次点击麦克风可进入准备引导，模型由作者选择下载和准备 |

Editor 保留稿纸布局，以官方公有布局合同和界面槽位承载这些插件；定时任务不加入组合。官方包由桌面内置 DSH 提供，并非本仓库发布的 `@klarkxy/` 包。

`dsh-editor-*` 为桌面私有包。入口、依赖与默认开关以各包 `package.json` 为准；组合定义在 [desktop.json](../apps/desktop/resources/compositions/desktop.json)，`basic` / `smart` / `full` 是同一组合的兼容别名。

写作会话默认携带 DSH 原生网页搜索工具，通过官方 DeepSeek 搜索后端取回资料。公共插件不预装：「插件 → 发现」推荐网络搜索管理器与知乎，其他公共插件可搜索包名后在编辑器「添加插件」对话框安装。私有适配提供发现搜索；安装、清单与启停由官方 pluginManager 服务执行，界面由编辑器自托管。内置模型设置使用 DSH 原生供应商与现有写作偏好，公共插件各自保存模型选择。AI Services、Model Center、Memory、Self-improvement 与 Fusion 已从组合和依赖中移除；私有写作记忆面板及作者记录保留。共享库 `@klarkxy/dsh-plugin-kit@0.1.0` 提供合同和原生调用辅助，没有插件开关。使用顺序与宿主限制见 [AI 插件说明](../docs/ai-plugins-implementation.md)。`dsh-editor-panel-base` 是客户端构建时内联的 devDependency，运行时 manifest 的 libraries 只包括 seats 和 workspace-kit。

[发布维护](PUBLISHING.md) · [桌面使用指南](../docs/user-guide.md)

退役插件的 Dream 与 Self Improve 设计历史见 [可移植学习边界](../docs/portable-learning.md)。

公共插件已迁到 dsh-plugins；本仓库只保留需要本地维护的插件与桌面包。版本、构建和发布归属见[迁移说明](../docs/public-plugin-migration.md)。
