# DSH Editor 开发者指南

需要修改、替换或建立插件时，先阅读 [插件架构与接口](plugin-architecture.md)。改界面或主题时先读 [界面与设计系统](ui.md)；改产品边界时先读 [产品原则](product-principles.md)。

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
```

脚本会从实际 DSH package root 校验版本。需要覆盖定位时可设置绝对 `DSH_CLI_PATH`；无效路径会直接失败，不会静默换用其他版本。

## 仓库结构

```text
apps/desktop/                  Electron main、profile 部署、进程监督与 portable 配置
packages/dsh-editor-shell/     仅桌面 profile 加载的私有写作客户端（src/client/{root,sidebar,editor,chat,dialogs,theme,components,shared}）
packages/dsh-editor-plugins/   私有插件管理：开关、GitHub 市场搜索与安装
packages/dsh-editor-workbench/ 私有项目生命周期与 context Host
packages/dsh-editor-novel-kernel/ 私有小说 Tool、guard、prompt 与知识卡
packages/dsh-editor-cards/     私有垂直插件：/dsh-editor-cards Host RPC + contracts + 卡片面板/详情 Client
packages/dsh-editor-proofread-panel/ 私有 client-only：作品校对面板（侧栏座位 + 两条命令）
packages/dsh-editor-overview-panel/  私有 client-only：作品概览（中栏 overlay 座位）
packages/dsh-editor-memory-panel/    私有 client-only：记忆维护面板 + Chat 记忆更新卡
packages/dsh-editor-workspace-kit/   私有进程内库：access bag、sidecar IO、条目/目录校验、no-replace move、frontmatter
packages/dsh-editor-seats/     私有浏览器安全库：Shell 座位合同、命令与消息卡注册表
packages/dsh-manuscript/       Host RPC、公开 Web 稿纸插件与共享 editor-core（src/client/editor-core/）
packages/dsh-proofread/        公开校对引擎与 /proofread
packages/dsh-zhihu/            公开资料 RPC、自有 UI 与可选 Tool
scripts/dev.mjs                GUI-first 桌面开发入口
scripts/dev-web.mjs            公开插件的 Web 调试入口
scripts/prepare-desktop-*.mjs  开发/打包运行时物化与校验
e2e/core-loop.mjs              Playwright Electron 核心闭环验收
e2e/visual-audit.mjs           Playwright Electron 精简视觉走查
e2e/desktop.mjs                Playwright Electron 当前源码验收
e2e/author-flow-live.mjs       带凭据的端到端 AI 流程
e2e/plugin-matrix.mjs          公开插件 fresh-home 安装/卸载矩阵
e2e/portable.mjs               portable EXE 验收
e2e/missing-private-plugin.mjs 缺私有 Host 包的负向 smoke
.dev/                          本地桌面 DSH home/runtime（忽略）
.pack/                         portable、报告、哈希和公开插件包（忽略）
```

共享 manifest、lockfile、profile、Electron 生命周期和 Git 状态由集成者统一维护。Renderer 不得新增 Node 文件访问或第二个 DSH connection。

## 常用命令

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

## `pnpm run dev`

桌面入口先构建全部 workspace，再运行 `prepare-desktop-dev.mjs`：

1. 验证 Windows x64、Node 和 DSH 精确版本；
2. 将 DSH 依赖闭包物化到 `.dev/desktop-dsh-runtime`；
3. 按 `scripts/plugin-manifest.mjs` 解析当前 recipe，把选中的包与被依赖的库（`libraries`，如 workspace-kit）物化到 `.dev/desktop-profile-template/node_modules`；
4. 使用 `.dev/desktop-home`；
5. 启动该组合的插件 watcher 和 Electron；
6. Electron 部署带 owner marker 的 `profiles/dsh-editor`；
7. 以 `127.0.0.1:0 --no-open` 启动 DSH 并加载返回的同源 URL。

关闭 Electron 会停止 watcher 和 DSH。不要把 `.dev` 复制、分享或提交；其中可能包含隔离 profile 的本地会话状态。

`DSH_DESKTOP_PREPARE_ONLY=1` 只做构建和开发资源准备，供诊断使用。

应用内更新下载默认按“内置 GitHub 镜像列表 → github.com 直连”的顺序尝试；`DSH_UPDATE_MIRRORS`（逗号分隔的前缀式镜像地址，如 `https://ghproxy.net/`）可在内置列表之前追加自有镜像。下载完成后按 release 里的 `sha256sums.txt` 校验完整性（发布工作流自动上传该文件）。

