# DSH Editor 开发者指南

需要修改、替换或建立插件时，先阅读 [插件架构与接口](plugin-architecture.md)。改界面或主题时先读 [界面与设计系统](ui.md)；改产品边界时先读 [产品原则](product-principles.md)。

本文适用于桌面 **0.2.0**；[文档索引](README.md) 和 [本轮验收记录](release-0.2.0.md) 汇总当前入口与证据。

## 环境与固定版本

- Windows x64
- Node.js `24.16.0`
- pnpm `10.14.0`
- `@deepseek-ai/dsh` `0.1.5-rc.2`

```powershell
node --version
pnpm --version
dsh --version
pnpm install --frozen-lockfile
pnpm build
```

脚本会从实际 DSH package root 校验版本。需要覆盖定位时可设置绝对 `DSH_CLI_PATH`；无效路径会直接失败，不会静默换用其他版本。

## 仓库结构

```text
apps/desktop/                  Electron main、profile 部署、进程监督与 portable 配置
packages/                      公开与私有插件、座位库、workspace-kit
scripts/                       开发、物化、打包与校验
docs/                          当前手册与文档索引
docs/diagrams/                 交互图规范与发布 HTML
e2e/                           Playwright 验收脚本
.dev/                          本地忽略。只保留 desktop-home、desktop-profile-template、desktop-dsh-runtime、dsh-home
.pack/                         打包产物（忽略，可删除后重打）
```

各包职责见下文「插件包职责」。共享 manifest、lockfile、profile、Electron 生命周期和 Git 状态由集成者统一维护。Renderer 不得新增 Node 文件访问或第二个 DSH connection。`.dev` 里除上述四个目录外的探测脚本、测试 home 和日志均可删除；`e2e/out` 与 `.pack` 也可随时清掉后重跑生成。

## 常用命令

下表是开发者视角的完整命令清单，含参数与适用场景；README「验证与便携 EXE」一节的命令块是发布前的精简版，两者分工以此为准。

| 命令 | 作用 |
| --- | --- |
| `pnpm run dev` | 构建 workspace、监听当前组合的桌面包并启动 Electron DSH Editor |
| `pnpm run dev:web` | 调试公开插件在普通 DSH Web profile 中的行为 |
| `pnpm render:icon` | 从受版本控制的 SVG 源重新生成桌面 PNG 与 Windows ICO |
| `pnpm typecheck` | 全 workspace 类型检查 |
| `pnpm test` | 全部 Vitest contract/behavior 测试 |
| `pnpm build` | 构建桌面 main 与全部 workspace 插件 |
| `pnpm test:e2e:desktop` | 驱动真实 Electron 当前源码窗口 |
| `pnpm test:e2e:core-loop` | 驱动 Home → 作品 → 稿纸 → 搭档 的核心闭环 |
| `pnpm test:e2e:visual-audit` | 顶栏/三栏/双主题 的精简视觉走查 |
| `pnpm test:e2e:author-flow` | 带凭据的端到端 AI 流程（可选） |
| `pnpm test:e2e:missing-private` | 隔离移除每个必需私有 Host 包并确认 DSH 启动失败 |
| `pnpm prepare:desktop-runtime` | 物化并哈希 Node、DSH、profile 与包闭包 |
| `pnpm test:e2e:portable` | 真正启动 portable 外层 EXE，检查三栏 GUI、退出码与端口清理 |
| `pnpm pack:desktop` | 生成未签名产物：Windows 为 portable EXE + NSIS 安装器，macOS 为 Apple Silicon 的 dmg/zip |
| `pnpm pack:plugins` | 生成三个公开插件 tarball（manuscript、proofread、zhihu） |
| `pnpm test:e2e:matrix` | 公开插件 fresh-home 安装/卸载矩阵 |
| `pnpm verify:desktop` | 桌面 typecheck、unit、build、桌面 E2E 与核心闭环 |
| `pnpm verify:delivery` | 桌面验证、公开插件矩阵、缺包负向 smoke、桌面打包和 portable E2E |

## 正文菜单验收

完成 `pnpm build` 与 `node scripts/prepare-desktop-dev.mjs` 后运行 `node e2e/editor-context-menu.mjs`。脚本启动隔离作品的 Electron 窗口，默认先验证原生系统剪贴板；环境拒绝访问时输出 blocked 报告并退出 2，不把这一项算通过。

