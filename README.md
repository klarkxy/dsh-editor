# DSH Editor

DSH Editor 是 Windows / macOS 桌面写作应用。Electron 只负责单窗口、内置运行时与进程生命周期；固定版本的 DSH `0.1.1-rc.2` 继续负责 Agent、会话、模型、工具、审批、用户提问和文件权限。应用默认显示三栏工作台：左是真实目录树（新建作品只预建 `正文/`，大纲/人物卡/世界书等在实际创建后出现；栏顶有搜索、校对、概览、人物、设定、提交、历史），中是稿纸编辑器（稿内查找替换、打字机滚动、段落聚焦与排版、ghost FIM、选段改写、‹ › 章节导航），右是 dsh 对话线程（⋯ 菜单可归档、恢复或删除——删除只在本机记墓碑，DSH `0.1.1-rc.2` 没有会话删除）；两侧栏可以折叠或进入专注模式。

仓库提供三个可独立安装到普通 DSH Web profile 的公开插件，以及随桌面组合交付的私有插件。基础、智能和完整写作组合的安装与接口见[组合指南](docs/plugin-composition-guide.md)：

| 组件 | 用途 | 数据所有者 |
| --- | --- | --- |
| Windows 桌面应用 | 项目初始化、Markdown 写作、写作助手、修改确认 | 本地作品目录与应用私有数据 |
| `dsh-manuscript` | Web 中的可关闭稿纸抽屉、文件/FIM/查找替换与排版 | DSH workspace、sandbox 与版本化文件 API |
| `dsh-proofread` | 独立中文文本校对，无模型或文件依赖 | 有界只读文本 RPC |
| `dsh-zhihu` | 独立资料查询、知识库与用量；Tool 入口可选 | DSH 凭据与原计量 domain |
| `dsh-editor-workbench` | 项目、概览/章节状态、校对、进度、上下文、导入、快照、移动与归档 | 同一 live-session workspace authority |
| `dsh-editor-cards` | 人物卡与世界书（列表、frontmatter、引用导航、新建），Host RPC + Client 座位 | 不发布；卡片文件仍在作品目录 |
| `dsh-editor-novel-kernel` | 小说知识、预览提案、索引直写、工具守卫、系统提示词与旧知乎接口转发 | DSH 工具与作者确认边界 |
| `dsh-editor-shell` | 桌面唯一根界面、布局与编辑状态、Chat 投影；向插件开放侧栏座位与命令注册表 | 不发布、不安装到日常 `web` profile |
| `dsh-editor-proofread-panel` | 作品校对面板（当前章/全稿扫描、人物卡对照、应用建议），通过 Shell 座位接入 | 不发布；只消费 workbench RPC |
| `dsh-editor-overview-panel` | 作品概览（章节状态、字数分布、写作曲线），通过中栏 overlay 座位接入 | 不发布；只消费 workbench RPC |
| `dsh-editor-memory-panel` | 记忆维护（查看、应用与撤销 AGENTS.md / 人物卡 / 世界书记录），通过侧栏座位接入 | 不发布；只消费 workbench RPC |
| `dsh-editor-plugins` | 设置里开关非核心插件，并从 GitHub `dsh-plugin` 市场搜索安装 | 不发布；锁定与分类读各包 `dshEditor` 声明 |
| `dsh-editor-workspace-kit` | 私有进程内库：access bag、`.dsh-editor/` sidecar IO、目录/条目校验、no-replace move、frontmatter | 无 Cordis 入口；随依赖它的包复制进运行时 |
| `dsh-editor-seats` | 私有浏览器安全库：Shell 座位名、`ShellToolSeatContext`、命令注册表与快捷键匹配 | 无 Cordis 入口；插件与 Shell 构建时内联 |

## 开发启动

