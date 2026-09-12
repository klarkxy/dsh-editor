# DSH Editor 插件架构与接口

本文是修改、替换或新建 DSH Editor 插件的权威手册。通用产品边界见 [architecture.md](architecture.md)，产品原则见 [product-principles.md](product-principles.md)，开发和验收命令见 [development.md](development.md)。

本文适用于桌面 **0.2.0**，兼容基线固定为 DSH `0.1.5-rc.2`。私有 `root` 接口尤其不是上游公共承诺；升级 DSH 前必须重新验证本文列出的全部桌面能力。

## 交互架构图

| 图 | 说明 | 打开 |
| --- | --- | --- |
| 插件分级 | 公开 tarball 与桌面 profile；host-api 是进程内库 | [dsh-editor-plugins.html](https://klarkxy.github.io/dsh-editor/dsh-editor-plugins.html) |
| 确认写入 | 预览提案不写文件；作者确认后才 `proposal.apply` | [author-confirm-write.html](https://klarkxy.github.io/dsh-editor/author-confirm-write.html) |
| 桌面运行时 | Electron 启动 DSH 子进程；插件住在 Host 内 | [dsh-editor-runtime.html](https://klarkxy.github.io/dsh-editor/dsh-editor-runtime.html) |
| 组合边界 | 普通业务、可选智能增强、公开插件三个视角 | [plugin-composition-boundaries.html](https://klarkxy.github.io/dsh-editor/plugin-composition-boundaries.html) |

规范源文件在 [diagrams/](diagrams/) 下的同名 `.json`；交互图由 `.github/workflows/pages.yml` 发布到 GitHub Pages。

## 运行拓扑与所有权

当前支持 basic/smart/full 三份桌面组合及三个独立公开包。安装、最小插件范本和无 Web/Agent 实验见[组合指南](plugin-composition-guide.md)。下图展示默认 full；kernel、assist 和知乎按组合选择。

一个 Electron 进程只启动一个 loopback DSH Host。所有插件共享 DSH 的 session、workspace、model、tools、approval 和 connection 权威，不创建第二套状态。交互图里的 Host 插件都画在 DSH 进程框内；箭头表示 Cordis 注入或 loopback RPC，不是跨进程服务调用。

```text
Electron bootstrap（不可插件化：窗口、内置运行时、profile 部署、子进程监督）
└─ profiles/dsh-editor
   ├─ @deepseek-ai/dsh-base
   ├─ @deepseek-ai/dsh-web-app
   ├─ dsh-manuscript
   │  ├─ Host: /manuscript、draft storage、稿件安全读写；FIM/计量由可选 assist 服务承接
   │  └─ Client: shell.overlay（公开 Web 插件）
   ├─ dsh-editor-workbench
   │  └─ Host: /dsh-editor-workbench、项目/概览/状态/校对/进度/导入/快照/归档/context；可选 tools entry 提供 novel_overview / novel_memory_update
   ├─ dsh-editor-cards
   │  ├─ Host: /dsh-editor-cards、人物卡/世界书 list/references/metaSet/create；`./host-api` 供 workbench 校对扫描
   │  └─ Client: `dsh-editor.sidebar.tools` 卡片列表 + `dsh-editor.center.overlays` 详情 + `cards-character` / `cards-worldbook`
   ├─ dsh-editor-novel-kernel
   │  └─ Host: novel_* 工具、guard、system prompt、知识卡
   ├─ dsh-proofread：保留纯引擎；桌面 proofread entry 默认禁用
   ├─ dsh-zhihu：/zhihu、凭据/计量、桌面设置 UI；Tool entry 可选
   ├─ dsh-editor-shell
   │  ├─ Host: 注册 `dsh-editor-writing` 设置 schema
   │  └─ Client: 唯一 root GUI、座位与命令注册表、DshChatPort、编辑状态、作者确认
   ├─ dsh-editor-overview-panel
   │  └─ Client-only: `dsh-editor.center.overlays` 作品概览 + `overview`（Ctrl+Shift+O）
   ├─ dsh-editor-memory-panel
   │  └─ Client-only: `dsh-editor.sidebar.tools` 记忆维护 + `memory-open`（Chat 回执卡仍在 Shell）
   └─ dsh-editor-plugins
      ├─ Host: `/dsh-editor-plugins`，开关、GitHub 市场搜索与安装
      └─ Client: 设置「插件」分类

普通 profiles/web（按需分别安装）
├─ dsh-manuscript
├─ dsh-proofread
└─ dsh-zhihu
```

写作会话不挂载官方 `standard` 编码 preset：桌面应用在每次部署 profile 时，把模板里的 `agent-presets/dsh-editor/`（persona、`tool-fs`、`tool-fs-search`、`tool-ask-user`、compaction realm）原子部署到 `<dshHome>/.agent-presets/`，并由 profile 的 `cordis.patch.yml` 将 `agent-presets.default` 指向它。preset 目录遵循与 profile 相同的 owner marker 规则，未标记的同名目录拒绝覆盖。

依赖方向固定如下；禁止跨包导入另一个包的 `src`：

```text
dsh-editor-shell/client
├─ dsh-editor-seats（构建时内联）
├─ dsh-editor-workbench/contracts（构建时内联）
├─ dsh-editor-novel-kernel/contracts（构建时内联）
├─ dsh-editor-cards/contracts（构建时内联；钉住栏读 `cards.list`）
└─ dsh-manuscript/client/editor-core（共享稿纸核心：editor / state / completion-preference / styles）

dsh-editor-cards/client
├─ dsh-editor-seats（构建时内联）
└─ dsh-editor-cards/contracts（构建时内联）

dsh-editor-cards/host
├─ dsh-editor-workspace-kit（进程内库）
└─ dsh-manuscript/host-api（含共享 `withWorkspaceWrite`）

dsh-editor-proofread-panel/client（保留代码；0.2.0 桌面不装载）
├─ dsh-editor-seats（构建时内联）
├─ dsh-editor-workbench/contracts（构建时内联）
└─ dsh-editor-novel-kernel/contracts（构建时内联）

dsh-editor-overview-panel/client、dsh-editor-memory-panel/client
├─ dsh-editor-seats（构建时内联）
└─ dsh-editor-workbench/contracts（构建时内联）

dsh-editor-workbench/host
├─ dsh-editor-workspace-kit（进程内库）
├─ dsh-manuscript/host-api
├─ dsh-editor-cards/host-api（校对扫描读卡片索引）
└─ dsh-proofread/engine、defaults、contracts（纯库）

dsh-editor-novel-kernel/host
└─ Cordis + DSH tools
```

`dsh-editor-workspace-kit` 是私有的进程内库，压在 workbench 与 cards Host 之下，避免 cards 与 workbench 互相依赖：它没有 Cordis 入口，也不进入 profile bundles。主入口提供 Node 侧原语（access bag、`.dsh-editor/` sidecar 原子读写、条目名校验、安全 mkdir、Windows/POSIX no-replace move）；唯一的浏览器安全子入口是 `./frontmatter`，由 cards/workbench contracts 内联给 Client，不得从 kit 主入口进入 Client。

`dsh-editor-seats` 是私有的浏览器安全库，承载 Shell 座位、命令注册表与消息卡注册表合同。插件与 Shell Client 在构建时内联它；它没有 Cordis 入口，也不进入 profile `libraries`。`dsh-editor-shell/seats` 仍再导出同一合同。

## 插件与入口目录

| 包 / Cordis entry | 接口与职责 | 稳定级别 | 交付范围 |
| --- | --- | --- | --- |
| `dsh-manuscript` / `manuscript` | `/manuscript`、`shell.overlay`、draft/FIM/patch/proposal | public | 公开 tarball；Web 与桌面 |
| `dsh-proofread` / `proofread` | `/proofread`、纯引擎与官方 `shell.overlay` UI | public | 独立 tarball；桌面保留引擎包、默认停用入口 |
| `dsh-zhihu` / `zhihu` | `/zhihu`、独立 UI/凭据/用量 | public | 独立 tarball；full 启用 Tool |
| `dsh-manuscript/assist` / `manuscript-assist` | 可选 FIM/patch/LLM 计量服务 | public optional entry | smart/full；旧 Web 默认保留 |
| `dsh-editor-workbench/tools` / `editor-workbench-tools` | 可选 novel_overview / novel_memory_update | private optional entry | smart/full |
| `dsh-editor-workbench` / `editor-workbench` | 私有工作区生命周期、概览/状态、校对、进度 RPC | private host-only | 桌面 profile 必需 |
| `dsh-editor-cards` / `editor-cards` | 人物卡/世界书 Host RPC、contracts 与 Client UI | private dual-face | 桌面组合 feature `cards`（也被 workbench 依赖闭包拉入） |
| `dsh-editor-novel-kernel` / `editor-novel-kernel` | 私有小说工具、guard、prompt、知识卡 | private host-only | smart/full 必需；basic 不装 |
| `dsh-editor-shell` / `editor-shell` | 唯一 `root` client 与写作设置 schema | fixed-version private | 桌面 profile 必需 |
| `dsh-editor-proofread-panel` / `editor-proofread-panel` | 私有、仅 Client；贡献 `dsh-editor.sidebar.tools` 与两条校对命令 | private dual-face | 保留可选 feature 定义；0.2.0 三份 recipe 均移除 |
| `dsh-editor-overview-panel` / `editor-overview-panel` | 私有、仅 Client；贡献 `dsh-editor.center.overlays` 与 `overview` 命令 | private dual-face | 桌面组合 feature `overview-panel` |
| `dsh-editor-memory-panel` / `editor-memory-panel` | 私有、仅 Client；贡献 `dsh-editor.sidebar.tools` 与 `memory-open` 命令 | private dual-face | 桌面组合 feature `memory-panel` |
| `dsh-editor-plugins` / `editor-plugins` | `/dsh-editor-plugins`、设置里的插件开关与 GitHub 市场 | private dual-face | 桌面 profile 必需；核心插件锁定 |

各包 `cordis.patch.yml` 中的 entry id：

| 包 | entry id | name |
| --- | --- | --- |
| `dsh-manuscript` | `manuscript` | `dsh-manuscript` |
| `dsh-manuscript` | `manuscript-assist` | `dsh-manuscript/assist` |
| `dsh-proofread` | `proofread` | `dsh-proofread` |
| `dsh-zhihu` | `zhihu` | `dsh-zhihu` |
| 由 `dsh-zhihu` 的 `dshEditor.inserts` 按 feature `zhihu-tools` 加入 | `zhihu-tools` | `dsh-zhihu/tools` |
| `dsh-editor-workbench` | `editor-workbench-tools` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `webServer` |
| `dsh-editor-workbench` | `editor-workbench` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `webServer` |
| `dsh-editor-cards` | `editor-cards` | `dsh-editor-cards` |
| `dsh-editor-novel-kernel` | `editor-novel-kernel` | `dsh-editor-novel-kernel` |
| `dsh-editor-shell` | `editor-shell` | `dsh-editor-shell` |
| `dsh-editor-plugins` | `editor-plugins` | `dsh-editor-plugins` |
| `dsh-editor-proofread-panel` | `editor-proofread-panel` | `dsh-editor-proofread-panel` |
| `dsh-editor-overview-panel` | `editor-overview-panel` | `dsh-editor-overview-panel` |
| `dsh-editor-memory-panel` | `editor-memory-panel` | `dsh-editor-memory-panel` |

`dsh-editor-workbench/contracts`、`dsh-editor-novel-kernel/contracts` 与 `dsh-editor-cards/contracts` 是 browser-safe 内部兼容面：只能包含常量、类型、解析器和纯函数，不能导入 Node、Cordis Host 或文件系统。Shell 的 client 构建必须内联它们，浏览器产物不得在运行时解析私有 Host 包。

`dsh-manuscript/host-api` 是公开但狭窄的 Host 子入口，只提供 live-session workspace authority、受约束文件/路径原语与标准 Host 错误映射。它是 workbench 的进程内库导入，不是对 DSH 的 RPC，也不是任意文件系统 SDK，更不包含桌面 workbench endpoint。

## Host、Client、inject 与生命周期

- Host 入口导出 `name`、`inject`、`apply(ctx)`；只声明实际使用的 service。当前固定 DSH 版本的 HTTP RPC 通过注入 `webServer` 挂载，不能只写 `connection`。
- Cordis entry 由包内 `cordis.patch.yml` 插入，entry id 和 prompt section name 必须全局唯一。
- 所有 `handle`、`guard`、事件订阅或资源必须通过 `ctx.effect` 或等价 disposer 清理。
- Client 只能使用 DSH 注入的 runtime、connection 和 slots；Renderer 不得读取凭据明文、直接调用 Node 文件系统或管理进程；文件权限由 Host 重建。
- 普通附加界面使用 `shell.overlay` 等 additive slot。`root` 只能有一个所有者；替换 Shell 时必须先移除 `editor-shell`，不能并存两个 root。
- DshChatPort 只投影官方 `SessionFace`、`ConversationSnapshot`、send/cancel、model/permission、approval/questions。插件不得复制 Chat、启动第二次 connection 或自行执行 Tool。

当前 inject 清单（必须与源码保持一致）：

| 包 | `name` | `inject` |
| --- | --- | --- |
| `dsh-manuscript` Host | `dsh-manuscript` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `storageDomain`, `webServer` |
| `dsh-editor-workbench` | `dsh-editor-workbench` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `webServer` |
| `dsh-editor-cards` Host | `dsh-editor-cards` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `webServer` |
| `dsh-editor-cards` Client | `dsh-editor-cards-client` | `slots`, `connection`, `dshEditorCommands` |
| `dsh-editor-novel-kernel` | `dsh-editor-novel-kernel` | `tools`, `systemPrompt`, `fs`, `sandboxPolicy` |
| `dsh-editor-shell` Host | `dsh-editor-shell` | `settings`, `connection`, `webServer` |
| `dsh-editor-shell` Client | `dsh-editor-shell-client` | `slots`, `sessions`, `workspaces`, `connection`, `settingsScope`, `settingsSchema`, `remote`, `remote.session`, `remote.settings`, `remote.credentials`, `remote.llm`, `remote.directoryPicker`, `uiSession` |
| `dsh-editor-plugins` Host | `dsh-editor-plugins` | `connection`, `loader`, `webServer` |
| `dsh-editor-plugins` Client | `dsh-editor-plugins-client` | `slots`, `connection` |
| `dsh-editor-proofread-panel` Host | `dsh-editor-proofread-panel` | （无） |
| `dsh-editor-proofread-panel` Client | `dsh-editor-proofread-panel-client` | `slots`, `connection`, `dshEditorCommands` |
| `dsh-editor-overview-panel` Host | `dsh-editor-overview-panel` | （无） |
| `dsh-editor-overview-panel` Client | `dsh-editor-overview-panel-client` | `slots`, `connection`, `dshEditorCommands` |
| `dsh-editor-memory-panel` Host | `dsh-editor-memory-panel` | （无） |
| `dsh-editor-memory-panel` Client | `dsh-editor-memory-panel-client` | `slots`, `connection`, `dshEditorCommands`, `dshEditorMessageCards` |
| `dsh-proofread` Host | `dsh-proofread` | `connection`, `webServer` |
| `dsh-proofread` Client | `dsh-proofread-client` | `slots`, `connection` |
| `dsh-zhihu` Host | `dsh-zhihu` | `connection`, `credentials`, `storageDomain`, `webServer` |
| `dsh-zhihu/tools` | `dsh-zhihu-tools` | `zhihu`, `tools` |
| `dsh-manuscript/assist` | `dsh-manuscript-assist` | `llm`, `storageDomain`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy` |
| `dsh-editor-workbench/tools` | `dsh-editor-workbench-tools` | `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `tools` |

Shell 以 `root` slot id `dsh-editor-shell-root`、priority `-100`、label `DSH 编辑器` 注册。manuscript client 只注册 `shell.overlay`（id `manuscript`，order `100`，label `稿纸`），禁止占用 `root` 或 `conversation.view`。

Shell 声明 `dsh-editor.extensions`、`dsh-editor.settings.plugins`、`dsh-editor.settings.zhihu`、`dsh-editor.sidebar.tools` 与 `dsh-editor.center.overlays` 五个 list/root 座位。通用 extensions 合同保留，但当前 proofread 和 zhihu 都不向它贡献顶栏入口：proofread 只保留官方 Web 的 `shell.overlay`，知乎分别使用官方 overlay 和桌面 `.settings.zhihu`。知乎桌面组件默认展示配置，并提供用量、知识库与连接测试。详见[挂载合同](plugin-composition-guide.md#最小插件开发范本)。插件设置座位由 `dsh-editor-plugins` 渲染：核心锁定读 `dshEditor.entries[].locked`，扩展按作者用途分组；社区插件从 GitHub 市场检查和安装。

### Shell 座位与命令注册表

座位合同在 `dsh-editor-seats`（私有、浏览器安全；插件与 Shell 构建时内联）。`dsh-editor.sidebar.tools` 与 `dsh-editor.center.overlays` 都是带上下文的座位（`kind: list`, `scope: root`）。Root 在作品已打开时对两者调用 `renderSlot(..., seatContext)`，复用同一份 owner：侧栏工具画在文件树上方，中栏 overlay 画在稿纸之上（与人物卡详情同一列）。中栏 overlay 的布局由 Shell 独占：贡献在打开时给根元素加 `CENTER_OVERLAY_ATTRIBUTE`（`data-dsh-center-overlay`），关闭时渲染 `null`；Shell 把带该属性的元素放进稿纸所在的网格格并隐藏稿纸，插件不得自写 grid / 隐藏稿纸的规则。`ctx.slots.renderSlot` 只接受 `'root'`；子座位走 root 组件 props 上的 `renderSlot` 面。贡献组件收到的 props 就是这份 owner 对象（外加全局 standard kit）：

- `sessionId`：当前作品会话，无作品时为空
- `activePath`：当前打开的稿件路径，未打开时为空
- `editorDirty`：编辑缓冲有未保存改动
- `treeRevision` / `contentRevision`：树或当前正文应重载时递增
- `locale`：作者界面语言
- `openDocument(path, range?)`：打开文档，可选定位
- `onApplied(path)`：插件确认写入后刷新树/正文，并在安全时导航
- `note(message)`：在 Shell 铬条显示短状态
- `revealSidebar()`：打开文件侧栏并退出专注模式
- `refresh(scope)`：`tree` / `content` / `overview` 分别递增树、正文、Shell 缓存的概览（供树状态标记）
- `expandTreePath(path)`：展开文件树祖先，使该路径可见
- `highlightTreePath(path)`：高亮文件树一行（卡片选中路径）；`null` 取消高亮
- `pinnedPath`：当前钉住的文档路径，未钉住时为 `null`
- `togglePin(path)`：钉住该路径，或在已钉住时取消。钉住栏仍是 Shell 布局能力
- `ProposalCard`：Shell 持有的作者确认卡。插件不得自己写作者正文。
- `Select?` / `Dialog?`：可选的宿主共享控件；合同在 `dsh-editor-seats`，插件独立运行时保留自己的退路。

概览与记忆插件各自拉取 workbench RPC，不把 `project.overview` 塞进座位上下文。

`dshEditorCommands` 由 Shell Client `ctx.provide` 提供。插件 `inject: ['dshEditorCommands']` 后 `register(command)`，返回 disposer。`shortcut.ctrl` 表示 Windows 上的 Ctrl / macOS 上的 Cmd，与现有 `workspaceShortcut` 相同。Root 在内置快捷键未命中后再匹配注册表；`when: 'workspace'` 仅在作品就绪时生效。重复 `id` 在 `register` 时抛错。作者确认卡始终由 Shell 拥有。`/dsh-editor-shell` → `capabilities.get` 返回 `{ features: Record<feature, boolean> }`。

`dshEditorMessageCards` 同样由 Shell Client `ctx.provide`：插件 `inject` 后 `register({ toolName, render })`，Chat 按工具结果行的 `toolName` 查表，命中则用插件的 `render({ result, context })` 代替默认工具行（`render` 返回 `null` 保留默认行），`context` 只含 `sessionId` / `locale` / `onApplied` / `refresh` / `note`。重复 `toolName` 抛错，disposer 随插件卸载撤销。`novel_memory_update` 的记忆维护卡由 `dsh-editor-memory-panel` 注册；`novel_propose` 提案卡、`author_observe` 记忆卡与初始化引导卡仍由 Shell 渲染，因为作者确认是 Shell 的职责。

Shell 中剩下的业务知识只有：稿纸（`dsh-manuscript/client/editor-core`）、Chat 投影与三张 Shell 自有卡片、文件树的章节状态标记（`project.overview` 只读）、保存后的 `progress.record`、钉住面板对 `/dsh-editor-cards cards.list` 的只读调用。其余功能一律通过座位、命令注册表与消息卡注册表接入。

Shell client 构建会捆绑 `docx` 与 `jszip`，仅供导出对话框在 Renderer 内生成 DOCX/EPUB。manuscript editor-core 构建会捆绑 `@codemirror/search`，仅供稿内查找替换。两者都不进入 Host RPC。

## RPC 通用契约

`/manuscript`、`/dsh-editor-workbench`、`/dsh-editor-cards`、`/proofread`、`/zhihu`、`/dsh-editor-shell` 与 `/dsh-editor-plugins` 都只以 `{ authority: 'loopback' }` 注册。loopback 限制网络暴露，但不是调用者身份；每个文件请求仍必须携带 live `sessionId` 并由 Host 重建 authority（`usage.summary` / `project.inspect` / `project.createHome` / 知乎知识库 RPC 例外，见下表）。

```ts
type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: unknown } }
```

Host 处理文件请求的固定顺序：

1. `sessions.get(sessionId)` 取得 live session。
2. 只读取 immutable `session.header.cwd`，忽略 Renderer 伪造的 cwd。
3. `workspaceRegistry.resolveByPath(cwd)` 取得 registered workspace，并确认 session 仍属于它。
4. 解析 sandbox policy 和 canonical root。
5. 拒绝 absolute、device、traversal、symlink/junction 与越界 target。
6. 创建使用 create-if-absent；覆盖使用 version/hash/token/no-clobber 门禁。
7. 将同一 `AbortSignal` 传到底层调用。

标准错误码包括 `bad-request`、`cancelled`、`session-not-found`、`workspace-attach-failed`、`workspace-not-found`、`workspace-invalid-path`、`directory-unreadable`、`directory-exists`、`internal`。UI 映射固定的可操作文案，不直接显示异常堆栈或未约束的 reason。

## `/manuscript`：公开稿件接口

Channel：`/manuscript`。除特别注明外，请求都包含 `sessionId`，路径均为 workspace-relative。第三列以「读」或「写」标明；`file.create` / `file.write` / `proposal.apply` 进入 `withWorkspaceWrite`。

| Endpoint | 请求字段 | 读/写 · 成功值 / 语义 |
| --- | --- | --- |
| `tree.list` | `sessionId`, `path` | 读 · `{ entries }`，有界目录项 |
| `file.read` | `sessionId`, `path` | 读 · `{ text, version }`，文本上限 2 MB |
| `file.create` | `sessionId`, `path`, `text` | 写 · create-if-absent |
| `file.write` | `sessionId`, `path`, `text`, `version` | 写 · replace-if-version |
| `draft.get` | `sessionId`, `path` | 读 · `{ draft }`，来自 DSH storage domain |
| `draft.list` | `sessionId`，可选窗口过滤 | 读 · `{ drafts }`，含其他窗口的 legacy 备份 |
| `draft.put` | `sessionId`, `path`, `text`, `baseText`, `baseVersion` | 写 · 只保存草稿（storage domain），不改正文 |
| `draft.delete` | `sessionId`, `path` | 写 · 删除对应草稿（须带匹配 revision） |
| `search.text` | `sessionId`, `query`, `scope: project\|manuscript` | 读 · 有界字面量搜索；不接受正则 |
| `proposal.prepare` | `sessionId`, `kind`, `path`, `summary`；edit 加 `oldText`, `newText`；create 加 `text` | 读 · 只读预检和作者确认信息 |
| `proposal.apply` | prepare 的全部字段；edit 另加 `expectedVersion` | 写 · 作者确认后按版本门禁创建或修改；edit 的 `oldText` 为空表示填充仍为空白的目标文件，create 也可覆盖仍为空白的目标文件 |
| `fim.complete` | `sessionId`, `prefix`, `suffix`，可选 `authorPreferences`，可选 `chapterContext`（≤1 200，去控制字符） | 读 · `{ text, route: 'dsh-llm' }`，只返回候选 |
| `patch.complete` | `sessionId`, `path`, `selectedText`, `before`, `after`，可选 `authorPreferences`，可选 `chapterContext`（≤1 200），可选 `instruction`（≤400，改写要求） | 读 · `{ text, route: 'dsh-llm' }`，只返回候选 |
| `usage.summary` | 可选 `days` | 读 · 本机用量快照；不要求 `sessionId` |

不得把导入、快照、归档或任意 Node FS 能力加入这个公开 channel。稿纸 editor-core 另捆绑 `@codemirror/search`，只服务稿内查找替换，不增加 Host 端点。

## `/dsh-editor-workbench`：私有桌面接口

Channel：`/dsh-editor-workbench`（常量 `WORKBENCH_RPC_CHANNEL`）。类型面在 `dsh-editor-workbench/contracts`。第三列以「读」或「写」标明。进入 `withWorkspaceWrite` 的写入端点：`rules.open`、`memory.apply`、`memory.undo`、`project.init`、`project.prepareIndex`、`project.importApply`、`project.importCleanup`、`snapshot.create`、`snapshot.rollback`、`snapshot.restoreApply`、`snapshot.restoreCleanup`、`structure.groupCreate`、`directory.create`、`file.rename`、`file.moveManuscript`、`archive.apply`、`archive.restore`、`proposal.apply`、`entry.copy`、`entry.move`、`entry.delete`、`entry.rename`、`chapter.statusSet`、`progress.record`。`project.createHome` 在作品目录外建文件夹，不入该队列。

| Endpoint | 请求字段 | 读/写 · 成功值 / 语义 |
| --- | --- | --- |
| `project.inspect` | `workspacePath` | 读 · `{ hasVisibleEntries, textFiles, indexReady }`；用已注册路径，不要求 `sessionId` |
| `project.createHome` | `title` | 写 · `{ path }`，在「文档/dsh-editor」下独占创建同名空文件夹；不接受调用方传入的父路径 |
| `project.init` | `sessionId`, `newProject` | 写 · `{ created, skipped }`，只建立空的 `正文` 目录，不写入 Markdown 模板；大纲/人物卡/世界书在实际创建后出现 |
| `project.prepareIndex` | `sessionId` | 写 · 索引准备回执 |
| `project.overview` | `sessionId` | 读 · 章节/大纲摘要（章节含 `status`、可选 `meta: { beats, hasState }`）、总字数、`totals.byStatus` 分布、最近 1 项 `recent` 与最近 5 项 `recentChapters`、有界扫描警告 |
| `proofread.scan` | `sessionId`, `scope`（`document` / `manuscript`），`document` 时必填 `path`，可选 `kinds` | 读 · 确定性校对：`punctuation` / `typo` / `sensitive` / `repeat` / `habit` / `card`（默认含 `card`）。返回 `findings`（最多 500，`truncated`）、`scannedFiles`、`skipped`、`habitStats`（口癖千分比前 30）。`document` 只扫一篇作者内容 `.md`/`.txt`；`manuscript` 按自然序扫 `正文/`。`card` 对照人物卡/世界书：代词性别不一致（`card-gender`）、专名近形误写（`card-nearmiss`，词表 >400 则跳过近形检查并计入 `skipped`）。默认词库在 `resources/proofread/`，作品可追加 `.dsh-editor/敏感词.txt`、忽略 `.dsh-editor/敏感词-忽略.txt`。卡片索引经 `dsh-editor-cards/host-api` `listCards` |
| `chapter.statusSet` | `sessionId`, `path`, `status` | 写 · `{ path, status }`，把 `正文/` 下章节设为 `draft` / `revising` / `final`；默认草稿，损坏状态文件 fail-open |
| `progress.record` | `sessionId`, `totalChars` | 写 · 按本地日期写入/覆盖当天 `.dsh-editor/writing-log.json` 条目（最多 400 天，原子写）；防抖由调用方负责（shell 保存后 5 秒） |
| `progress.history` | `sessionId`，可选 `days`（默认 30） | 读 · 窗口内每日 `{ date, chars, delta }` 与按周汇总 `{ weekStart, chars, delta }` |
| `structure.groupCreate` | `sessionId`, `path` | 写 · 只在 `正文` 下建立一级卷/部目录 |
| `directory.create` | `sessionId`, `path` | 写 · 在任意已存在的父目录下建一个可见目录（通用，无 正文 特化） |
| `rules.get` | `sessionId` | 读 · `{ path, text, version, exists }`，读取作品根 `AGENTS.md`（包装 `dsh-manuscript/host-api` `readProjectRules`）；不存在时返回模板正文且 `exists: false` |
| `rules.open` | `sessionId` | 写 · 若不存在则创建模板后返回同一形状（`ensureProjectRules`） |
| `memory.list` | `sessionId` | 读 · `{ items }`，项目记忆更新摘要 |
| `memory.get` | `sessionId`, `id` | 读 · `{ record }` 单条记忆更新 |
| `memory.apply` | `sessionId`, `id` | 写 · 应用一条待确认记忆更新 |
| `memory.undo` | `sessionId`, `id` | 写 · 撤销已应用的记忆更新 |
| `context.compile` | `sessionId`, `userRequest`，可选 `activePath`, `authorPreferences`, `authorMemory` | 读 · `{ serialized, receipt }`，有界 V2 context 信封 |
| `project.importProbe` | `targetSessionId`，可选 `sourceSessionId` | 读 · token、统计、预览或恢复状态；不写入 |
| `project.importApply` | `targetSessionId`, `sourceSessionId`, `probeToken` | 写 · 重新 probe 后执行 no-clobber 导入 |
| `project.importCleanup` | `targetSessionId`, `receiptId` | 写 · 只清理 manifest/hash 证明归属的中断写入 |
| `snapshot.list` | `sessionId` | 读 · 快照列表；不包含未保存 buffer；`.dsh-editor/*` 不在 payload 内 |
| `snapshot.create` | `sessionId`，可选 `label` | 写 · 原子发布后的 snapshot view；简易提交流程的 label 即当前时间 |
| `snapshot.rollback` | `sessionId`, `snapshotId` | 写 · 原地回滚：覆盖/删除回到快照状态，先自动创建安全快照（可再回滚撤销）；非文本文件不动 |
| `snapshot.restoreProbe` | `targetSessionId`，可选 `sourceSessionId`, `snapshotId` | 读 · 只恢复到新空 workspace 的 token/状态（跨作品恢复，与原地回滚不同） |
| `snapshot.restoreApply` | `targetSessionId`, `sourceSessionId`, `snapshotId`, `token` | 写 · no-clobber 恢复统计 |
| `snapshot.restoreCleanup` | `targetSessionId`, `receiptId` | 写 · hash-protected 中断清理 |
| `file.rename` | `sessionId`, `path`, `newName`, `expectedVersion` | 写 · 同目录、保留扩展名后的新路径 |
| `file.moveManuscript` | `sessionId`, `path`, `targetDirectory`, `expectedVersion` | 写 · 仅在 `正文` 树内 no-replace 移动 |
| `file.readBinary` | `sessionId`, `path` | 读 · `{ base64, mime }`；仅 jpg/jpeg/png/gif/webp/avif/svg，上限 20 MB |
| `archive.list` | `sessionId` | 读 · 可恢复 archive view 与损坏项计数 |
| `archive.apply` | `sessionId`, `path` + `expectedVersion`，或 `archiveId` | 写 · 新归档或继续中断归档；界面只允许单个可见 Markdown/TXT |
| `archive.restore` | `sessionId`, `archiveId`，可选 `expectedVersion` | 写 · no-replace 恢复后的 archive view |
| `proposal.prepare` | `sessionId`, `proposal` | 读 · 仅 `split` / `merge` / `renames`；`edit` / `create` 走 `/manuscript` |
| `proposal.apply` | `sessionId`, `proposal`, 可选 `expectedVersions` | 写 · 拆章、合章（来源进归档）或批量重命名 |
| `entry.copy` | `sessionId`, `path`, `targetDir` | 写 · 文件或目录复制，同名自动改名 |
| `entry.move` | `sessionId`, `path`, `targetDir` | 写 · 文件或目录移动，同名拒绝 |
| `entry.delete` | `sessionId`, `path` | 写 · 永久删除文件或目录（与可恢复归档不同，确认后不可从归档恢复） |
| `entry.rename` | `sessionId`, `path`, `name` | 写 · 文件或目录就地改名 |

这些 endpoint、字段、V1/V2 envelope、token、receipt、manifest、hash 与重新验证语义是兼容接口。物理换包不构成协议升级。

## `/dsh-editor-cards`：人物卡与世界书

Channel：`/dsh-editor-cards`（常量 `CARDS_RPC_CHANNEL`）。类型面在 `dsh-editor-cards/contracts`；workbench contracts 仍 re-export 同一组卡片类型。权威链与 `/dsh-editor-workbench` 相同：live `sessionId` → session cwd → registered workspace → sandbox policy → canonical root。写入走进程内同一份 `dsh-manuscript/host-api` `withWorkspaceWrite(rootKey)`（Host 构建把 `dsh-manuscript` 与 kit 标为 `neverBundle`，与 workbench 共享同一模块实例）。

| Endpoint | 请求字段 | 读/写 · 成功值 / 语义 |
| --- | --- | --- |
| `cards.list` | `sessionId`, `kind`（`character` / `worldbook` / `all`） | 读 · 结构化卡片列表：`characters`、`worldbook`，每张含 `path`、`title`、`frontmatter`、`summary`（frontmatter.summary 或正文首段 ≤ 120 字）、`version`、`modifiedAt`。自然序，跳过隐藏/生成目录，最多 2000 文件，带 `scannedFiles` / `skipped` / `truncated` |
| `cards.metaSet` | `sessionId`, `path`, `version`, `fields` | 写 · 只改 YAML frontmatter，正文按字节保留，未知键原样保留；版本冲突走 `bad-request`。成功 `{ path, version }`。进入 `withWorkspaceWrite` |
| `cards.references` | `sessionId`, `path` | 读 · 引用导航：人物卡用 `name`+`aliases`，世界书用 `triggers`（否则文件名）。在 `正文/**/*.{md,txt}` 做字面量检索，最多 200 条 `hits`（`path`/`line`/`column`/`start`/`end`/`excerpt`），带 `terms`、`scannedFiles`、`truncated` |
| `cards.create` | `sessionId`, `kind`, `title`，可选 `fields` | 写 · 在 `人物卡/<title>.md` 或 `世界书/<title>.md` 新建卡片（frontmatter + `# <title>`）。文件名规则与 `entry.*` 相同；重名或非法名拒绝。进入 `withWorkspaceWrite` |

`dsh-editor-cards/host-api` 导出 `listCards`（及卡片索引辅助函数），供 workbench `proofread.scan` 的卡片对照使用。Client 贡献侧栏 `cards`（order 150）与中栏 `cards-detail`（order 150），命令 `cards-character`（Ctrl+Shift+C）与 `cards-worldbook`（Ctrl+Shift+W）。

章节状态存在 `.dsh-editor/chapter-status.json`（`{ version: 1, statuses }`，键为规范化相对路径，缺省与 `draft` 不落盘）。写作字数日志存在 `.dsh-editor/writing-log.json`（`[{ date, chars, delta? }]`，本地日期、按日去重）。两份文件缺失或损坏时 Host fail-open 到默认值，孤立键不影响概览。`chapter.statusSet` 只接受 `正文/` 下已存在的 Markdown/TXT。`progress.record` 必须便宜且原子，防抖由调用方负责。`proofread.scan` 合并包内默认敏感词与 `.dsh-editor/敏感词.txt`，并用 `.dsh-editor/敏感词-忽略.txt` 做允许表；列表缺失或损坏时 fail-open 到默认词库。人物卡 / 世界书 frontmatter 是容错 YAML：人物卡可选 `name` / `aliases` / `role` / `gender` / `age` / `faction` / `tags` / `status` / `relations` / `summary`；世界书可有 `category` / `tags` / `summary`，旧文件的 `triggers` / `enabled` / `priority` 按键原样保留但不再驱动自动注入。未知键在 `/dsh-editor-cards` `cards.metaSet` 中按原文保留，损坏字段 fail-open 到缺省值。

章节 Markdown（`正文/**/*.md`）可选 YAML frontmatter：`beats`（字符串列表，最多 12 条、每条 ≤ 120 字）与 `state`（可选 `now` / `where` / `knows` / `ended` / `open`，各为标量，合计 ≤ 300 字）。未知键与注释按原文保留；TXT 章节不使用 frontmatter。无 frontmatter 解析为 `{}`，损坏或未闭合解析为缺省。`project.overview` 的字数 / 标题 / 摘要 / 空章按去掉 frontmatter 的正文计算，并带可选 `ChapterSummary.meta`。

`.dsh-editor/*` 隐藏元数据一律不进入快照 payload。重命名、正文跨卷移动、归档和恢复响应可以带 `metadataWarning`，表示正文操作已经成功但附带的元数据未同步，调用方不得据此回滚正文。

Context 信封常量：

- `schema`: `dsh-editor.project-context`
- 历史版本 `1` / `2`（每轮注入固定来源与世界书全文），当前版本 `3`
- V3 只含 `user_request` 与可选 `active_path`：固定资料与世界书不再自动注入，作品背景由项目根 `AGENTS.md`（system 区常驻）与按需 `glob`/`grep`/`read` 提供。旧会话恢复时，仍在模型上下文里的 V1/V2 信封会被有日志地替换回原用户请求。
- V2 可选 `chapter_context: { path, beats?, previous?: { path, state } }`：当前章 `beats` 与上一章非空 `state`；皆无则省略。回执带 `chapterContext?: { path, beats, previousPath? }`。

## Novel Kernel 契约

- 工具名：`novel_knowledge`、`novel_propose`、`author_observe`、`novel_index_write`（另有只读的 `novel_overview`——由 workbench-tools 注册，以及 `novel_scratch_write`/`novel_scratch_read`/`novel_scratch_list` 临时工作区三件套）。项目内查找改用原生 `glob`/`grep`/`read`；旧的 `novel_search`/`project_knowledge` 不再向新会话注册。
- `novel_memory_update`（workbench 注册）在协作中维护根 `AGENTS.md`、`世界书/**/*.md`、`人物卡/**/*.md`：来源逐字引用与文件版本由 Host 校验；明确的创建/追加自动落盘，修订、推断与冲突形成待确认记录，全部写入 `.dsh-editor/history/memory/`，重启后可查看与撤销（新建文件的撤销走归档）。
- `novel_knowledge` 只接受唯一的 `topics` 数组，去重后 1–3 个固定主题；每张知识卡最多 6000 字符。它只返回建议，不提供项目事实或授权。
- `novel_propose` 每次形成一个 Markdown `edit` / `create` / `split` / `merge` / `renames` 提案，绝不写文件；守卫只接受作者内容 `.md` 路径，`.dsh-editor/` 等隐藏目录不进提案。
- 知乎工具由 `dsh-zhihu/tools` 唯一注册；知识库列表/上传走 `/zhihu`。
- `novel_index_write` 把产品内部的作品索引（`.dsh-editor/作品索引.md`，固定路径、全文覆盖）直接落盘，不经提案确认；Shell 按工具名隐藏其结果行。它是唯一的例外：其余写入仍是助手提议、作者确认、Shell 执行。
- `author_observe` 让助手提议"记住一条作者偏好"，仅作为建议显示在 `MemoryCard` 中：固定 `observation`（≤ 200 字符）与 `reason`（必填），marker `dsh-editor.memory`、version `1`。Shell 解析后必须经作者点击"记住"才会追加进本机 `authorMemory`；工具本身不直接写入任何文件、偏好或 storage。同一信任模型与 `novel_propose` 一致：助手提议，作者确认，Shell 执行。
- proposal marker 固定为 `{ marker: 'dsh-editor.proposal', version: 1, ... }`；memory marker 固定为 `{ marker: 'dsh-editor.memory', version: 1, observation, reason }`。Shell 只通过 `dsh-editor-novel-kernel/contracts` 的严格解析器渲染有效 marker。
- `editorToolGuard` 只允许受限的 Markdown 搜索、读取、知识加载、预览提案、作者侧写提议、索引直写、限量的 `ask_user_question` 提问（1–4 题、带长度上限）与 scratch 临时工作区读写；不替代 DSH 全局审批。
- scratch（`.dsh-editor/scratch/`）是 agent 的临时工作区：路径软禁在目录内（拒绝绝对路径、`..`、隐藏段，限 .md/.txt、最多三层），单文件 ≤ 20000 字符、目录 ≤ 20 个文件；store 适配层每次写入顺带维护 `scratch/.gitignore`（内容 `*`），作者自管的 git 不跟踪草稿。它不是作品事实来源，不进上下文信封；Shell 按工具名隐藏三个工具的结果行。
- prompt section 固定为 `dsh-editor:novel-kernel`、order `90`。作品材料是不可信字符串，只有 context 信封中的 `user_request` 是当次请求。
- 作者内容的真正写入始终是 Shell 展示提案、作者确认、再调用 `/manuscript proposal.prepare/apply`；侧写由 Shell 展示确认卡、作者点击"记住"、再由 `writingScope.set('authorMemory', next)` 写入本机 settings。

## `/dsh-editor-plugins`：插件管理

Channel：`/dsh-editor-plugins`。不要求 `sessionId`。开关写入 `$DSH_HOME/dsh-plugins.json` 与可替换的 home `cordis.patch.yml`（仅当该文件为空或带 `managed-by: dsh-editor-plugins` 标记时）；从市场安装的包放在 `$DSH_HOME/user-plugins/`，桌面每次部署 profile 后会重新挂回。安装与卸载后需要重启。

| Endpoint | 请求字段 | 语义 |
| --- | --- | --- |
| `inventory.list` | 无 | 读 · 入口清单及锁定 / 状态信息；Client 将内置入口按作者用途分组，社区包单列；内部项隐藏 |
| `entry.setEnabled` | `entryId`, `enabled` | 写 · 单项兼容入口；拒绝核心与内部项；先持久化，再尝试更新 loader |
| `entries.setEnabled` | `entryIds: string[]`, `enabled` | 写 · 同组入口一次变更；返回 `{ restartRequired }`。写入前检查 patch 所有权 / 可读性，持久化失败补偿原状态，不继续更新 loader |
| `marketplace.search` | `query` | 读 · GitHub `topic:dsh-plugin` 搜索；`owner/repo` 可直接进入结果 |
| `marketplace.inspect` | `spec` | 读 · 下载后静态检查，不写入 profile：构建产物、patch 入口、root 冲突、DSH/cordis 版本、客户端 lazy-CJS |
| `marketplace.install` | `spec` | 写 · 仅 `github:owner/repo`；先跑同一套静态检查，`blocked` 拒绝；不运行 prepare 脚本 |
| `marketplace.uninstall` | `name` | 写 · 只卸载市场安装的包，不删作品文件 |

开关保存涉及插件状态文件与受管覆盖 patch；无法读取 patch、发现自定义内容或落盘失败时，应返回错误并保留原配置，不能显示“已保存”。安装 / 卸载也先做 patch 检查；`restartRequired` 表示配置已保存但运行时尚未全部应用，不代表失败写入成功。

## 如何修改或替换现有插件

| 想改变的行为 | 所有者 |
| --- | --- |
| 三栏布局、稿纸、搜索面板、导出导入归档、钉住栏、Chat 展示（含记忆回执卡）、设置、内置快捷键 | `dsh-editor-shell` |
| 侧栏人物卡/世界书、详情 overlay、`cards-character` / `cards-worldbook` | `dsh-editor-cards` |
| 保留的侧栏作品校对面板、校对命令（0.2.0 桌面暂停） | `dsh-editor-proofread-panel` |
| 中栏作品概览、`overview` 命令（Ctrl+Shift+O） | `dsh-editor-overview-panel` |
| 侧栏记忆维护、`memory-open` 命令 | `dsh-editor-memory-panel` |
| 插件开关、GitHub 市场搜索与安装 | `dsh-editor-plugins` |
| 普通 Web 的稿纸抽屉与共享稿纸核心（含查找替换、打字机、排版） | `dsh-manuscript` client + `dsh-manuscript/client/editor-core` |
| 稿件安全读写、草稿、FIM/patch、proposal apply、`search.text` | `dsh-manuscript` Host |
| 项目结构、章节概览/状态、校对扫描、进度、context、导入、快照、移动、归档 | `dsh-editor-workbench` |
| 人物卡/世界书 RPC、frontmatter 编辑、引用导航、`listCards` 库 | `dsh-editor-cards` |
| 小说知识、proposal Tool、guard、系统提示词 | `dsh-editor-novel-kernel` |
| 窗口、内置 DSH、profile、portable | `apps/desktop` 与桌面物化脚本 |

替换 workbench 或 kernel 时：

1. 保持现有 channel/tool/prompt/marker contract，先让替代实现通过原 contract tests。
2. 在 profile 中删除原 Cordis entry，再加入新实现；同一能力只能注册一次。
3. 保持一个 Host、一个 connection、一个 root，以及同一 live-session workspace authority。
4. 同步开发、runtime、package verification 与 E2E 清单。
5. 按完整 profile 原子部署和回滚，不依赖热切换保留 Host 状态。

## 新建 Host-only 插件

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-writing-plugin'
export const inject = ['tools', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  // 注册 tool / prompt；通过 ctx.effect 返回 disposer。
}
```

建立步骤：

1. 说明独立用户价值，选择 public 或 desktop-private；没有独立启停价值的代码留在原包内。
2. 参考 `dsh-proofread` 或 novel-kernel 复制最小包形态，不复制 Chat、session 或 workspace 权威。
3. 建立唯一 Cordis entry id/name，只声明实际 inject。
4. 文件能力依赖 live session 和 `dsh-manuscript/host-api`；不接收 Renderer 提供的 cwd/provider/model。
5. 增加 package-local unit/contract tests，再接入对应 profile、复制、校验和 E2E。
6. 公开包加入 `pack:plugins` 与 fresh-home 安装矩阵；私有包只加入桌面 profile，不进入公开 tarball。

## 新建 overlay 插件

dual-face Web 插件参考 `dsh-manuscript`：Host 为 ESM，client 通过 `wrap-client.mjs` 生成 DSH lazy CJS 包装，manifest 声明 `dsh.client.platform: "web"`、inject 与 `./client` export。

Client 只能注册 additive slot，例如 `shell.overlay`；不得使用 `root` 或 `conversation.view`。若需求确实是替换整个产品根界面，应派生并替换 `dsh-editor-shell`，而不是同时安装第二个 root。

## 兼容、卸载、失败与数据保留

- workbench、kernel、shell 与 plugins 是桌面 profile 必需组件。前两者不提供运行时安装/禁用 UI；plugins 可开关非核心入口并从 GitHub 安装社区插件，但不能关闭或卸载核心包。缺必需包属于无效交付，由物化和包内容验证阻止。隔离负向 smoke 已确认：在 DSH `0.1.5-rc.2` 中移除 workbench 或 kernel 时，Host 在发布 loopback URL 前以退出码 `1` 失败，并在错误中指出缺失包；`pnpm test:e2e:missing-private` 固化该行为。
- workbench/kernel 运行失败沿用现有 RPC/tool fail-closed 路径；不增加备用执行面、重试守护或健康检查 RPC。
- 卸载插件不删除 workspace 文件、home credentials、settings、sessions 或 storages。
- `dsh-manuscript` 卸载前应保存正文并处理需保留草稿；插件不会主动清除 DSH storage domain。
- Kernel 卸载不删除知识卡之外的任何数据；proposal 从未直接写正文。
- 私有 profile 按整套精确版本原子替换。回滚也替换整套 profile，不混用不同版本的 contracts 与 Host。
- `root` seam 只兼容精确 DSH `0.1.5-rc.2`。

## 限额、取消与幂等性

- 稿件文本和单份 draft 上限 2,000,000 bytes；创建 create-if-absent，保存 replace-if-version。
- `patch.complete` 的 selectedText 最多 12,000 字符，before/after 各 4,000，候选最多 1,200。
- project context 固定来源单份 4,000、合计 12,000；动态世界书另有 6,000 总预算。
- `AbortSignal` 必须贯穿 RPC、文件和模型调用；超时不能被当作“必定未执行”。
- 导入、恢复、移动、归档必须先重新 read/probe，再继续、清理或重试。

## 集成清单与验收

新增包：加 `dshEditor` 块 + 在组合 recipe 里声明 feature；脚本/校验/插件管理器/Shell capabilities 全部从 manifest 推导。

最低验收：

| 变化 | 必须通过 |
| --- | --- |
| Host-only Tool/prompt | package unit、typecheck、build、真实 Tool/prompt smoke |
| 公开 dual-face 插件 | 上述检查 + `pack:plugins` + `test:e2e:matrix` |
| 私有 workbench/kernel | contract tests + `verify:desktop` + desktop package verification + portable E2E |
| root shell 或 DSH client contract | `verify:desktop` + desktop package + portable E2E |
| DSH 版本变化 | 全部检查，并重新审计 root、SessionFace、RPC、bundle/profile 和 portable runtime |

静态门禁还必须证明：无跨包 `src` 导入；依赖图无环；Shell client 无 Node 和私有包裸依赖；公开 manuscript tarball 不含私有包名、workbench channel、小说工具或知识卡。
