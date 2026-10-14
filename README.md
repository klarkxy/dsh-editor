# DSH Editor

<p align="center">
  <img src="docs/assets/mascot.webp" alt="DSH Editor 看板娘" width="260">
</p>

Windows / macOS 桌面写作应用。作者在稿纸上写正文，AI 搭档在侧栏提供补全、改写、讨论与文件提案；修改经作者确认后写入。作品是普通的本地文件夹。

[下载](https://github.com/klarkxy/dsh-editor/releases) · [使用指南](docs/user-guide.md) · [变更记录](CHANGELOG.md)

支持查找替换、章节导航、校对、版本回滚和 Markdown / TXT / DOCX / EPUB 导出。新对话可选通用写作、小说创作、文章与自媒体、技术文档。

首页「继续写作」直接回到上次的章节；工作台左侧栏分「文件 / 搜索」页签，右侧辅助栏分「搭档 / 资料 / 工具」页签，窄窗下侧栏变成抽屉。命令面板按写作 / 视图 / 作品 / 插件命令 / 跳转到文档分组，可切换浅色 / 深色 / 跟随系统。设置与插件是同一个全页视图，导出前可按目录勾选文档。界面由仓库自有「原稿」设计系统驱动，支持明暗主题。

## 安装

Windows 提供便携版 EXE 和安装器，macOS 提供 Apple Silicon 的 dmg / zip。应用未签名，首次运行可能出现系统安全提示。更新入口在「设置 → 关于」，操作见[使用指南](docs/user-guide.md#安装与更新)。

全局「插件」页按来源把插件分成三类展示：上游随运行时提供的 DSH 官方插件、DSH-Editor 内置插件（含随包预装的网页搜索，写作模式作为其子分组）和作者安装的用户插件。安装、卸载、脚本批准与启停由「安装与卸载」页的官方插件管理器执行，搜索 npm 包名在「发现插件」页。模型配置常驻设置。人物与世界书的目录快捷入口及写作记忆面板随包提供，默认关闭；人物卡和世界书直接在文件树中编辑。具体归属和兼容边界见[内置插件与设置](docs/builtin-plugins.md)。

## 插件

| 插件 | 用途 | 安装来源 |
| --- | --- | --- |
| [@klarkxy/dsh-zhihu](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/docs/README.zh-CN.md) | 知乎搜索与知识库 | npm，按需安装 |
| [@klarkxy/dsh-web-search-manager](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager/docs/README.zh-CN.md) | 网络搜索与网页读取 | 桌面预装 |
| [@klarkxy/dsh-current-title](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title/docs/README.zh-CN.md) | 按当前任务更新会话标题 | npm，按需安装 |
| [@klarkxy/dsh-mood](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-mood/docs/README.zh-CN.md) | 由当前 Agent 记录和更新需求 | npm，按需安装 |
| [@klarkxy/dsh-recap](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-recap/docs/README.zh-CN.md) | 后台回顾与 Agent 检查点 | npm，按需安装 |
| [dsh-manuscript](packages/dsh-manuscript/README.md) | 稿纸编辑 | 本地 tarball，尚未发布到 npm |
| [dsh-proofread](packages/dsh-proofread/README.md) | 中文文本校对 | 本地 tarball，尚未发布到 npm |
| DSH 原生会话管理 | 对话归档、恢复、置顶与列表筛选 | 内置 DSH 0.2.0-rc.2 |
| @deepseek-ai/dsh-client-ui-shortcuts | 搜索、录制、重置快捷键；桌面设置持久化 | 内置官方插件 |
| @deepseek-ai/dsh-client-ui-sidebar-documentpreview | 文件栏资料预览 | 内置官方插件 |
| @deepseek-ai/dsh-mcp-resources | 读取已配置 MCP 服务提供的资源，默认关闭 | 内置官方插件 |
| @deepseek-ai/dsh-experimental-voice-input-bundle | 语音输入，随包启用；首次点击麦克风可进入准备引导，模型由作者选择下载和准备 | 内置官方插件 |

网页搜索随桌面版预装。知乎、当前标题、需求记录和会话纪要不再预装，可在插件页搜索 npm 包名后复制规格，到官方「添加插件」安装，例如 `@klarkxy/dsh-zhihu`。模型供应商和新对话、补全、改写的选择由内置设置管理，其他插件使用各自配置。已退役的 AI Services、Model Center、Memory、Self-improvement 和 Fusion 不再进入发行组合；作者的写作记忆面板仍保留，旧插件数据不删除。官方插件通过公有布局与界面槽位接入，Editor 保留稿纸界面；定时任务未加入。独立 DSH 可按各包说明从 npm 安装，见 [使用与实现说明](docs/ai-plugins-implementation.md)。

安装步骤在各包目录。仓库根目录是桌面应用 workspace，不能作为单个 DSH 插件安装。全部包与发布说明见 [packages/](packages/README.md)。

## 开发

使用 Node `26.10.0`、pnpm `10.14.0`，内置 DSH 固定为 `0.2.0-rc.2`。pnpm 会自动安装并使用项目固定的 Node 版本运行脚本，不受系统 Node 版本切换影响。桌面运行时与原生插件操作用随包钉住的 pnpm `11.7.0`，与仓库构建用的 `10.14.0` 分开，不从 PATH 推断版本。

本机开发以 `H:\Code\dsh-editor` 为准；公共插件源码在 `H:\Code\dsh-plugins`。Editor 使用已发布的精确 npm 版本，不依赖旧 D 盘副本或绝对路径链接。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Windows 工作区若带有可继承的 Low 完整性标签，直接运行其中的 Electron 或便携 EXE 会以低权限启动，在 Chromium 创建沙箱窗口站时以 `0x80000003` 退出。资源管理器双击也受同一文件标签影响。保留工作区安全设置，将已校验的发行文件新建复制到普通用户目录后运行；运行时和测试数据也放在该普通目录中，保留 Chromium 沙箱。

`pnpm test:e2e:portable` 会将最终 EXE 复制到系统临时目录，核对 SHA-256，并使用独立 DSH_HOME 和 Electron 用户数据执行验证。报告保留原产物、实测路径与校验值。

检查用 `pnpm build`、`pnpm typecheck`、`pnpm test`；打包与端到端命令见 [package.json](package.json)。

桌面入口在 [apps/desktop/](apps/desktop/)，插件在 [packages/](packages/README.md)，开发约定与跨包架构见[文档索引](docs/README.md)。

## 许可

[SATA 2.1](LICENSE)（Star And Thank Author License）。