开发环境固定为 Windows x64、Node `24.16.0`、pnpm `10.14.0` 和 DSH `0.1.1-rc.2`：

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
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e:desktop
pnpm test:e2e:core-loop
pnpm test:e2e:visual-audit
pnpm test:e2e:author-flow
pnpm test:e2e:missing-private
pnpm prepare:desktop-runtime
pnpm pack:desktop
pnpm test:e2e:portable
```

`pack:desktop` 使用 Electron Builder 在 `.pack/desktop` 生成未签名产物：Windows 下为 portable EXE 与 NSIS 安装器，macOS 下为 Apple Silicon 的 dmg 与 zip。产物内置 Node、DSH、专用 profile 模板，以及选定组合的业务包（由 `scripts/plugin-manifest.mjs` 按 recipe 的 feature 集合与各包 `dshEditor` 声明解析，含 `dsh-editor-workspace-kit` 这类被依赖的进程内库）；首次启动会把经过整树哈希校验的运行时原子部署到应用自有缓存，之后不调用系统 Node、pnpm 或全局 dsh。Windows SmartScreen 与 macOS Gatekeeper 都可能提示未签名。

公开插件的 tarball 与安装/卸载矩阵仍使用 `pnpm pack:plugins` 和 `pnpm test:e2e:matrix`。仓库脚本不会自动 commit、push、tag 或 publish；推送 `v*` tag 会触发 CI 在 Windows 与 macOS 上构建并把产物上传到对应 GitHub Release（见 [开发者指南](docs/development.md)）。

## 文档

- [可组合插件指南](docs/plugin-composition-guide.md)：独立安装、三份桌面配置、接口与真实插件开发范本
- [拆分实施记录](docs/plugin-modularization-progress.md)：逐阶段验收与宿主限制
- [声明式拼装与 Shell 座位记录](docs/plugin-assembly-progress.md)：`dshEditor` 拼装、座位/注册表、垂直插件迁出与验收

- [插件拆分与组合演进计划](docs/plugin-modularization-plan.md)：首批独立校对插件、可选 AI/资料能力、分阶段交付与验收

- [插件组合能力验证](docs/plugin-composability-validation.md)：独立安装实测、官方界面与 Harness 边界、插件职责、接口和工作流程图

- [使用者指南](docs/user-guide.md)：桌面启动、三栏工作台、核心写作闭环、设置、快捷键与公开插件使用
- [开发者指南](docs/development.md)：运行时准备、调试、测试与打包
- [产品原则](docs/product-principles.md)：作者写稿、提案确认、明确不做
- [界面与设计系统](docs/ui.md)：纸 / 墨 token、三栏布局与稿纸交互
- [架构与边界](docs/architecture.md)：DSH 权威边界、profile、RPC 与安全约束
- [插件架构与接口](docs/plugin-architecture.md)：声明式拼装（`dshEditor` + feature recipe）、Shell 座位与命令注册表、RPC/Tool/slot 契约以及修改、替换和新建插件流程
- [交互架构图站](https://klarkxy.github.io/dsh-editor/)：GitHub Pages 发布的全部交互图
- [桌面运行时图](https://klarkxy.github.io/dsh-editor/dsh-editor-runtime.html)：Electron 启动 DSH 子进程；插件住在 Host 内
- [插件分级图](https://klarkxy.github.io/dsh-editor/dsh-editor-plugins.html)：三个公开 tarball 与桌面私有包
- [组合边界图](https://klarkxy.github.io/dsh-editor/plugin-composition-boundaries.html)：普通业务、可选智能增强、公开插件
- [确认写入时序图](https://klarkxy.github.io/dsh-editor/author-confirm-write.html)：从 context 编译到作者确认写入
- [CHANGELOG](CHANGELOG.md)：版本变化

DSH Editor 的 loopback RPC 只适用于本地单用户信任模型，不应暴露成远程多用户文件接口。

## 许可

本仓库采用 [SATA 2.1](https://github.com/klarkxy/sata-license)（Star And Thank Author License）。完整文本见 [LICENSE](LICENSE)。