可显式使用 `node e2e/editor-context-menu.mjs --clipboard=memory` 验证菜单到 preload / IPC / 编辑事务的行为。此模式使用主进程纯文本测试替身；延迟读取用专门的 IPC 驱动，AI 使用确定性的 fetch 响应，均不代表真实剪贴板或在线模型验收。中文输入覆盖模拟组字键事件，仍需人工真实输入法走查。报告与截图保存在 `e2e/out/editor-context-menu/<时间>/`。桌面交互测试串行运行，避免窗口抢焦点。

## `pnpm run dev`

桌面入口在缺少 `lib/` 或 `apps/desktop/dist` 产物时全量构建 workspace；产物已在则跳过，由 watcher 增量编译。设 `DSH_DEV_FORCE_BUILD=1` 可强制重编。随后运行 `prepare-desktop-dev.mjs`：

1. 验证 Windows x64、Node 和 DSH 精确版本；
2. 将 DSH 依赖闭包物化到 `.dev/desktop-dsh-runtime`；
3. 按 `scripts/plugin-manifest.mjs` 解析当前 recipe（canonical `desktop.json`；`DSH_EDITOR_COMPOSITION` 接受 `desktop` / `basic` / `smart` / `full`，默认 `desktop`），把选中的包与被依赖的库（`libraries`，如 workspace-kit）以目录联接放到 `.dev/desktop-profile-template/node_modules`（`DSH_EDITOR_COPY_PACKAGES=1` 时改为拷贝，且不带 `.map`）；
4. 使用 `.dev/desktop-home`，并把 Electron userData 放到该 home 下的 `electron-user-data`，避免和本机其他未命名 Electron 抢单实例锁；
5. 清掉上次残留的 tsdown watcher / Electron / DSH，再启动当前组合的插件 watcher；
6. 等全部 watcher 完成首轮编译（wrap-client 包等到 `wrapped`）后再启动 Electron，避免 DSH 读到正在改写的 `lib/`；
7. Electron 部署带 owner marker 的 `profiles/dsh-editor`；
8. 以 `127.0.0.1:0 --no-open` 启动 DSH 并加载返回的同源 URL。关闭时会等 `taskkill` 结束，避免 watcher 变成孤儿。

关闭 Electron 会停止 watcher 和 DSH。不要把 `.dev` 复制、分享或提交；其中可能包含隔离 profile 的本地会话状态。

`DSH_DESKTOP_PREPARE_ONLY=1` 只做构建和开发资源准备，供诊断使用。

应用内更新下载默认按「内置 GitHub 镜像列表 → github.com 直连」的顺序尝试；`DSH_UPDATE_MIRRORS`（逗号分隔的前缀式镜像地址，如 `https://ghproxy.net/`）可在内置列表之前追加自有镜像。下载完成后按 release 里的 `sha256sums.txt` 校验完整性（发布工作流自动上传该文件）。

## 插件包职责

各包职责、Cordis entry id、`inject` 清单、座位合同与 RPC 端点目录都以 [插件架构与接口](plugin-architecture.md) 为准，本节不再复述。下面只保留改代码时直接涉及的维护点。

### 写作模式 preset 的归属与开关

- 模板源 `apps/desktop/resources/profile/agent-presets/` 只保留核心 `dsh-editor-writing`（永远部署、不可关闭）与 legacy `dsh-editor`（开发者模式诊断）。`dsh-editor-novel` 由 `packages/dsh-editor-novel-kernel/presets/` 提供，`dsh-editor-article` / `dsh-editor-technical` 由 `packages/dsh-editor-writing-presets/presets/` 提供；包经 `dshEditor.presets` 声明，`configureProfile` 在物化模板时把目录复制进 `agent-presets/` 并写入 app-owned marker，仍由 `deployAgentPresets` 通道部署。
- 作者在设置「插件 → 写作模式」里开关这三个第一方 preset：状态存 `<dshHome>/dsh-plugins.json` 的 `presets` 字段；开关立即部署/删除 `<dshHome>/.agent-presets/<id>`，picker 下次列表即反映，无需重启；进行中的会话不受影响。修改 preset 内容时改包内源目录，不要再放回 resources。
- 禁止 `pwsh` / `bash` 等终端与直接写入的 Host tool guard 只对四个写作 Preset 与 legacy `dsh-editor` 生效。官方或社区 Agent 模式（开发者模式可选）不得被该守卫拦截。

### Legacy 退出判据（Phase 3d）