## 插件包职责

### `dsh-editor-shell`

- Host 入口注册 `dsh-editor-writing` 设置 schema，并让 DSH 发布 `./client`。
- package 必须导出 `./package.json`；DSH 客户端发现依赖该公开解析契约。
- 通过 root slot `priority: -100` 遮蔽官方 priority 0 AppFrame；最低 priority 渲染。该行为与 rc.2 root 类型声明中的普通插件指导相冲突，只允许在固定 `0.1.5-rc.2`、私有 `dsh-editor` profile 和完整 E2E 闸门下使用；它是明确的升级阻断点。
- 客户端注入 `slots`、`sessions`、`workspaces`、`connection`、`settingsScope`、`settingsSchema`、`remote`、`remote.session` / `settings` / `credentials` / `llm` / `directoryPicker` 和 `uiSession`。`dsh.client.inject` 必须先拉 `@deepseek-ai/dsh-typert-registry` 和 `@deepseek-ai/dsh-api-gateway`，再挂 connection / ui-settings / session-controller / workspace-controller / remotes / ui-session；缺 gateway 时 remotes `$mount` 不完成，写作壳不会出现。
- 设置弹窗由 shell 自建（`src/client/settings*.tsx` + `select.tsx` 自制下拉）：profile patch（`apps/desktop/resources/profile/cordis.patch.yml`）禁用上游 `ui-settings-general`/`ui-settings-models`，但保留 `ui-settings`（提供 settingsScope/settingsSchema 服务）。通用设置写 `ui-theme`/`locale`/`ui-conversation` namespace，模型页走 `llm.providers`/`settings.mutate`/`credentials.*`/`llm.discoverModels` 与上游同协议。上游升级（DSH_VERSION）时需复查这些 API 与禁用条目——与 root slot 遮蔽同为升级阻断点。
- 弹窗内不使用原生 `<select>`（Windows Chromium 下其弹层不跟随 color-scheme）；残留原生下拉的 ink 兜底规则在 styles.ts 的 baseStyles 尾部。
- `DshChatPort` 只投影单一 `ConversationSnapshot`，不 `connection.start()`、不持久化 Chat。

### `dsh-editor-workbench`

- Host-only 私有包，独占 `/dsh-editor-workbench`。
- 负责项目结构、章节概览/状态、校对扫描、写作进度、context、导入、快照、移动与归档；复用 `dsh-manuscript/host-api` 的同一 workspace authority。卡片 RPC 在 `dsh-editor-cards`；workbench 只通过 `host-api` 读卡做校对对照。
- 主入口 `inject` 为 `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`。可选 `dsh-editor-workbench/tools` 入口另注入 `tools`，只注册只读 `novel_overview`。
- `./contracts` 只含 browser-safe channel、类型、解析器与纯函数，并由 Shell client 构建内联。

### `dsh-editor-novel-kernel`

- Host-only 私有包，注册七个小说工具、guard 与 `dsh-editor:novel-kernel` prompt；不再提供 `/novel-kernel` 通道，知乎知识库走 `/zhihu`。
- Host `inject` 为 `tools`, `systemPrompt`, `fs`, `sandboxPolicy`。
- Tool 只返回知识或预览提案，正文写入仍由 Shell 展示并经 `/manuscript proposal.prepare/apply` 完成；拆章/合章/批量重命名走 workbench `proposal.*`。
- `./contracts` 只含工具名、proposal / memory marker 类型和严格解析器。

### `dsh-manuscript`

- Host：`packages/dsh-manuscript/src/index.ts`
- RPC：`/manuscript`
- 文件 authority 来自 live session 的 `header.cwd`；浏览器 cwd/provider/model 一律不可信。
- `patch.complete` 和 FIM 从 live request header 选择模型，支持 abort 与有界输入。
- 公开 Web 客户端继续注册 `shell.overlay`，不得占 root。

### `dsh-proofread`

- 公开包：`/proofread` 文本校对，只注入 `connection`，不依赖 session、文件或模型。
- 引擎、词库与 contracts 是纯库；桌面 workbench 把它们当依赖，不经过这条 RPC。

### `dsh-zhihu`

- 公开包：`/zhihu` 资料、知识库与用量；自有 UI 同时挂官方 overlay 和桌面 `dsh-editor.extensions`。
- Tool 入口 `dsh-zhihu/tools` 按组合选择，默认 full 才加入。

