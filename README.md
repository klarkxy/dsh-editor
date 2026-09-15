# DSH Editor

当前桌面版本 **0.2.0**，内置 DSH `0.1.5-rc.2`。下载见 [GitHub Releases](https://github.com/klarkxy/dsh-editor/releases)；已发布变化见 [CHANGELOG](CHANGELOG.md)，main 分支上还有未发布的进展。

DSH Editor 是 Windows / macOS 桌面写作应用。Electron 负责窗口、受限剪贴板、内置运行时与进程生命周期；固定版本的 DSH `0.1.5-rc.2` 继续负责 Agent、会话、模型、工具、审批、用户提问和文件权限。

应用默认显示三栏工作台：

- 左栏是真实目录树。作品是普通文件夹，不预建专业目录；作者确认「新建文件」提案后，才出现该模式需要的目录。栏顶提供搜索和版本操作，辅助文件隐藏；概览从命令面板打开。四个 Preset 共用侧栏文稿校对：当前文档或全部可见 `.md`/`.txt`，kind 为标点 / 错别字 / 敏感词 / 重复 / 口癖，不含 `card`。人物卡与记忆面板默认不装。知乎配置收在设置中。
- 中栏是稿纸：稿内查找替换、打字机滚动、段落聚焦与排版、ghost FIM、选段改写，以及 ‹ › 文档导航。
- 右栏是写作搭档（dsh 对话线程）。新对话先 `list` 四个 Preset，确认后再 blank `create` → `select`，以 Host 返回的真实投影打开：`dsh-editor-writing`（通用写作，默认）、`dsh-editor-novel`（小说创作）、`dsh-editor-article`（文章与自媒体）、`dsh-editor-technical`（技术文档）。已有对话只切换、不改模式。新模式发送纯文本，正文变更走 `writing_propose` V2：edit/split 必须带生成时 Host-read 的 `targetVersion`，merge 必须带 `targetVersion`+`sourceVersion`，renames 每项必须带 `version`；可选 `basis` 是独立的来源依赖列表，不能代替目标基线。全部 V2 操作接受可见项目相对 `.md`/`.txt`。V2 create 是严格 create-if-absent，已有空文件也不覆盖；历史 V1 create 可填充已有空文件。不自动建索引、scratch、frontmatter，也不走 `context.compile`。可见 `dsh-editor-novel` 以 `knowledge-only` 挂 novel-kernel，只多只读 `novel_knowledge`，外加共用的 `writing_propose` / `author_observe`。通用 / 文章 / 技术不挂 novel-kernel。完整小说工具与采访管线只留在隐藏的历史 `dsh-editor`，见[架构 · Legacy](docs/architecture.md#legacy-会话历史-dsh-editor)。⋯ 菜单支持归档、恢复或删除；删除只在本机记墓碑，DSH `0.1.5-rc.2` 没有会话删除。

两侧栏可以折叠或进入专注模式；窗口收窄时，对话以覆盖稿纸的抽屉呈现。

仓库提供三个可独立安装到普通 DSH Web profile 的公开插件，以及随桌面交付的私有插件。`basic` / `smart` / `full` 只是同一桌面能力集合的兼容别名，安装与接口见[组合指南](docs/plugin-composition-guide.md)：

| 组件 | 用途 | 数据所有者 |
| --- | --- | --- |
| Windows / macOS 桌面应用 | 作品初始化、Markdown 写作、写作搭档、修改确认 | 本地作品目录与应用私有数据 |
| `dsh-manuscript` | Web 中的可关闭稿纸抽屉、文件/FIM/查找替换与排版 | DSH workspace、sandbox 与版本化文件 API |
| `dsh-proofread` | 独立中文文本校对，无模型或文件依赖 | 有界只读文本 RPC |
| `dsh-zhihu` | 独立资料查询、知识库与用量；Tool 入口可选 | DSH 凭据与计量 domain |
| `dsh-editor-workbench` | 作品结构、文档概览与状态、校对、进度、导入、快照、移动与归档；通用 `writing_propose` / `author_observe` | 同一 live-session workspace authority |
| `dsh-editor-cards` | 人物卡与世界书（列表、frontmatter、引用导航、新建），Host RPC + Client 座位 | 不发布；默认不装，core 不强依赖；卡片文件仍在作品目录 |
| `dsh-editor-novel-kernel` | 两种模式：`knowledge-only` 只注册 `novel_knowledge`；默认 `legacy`/`full` 才有 V1 `novel_propose`、索引直写、scratch、overview/memory、guard 与系统提示 | 顶层 disabled；可见 `dsh-editor-novel` 显式 `knowledge-only`；完整表面只挂隐藏的 legacy `dsh-editor`；通用 / 文章 / 技术不挂 |
| `dsh-editor-shell` | 桌面唯一根界面、三栏布局与编辑状态、Chat 投影；向插件开放座位与命令注册表 | 不发布、不安装到日常 `web` profile |
| `dsh-editor-proofread-panel` | 文稿校对面板（当前文档 / 全部可见 `.md`/`.txt`；五项 kind，不含 `card`） | 不发布；三份 recipe 均装；只调 workbench `proofread.scan`，顶层 `dsh-proofread` 入口仍可 disabled |
| `dsh-editor-overview-panel` | 作品概览（文档状态、字数分布、写作曲线），通过中栏 overlay 座位接入 | 不发布；只消费 workbench RPC |
| `dsh-editor-memory-panel` | 记忆维护（查看、应用与撤销 AGENTS.md / 人物卡 / 世界书记录），通过侧栏座位接入 | 不发布；默认不装，core 不强依赖；只消费 workbench RPC |
| `dsh-editor-plugins` | 设置里开关非核心插件，并从 GitHub `topic:dsh-plugin` 市场搜索安装 | 不发布；锁定与分类读各包 `dshEditor` 声明 |
| `dsh-editor-workspace-kit` | 私有进程内库：access bag、`.dsh-editor/` sidecar IO、目录/条目校验、no-replace move、frontmatter | 无 Cordis 入口；随依赖它的包复制进运行时 |
| `dsh-editor-seats` | 私有浏览器安全库：Shell 座位、命令注册表、消息卡注册表与快捷键合同 | 无 Cordis 入口；插件与 Shell 构建时内联 |

## 开发启动

开发环境固定为 Windows x64、Node `24.16.0`、pnpm `10.14.0` 和 DSH `0.1.5-rc.2`：

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

`pnpm run dev` 构建 workspace，监听选定组合的桌面插件，然后启动 Electron。Electron 使用仓库内 `.dev/desktop-home`，以随机 loopback 端口启动应用自有 DSH 子进程；不会打开默认浏览器，也不会修改日常 `web` profile。

公开 Web 插件的旧式调试入口仍保留：

```powershell
pnpm run dev:web
```

## 验证与便携 EXE

```powershell
pnpm build
pnpm typecheck
pnpm test --maxWorkers=2 --testTimeout=20000
pnpm test:e2e:desktop
pnpm test:e2e:core-loop
pnpm test:e2e:visual-audit
node e2e/desktop-polish.mjs
node e2e/editor-context-menu.mjs
node e2e/ui-assistant.mjs
pnpm test:e2e:missing-private
pnpm prepare:desktop-runtime
pnpm pack:desktop
pnpm test:e2e:portable
```

全新检出先构建，生成跨包类型声明后再做类型检查。上面的测试参数适用于 Windows；真实模型与知乎调用另见 `pnpm test:e2e:author-flow` 和在线验证记录，需要可用凭据。

`pack:desktop` 使用 Electron Builder 在 `.pack/desktop` 生成未签名产物：Windows 下为 portable EXE 与 NSIS 安装器，macOS 下为 Apple Silicon 的 dmg 与 zip。产物内置 Node、DSH、专用 profile 模板，以及选定组合的业务包（由 `scripts/plugin-manifest.mjs` 按 recipe 的 feature 集合与各包 `dshEditor` 声明解析，含 `dsh-editor-workspace-kit` 这类被依赖的进程内库）。首次启动会把经过整树哈希校验的运行时原子部署到应用自有缓存，之后不调用系统 Node、pnpm 或全局 dsh。Windows SmartScreen 与 macOS Gatekeeper 都可能提示未签名。

公开插件的 tarball 与安装/卸载矩阵仍使用 `pnpm pack:plugins` 和 `pnpm test:e2e:matrix`。仓库脚本不会自动 commit、push、tag 或 publish；推送 `v*` tag 会触发 CI 在 Windows 与 macOS 上构建并把产物上传到对应 GitHub Release（见 [开发者指南](docs/development.md)）。

## 文档

当前手册与包级合同见 [文档索引](docs/README.md)。[0.2.0 本地验收](docs/release-0.2.0.md) 列出本轮测试范围；最终发布产物以对应标签的 CI 与 Release 附件为准。

- [使用者指南](docs/user-guide.md)
- [开发者指南](docs/development.md)
- [产品原则](docs/product-principles.md)
- [界面与设计系统](docs/ui.md)
- [架构与边界](docs/architecture.md)
- [插件架构与接口](docs/plugin-architecture.md)
- [可组合插件指南](docs/plugin-composition-guide.md)
- [作者优先工作流](docs/author-first-workflow.md)
- [交互架构图站](https://klarkxy.github.io/dsh-editor/)
- [CHANGELOG](CHANGELOG.md)

DSH Editor 的 loopback RPC 只适用于本地单用户信任模型，不应暴露成远程多用户文件接口。

## 许可

本仓库采用 [SATA 2.1](https://github.com/klarkxy/sata-license)（Star And Thank Author License）。完整文本见 [LICENSE](LICENSE)。
