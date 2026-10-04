# DSH Editor

<p align="center">
  <img src="docs/assets/mascot.webp" alt="DSH Editor 看板娘" width="260">
</p>

Windows / macOS 桌面写作应用。作者在稿纸上写正文，AI 搭档在侧栏提供补全、改写、讨论与文件提案；修改经作者确认后写入。作品是普通的本地文件夹。

[下载](https://github.com/klarkxy/dsh-editor/releases) · [使用指南](docs/user-guide.md) · [变更记录](CHANGELOG.md)

支持查找替换、章节导航、校对、版本回滚和 Markdown / TXT / DOCX / EPUB 导出。新对话可选通用写作、小说创作、文章与自媒体、技术文档。

## 安装

Windows 提供便携版 EXE 和安装器，macOS 提供 Apple Silicon 的 dmg / zip。应用未签名，首次运行可能出现系统安全提示。更新入口在「设置 → 关于」，操作见[使用指南](docs/user-guide.md#安装与更新)。

Editor 自有功能与随发行版提供的官方功能统一列在“内置插件”；模型配置常驻设置。人物卡与写作记忆面板随包提供，默认关闭。具体归属和兼容边界见[内置插件与设置](docs/builtin-plugins.md)。

## 插件

| 插件 | 用途 | 安装来源 |
| --- | --- | --- |
| [@klarkxy/dsh-zhihu](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/docs/README.zh-CN.md) | 知乎搜索与知识库 | npm |
| [@klarkxy/dsh-web-search-manager](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager/docs/README.zh-CN.md) | 网络搜索与网页读取 | npm |
| [@klarkxy/dsh-ai-services](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-ai-services/docs/README.zh-CN.md) | 插件共用的模型路由与用量服务 | npm |
| [@klarkxy/dsh-current-title](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title/docs/README.zh-CN.md) | 按当前任务更新会话标题 | npm |
| [@klarkxy/dsh-mood](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-mood/docs/README.zh-CN.md) | 需求澄清 | npm |
| [@klarkxy/dsh-recap](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-recap/docs/README.zh-CN.md) | 后台回顾与 Agent 检查点 | npm |
| [@klarkxy/dsh-memory](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-memory/docs/README.zh-CN.md) | 长期记忆与闲时整理 | npm |
| [@klarkxy/dsh-self-improvement](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-self-improvement/docs/README.zh-CN.md) | 教训摘录与技能草稿导出 | npm |
| [@klarkxy/dsh-model-center](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-model-center/docs/README.zh-CN.md) | 模型档位与用途配置 | npm |
| [@klarkxy/dsh-fusion](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-fusion/README.md) | Fusion 协作：主助手委派任务、持久执笔搭档产出候选，作者采用后写入 | npm |
| [dsh-manuscript](packages/dsh-manuscript/README.md) | 稿纸编辑 | 本地 tarball，尚未发布到 npm |
| [dsh-proofread](packages/dsh-proofread/README.md) | 中文文本校对 | 本地 tarball，尚未发布到 npm |
| DSH 原生会话管理 | 对话归档、恢复、置顶与列表筛选 | 内置 DSH 0.1.7-rc.2 |
| @deepseek-ai/dsh-client-ui-shortcuts | 搜索、录制、重置快捷键；桌面设置持久化 | 内置官方插件 |
| @deepseek-ai/dsh-client-ui-sidebar-documentpreview | 文件栏资料预览 | 内置官方插件 |
| @deepseek-ai/dsh-mcp-resources | 读取已配置 MCP 服务提供的资源 | 内置官方插件 |
| @deepseek-ai/dsh-experimental-voice-input-bundle | 可选语音输入；首次使用由作者选择准备模型 | 内置官方插件 |

当前标题、需求澄清、回顾、记忆与自我改进随桌面版预装并默认启用，可分别停用；模型配置为必需内置模块；Fusion 协作同样预装但默认关闭，可在全局「插件」页的「已安装与市场」开启。官方插件通过公有布局与界面槽位接入，Editor 仍保留稿纸界面；定时任务未加入。记忆的 Dream 可单独关闭；回顾与 Agent 检查点随回顾插件统一开关。独立 DSH 可按各包说明从 npm 安装，见 [使用与实现说明](docs/ai-plugins-implementation.md)。

安装步骤在各包目录。仓库根目录是桌面应用 workspace，不能作为单个 DSH 插件安装。全部包与发布说明见 [packages/](packages/README.md)。

## 开发

使用 Node `24.16.0`、pnpm `10.14.0`，内置 DSH 固定为 `0.1.7-rc.2`。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

检查用 `pnpm build`、`pnpm typecheck`、`pnpm test`；打包与端到端命令见 [package.json](package.json)。

桌面入口在 [apps/desktop/](apps/desktop/)，插件在 [packages/](packages/README.md)，开发约定与跨包架构见[文档索引](docs/README.md)。

## 许可

[SATA 2.1](LICENSE)（Star And Thank Author License）。