### `dsh-editor-plugins`

- 私有包：`/dsh-editor-plugins` 列出/开关已装插件，并从 GitHub `topic:dsh-plugin` 搜索安装。
- 核心入口（稿纸、工作台、写作界面、插件管理）与 `@deepseek-ai/*` 不能关闭或卸载。
- 市场安装写入 `$DSH_HOME/user-plugins/`，桌面每次部署 profile 后重新挂回；安装与卸载后需要重启。
- 安装前 `marketplace.inspect` / 安装时同一套静态检查：构建产物、patch insert、root 冲突、DSH/cordis 主版本、客户端 lazy-CJS。`blocked` 拒绝安装。这不能证明运行时一定成功。

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
- 默认呈现三栏：左侧文件树（只列真实存在的目录，正文预建，大纲/人物卡/世界书等在实际创建后出现）、中央稿纸、右侧写作搭档；
- 外窗可缩到 1280×720；
- 关闭后原端口不可访问。

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
- 当前 recipe 解析出的全部业务包与库（`composition.json` 里的 `packages` + `libraries`）；
- 含私有依赖的 profile 模板；
- `manifest.json` 中的平台、文件数、字节数与 tree SHA-256。

运行时物化支持 `win32-x64`、`darwin-x64`、`darwin-arm64`，其他平台会直接报错。Electron Builder 读取这些已校验资源，按当前平台输出到 `.pack/desktop/`：Windows 产出 portable EXE（`DSH Editor-<版本>-win-x64.exe`）与 NSIS 安装器（`DSH Editor-Setup-<版本>-win-x64.exe`）；macOS 产出 Apple Silicon 的 dmg 与 zip。应用未签名：Windows 的 SmartScreen 提示与 macOS 的“无法验证开发者”都不是构建失败；签名与公证仍不在授权范围。

桌面品牌图标的单一源文件是 `apps/desktop/build/icon.svg`。修改后运行 `pnpm render:icon`，同步生成并提交 `icon.png` 与包含 16–256 像素尺寸的 `icon.ico`；开发窗口使用 PNG，打包钩子用固定版本的 standalone `rcedit` 写入应用 EXE，NSIS 将同一 ICO 写入 portable 外壳，mac 图标由 electron-builder 从 1024×1024 PNG 派生。这样无需为了未签名构建解压 electron-builder 的跨平台签名工具包；生成命令仍需要仓库 Playwright 浏览器与 Python Pillow 环境。

## Release CI

推送 `v*` tag 会触发 `.github/workflows/release.yml`：Windows 与 macOS runner 各自安装 pin 版本的 DSH CLI、`pnpm install --frozen-lockfile`、`pnpm pack:desktop`，然后把产物上传到该 tag 的 GitHub Release（不存在则创建）。也可以用 workflow_dispatch 输入 tag 给已发布版本补传产物。tag、release 标题与 notes 仍由人工维护；CI 只负责构建与上传。

## 安全审查清单

- BrowserWindow 保持 `nodeIntegration: false`、`contextIsolation: true`、sandbox；
- 只允许本次 DSH `127.0.0.1:<port>` 导航/请求，拒绝新窗口和权限；
- CSP 的 `unsafe-eval` 仅因为固定 DSH 客户端模块系统需要，不能扩大外部 origin；
- profile 同名无 marker 时必须拒绝覆盖；
- 只能终止 Supervisor 记录的 DSH 进程树；
- Renderer 不得接触 credential、absolute path 或 Node fs；
- Chat Renderer 不执行工具；DSH Agent 只能在 guard 下调用受限检索、只读知识、非写入提案、限量提问与 `.dsh-editor/scratch/` 临时工作区，不直接写正文，也不保存历史副本；写作会话挂载桌面应用部署的 `dsh-editor` 专属 agent preset（只含 read/glob/grep、ask_user_question 与 compaction），不挂载官方 `standard` 编码工具目录；
- 任何 commit、push、tag、publish、release 或签名必须另行授权。

## DSH 升级

升级时同步修改并验证：固定版本脚本、peer/dev dependencies、lockfile、profile bundle、内置资源路径、SessionFace/ConversationSnapshot、root priority、CSP、Host RPC、公开插件矩阵和 portable EXE。任何一项依赖 DSH 私有 UI 内部实现时，应停止升级而不是复制官方 Agent/UI 内部代码。