3a 恢复测试与迁移入口已上线。下一个 minor 版本删除 legacy 采访 / 自动索引 / scratch 旧流程与 `dsh-editor` preset（保留 V1 提案解析与章节 frontmatter 解析做转录兼容），届时删除本判据。

### 打包与注入

- shell package 必须导出 `./package.json`；DSH 客户端发现依赖该公开解析契约。
- 客户端注入有顺序：`dsh.client.inject` 先拉 `@deepseek-ai/dsh-typert-registry` 与 `@deepseek-ai/dsh-api-gateway`，再挂 connection / ui-settings / session-controller / workspace-controller / remotes / ui-session。缺 gateway 时 remotes `$mount` 不完成，写作壳不会出现。

### 设置弹窗与上游协议

- 设置弹窗由 shell 自建：`src/client/settings*.tsx` 与 `src/client/ui/`，其中 `select.tsx` 包装 Radix Select。
- 弹窗内不使用原生 `<select>`（Windows Chromium 下其弹层不跟随 color-scheme）；残留原生下拉的 ink 兜底规则在 `styles.ts` 的 `baseStyles` 尾部。
- profile patch（`apps/desktop/resources/profile/cordis.patch.yml`）禁用上游 `ui-settings-general`/`ui-settings-models`，保留 `ui-settings`（提供 settingsScope/settingsSchema 服务）；升级 DSH 时与 root slot 遮蔽一并复查。
- 通用设置写 `ui-theme`/`locale`/`ui-conversation` namespace；模型页走 `llm.providers`/`settings.mutate`/`credentials.*`/`llm.discoverModels`，与上游同协议。

### 文件树、搜索与剪贴板

- `auxiliary-files.ts` 同时用于文件树和 SearchPanel 接受结果的边界，批量替换只使用已接受的作者文件结果。隐藏文件不会因此被删除或禁止写作搭档读取。
- 正文剪贴板经 `apps/desktop/preload.cjs` 与 `src/clipboard.ts` 的受限 IPC 调用主进程，写入正文前再次校验文档代次、版本与选区；公开 Web 使用自己的安全退路。

### 图表与模型页

- 用量图在 `client/settings-usage.tsx` 按需引入 ECharts 的 Bar / Grid / Tooltip / Aria / SVG，`tsdown.config.ts` 将 ECharts 与 zrender 内联；不要新增运行时 CDN。
- 模型页分配补全、改写和新对话默认模型。更改提供方后刷新目录，显示 provider 来源，已有对话保留原选择。

## 测试

单元测试重点覆盖：

- workspace/session authority、traversal/device/symlink、原子 create/save、stale version、read-only；
- draft/conflict/FIM、选区 ticket、stale/abort/bounds；
- Chat rows、partial stream、send/cancel/history、approval/questions、model/permission；
- profile owner collision、原子部署；
- DSH readiness parsing、timeout、unexpected exit、优雅关闭与 exact tree fallback。

桌面 E2E 必须在允许 GUI 的会话中执行：

```powershell
pnpm build
pnpm test:e2e:desktop
```

报告与截图写到 `.pack/desktop-e2e`。成功标准包含：

- loopback 随机端口；
- `document.title === 'DSH Editor'`；
- 私有 `.shell` 已挂载且没有官方首页身份；
- 默认呈现三栏：左侧文件树（只列真实存在的目录；作品是普通文件夹，专业目录只在作者采用 create 提案后出现）、中央稿纸、右侧写作搭档；
- 外窗可缩到 1280×720；
- 关闭后原端口不可访问。

本轮界面回归还包括 `node e2e/desktop-polish.mjs`、`node e2e/editor-context-menu.mjs` 与 `node e2e/ui-assistant.mjs`；它们分别覆盖设置 / 文件栏 / 图表、正文菜单和搭档写作。`desktop-polish` 的用量数据和部分外部响应使用固定样例，不能据此声称在线模型质量或供应商计量正确。

公开插件矩阵与可选凭据化 live E2E 的输出继续位于 `e2e/out`。历史报告不得用作新 DSH/Node/源码版本的证据。

## 桌面构建（Portable / 安装版 / macOS）

```powershell
pnpm build
pnpm prepare:desktop-runtime
pnpm pack:desktop
```

准备脚本会清理并重建 `.pack/desktop-runtime`，复制：

- `node-24.16.0/`（Windows 为 `node.exe`，macOS 为 `node`）；
- 完整、dereference 后的 DSH `0.1.5-rc.2` 依赖闭包；
- 当前 recipe（canonical `desktop`）解析出的全部业务包与库（`composition.json` 里的 `packages` + `libraries`）；
- 含私有依赖的 profile 模板；
- `manifest.json` 中的平台、文件数、字节数与 tree SHA-256。

运行时物化支持 `win32-x64`、`darwin-x64`、`darwin-arm64`，其他平台会直接报错。Electron Builder 读取这些已校验资源，按当前平台输出到 `.pack/desktop/`：Windows 产出 portable EXE（`DSH Editor-<版本>-win-x64.exe`）与 NSIS 安装器（`DSH Editor-Setup-<版本>-win-x64.exe`）；macOS 产出 Apple Silicon 的 dmg 与 zip。应用未签名：Windows 的 SmartScreen 提示与 macOS 的「无法验证开发者」都不是构建失败；签名与公证仍不在授权范围。

桌面品牌图标的单一源文件是 `apps/desktop/build/icon.svg`。修改后运行 `pnpm render:icon`，同步生成并提交 `icon.png` 与包含 16–256 像素尺寸的 `icon.ico`。开发窗口使用 PNG；打包钩子用固定版本的 standalone `rcedit` 把图标写入应用 EXE，NSIS 把同一 ICO 写入 portable 外壳，macOS 图标由 electron-builder 从 1024×1024 PNG 派生。这样无需为未签名构建解压 electron-builder 的跨平台签名工具包；生成命令仍需要仓库 Playwright 浏览器与 Python Pillow 环境。

## Release CI

推送 `v*` tag 会触发 `.github/workflows/release.yml`。标签必须严格等于 `v` 加桌面应用版本号，不一致会在构建前失败。之后 Windows 与 macOS runner 各自安装固定版本的 DSH CLI 和 workspace 依赖，先 `pnpm build`，再做类型检查与单元测试；Windows 还运行桌面和核心写作 E2E，随后两平台分别打包。

统一上传任务等待两个平台成功后，把产物与 `sha256sums.txt` 上传到该 tag 的 GitHub Release（不存在则创建）。也可以用 workflow_dispatch 输入 tag，给已发布版本补传产物。tag、release 标题与 notes 由发布者维护；CI 只负责构建与上传。

正式发布前先创建 draft Release，再推送标签。保持 draft，直到两平台任务成功、下载文件与 SHA-256 一致，且下载后的 Windows 便携包实际启动、保存与退出验证通过，最后再公开。不要把先前本地包的验收当成该标签下载包的证据。

## 安全审查清单

- BrowserWindow 保持 `nodeIntegration: false`、`contextIsolation: true`、sandbox；
- 只允许本次 DSH `127.0.0.1:<port>` 导航/请求，拒绝新窗口和权限；
- CSP 的 `unsafe-eval` 仅因为固定 DSH 客户端模块系统需要，不能扩大外部 origin；
- profile 同名无 marker 时必须拒绝覆盖；
- 只能终止 Supervisor 记录的 DSH 进程树；
- Renderer 不得读取凭据明文或直接调用 Node fs；文件权限由 Host 重建；
- Chat Renderer 不执行工具；DSH Agent 只能在 guard 下调用受限检索、只读知识、非写入提案与限量提问，不直接写正文，也不保存历史副本。四个新 Preset 挂 `dsh-editor-workbench/tools`（`writing_propose` / `author_observe`）。可见 `dsh-editor-novel` 另以 `knowledge-only` 挂 novel-kernel（仅 `novel_knowledge`，无 kernel guard / prompt，无提案 / 索引 / scratch / overview / memory）。完整表面（显式 `mode: legacy`）与采访 / 索引 / frontmatter / `context.compile` 管线只留在 hidden legacy `dsh-editor`。新模式不自动建索引、scratch 或 frontmatter，也不走 `context.compile`。不挂载官方 `standard` 编码工具目录；
- 任何 commit、push、tag、publish、release 或签名必须另行授权。

## DSH 升级

升级时同步修改并验证：

- 固定版本脚本、peer/dev dependencies、lockfile、profile bundle、内置资源路径；
- SessionFace/ConversationSnapshot、root priority、CSP、Host RPC；
- 公开插件矩阵和 portable EXE。

任何一项依赖 DSH 私有 UI 内部实现时，应停止升级，而不是复制官方 Agent/UI 内部代码。
