# 插件组合：选择与安装

本文是桌面 **0.2.0** / DSH `0.1.5-rc.2` 的插件组合指南，覆盖 basic / smart / full 组合的选择、声明式拼装、本地 tarball 安装与复现验收。接口契约只在 [插件架构](plugin-architecture.md) 维护，本文不复制。本轮结果见 [0.2.0 验收记录](release-0.2.0.md)。

桌面包版本与公开插件包版本分别维护；三个公开插件经本地 tarball 安装。运行时边界见 [architecture.md](architecture.md)。直观边界见 [组合边界图](https://klarkxy.github.io/dsh-editor/plugin-composition-boundaries.html) 与 [插件分级图](https://klarkxy.github.io/dsh-editor/dsh-editor-plugins.html)；读图时 Host 插件在 DSH 进程内，`host-api` 是进程内库导入。

## 选择组合

| 组合 | 实际业务包 | AI/外部资料 |
| --- | --- | --- |
| 独立文本校对 | `dsh-proofread` | 文本 RPC 无 Agent、会话、文件、模型依赖 |
| 独立资料查询 | `dsh-zhihu` | 普通 RPC/UI 默认启用；Tool 入口另行加入 |
| `basic` 基础写作 | manuscript、proofread、workbench、cards、shell、plugins、overview-panel、memory-panel | 不启用补全、Chat、自动索引、小说工具或知乎 |
| `smart` 智能写作 | basic + novel-kernel | 启用 manuscript-assist、workbench-tools 与 Chat |
| `full` 完整写作（默认） | smart + zhihu | 启用知乎普通服务与 Tool 入口 |

桌面 recipe 的 feature：

| Feature | 作用 | basic | smart | full |
| --- | --- | --- | --- | --- |
| `cards` | 人物卡与世界书（`dsh-editor-cards`） | 是 | 是 | 是 |
| `proofread-panel` | 保留的作品校对面板代码，桌面暂停装载 | 否 | 否 | 否 |
| `overview-panel` | 中栏作品概览（`dsh-editor-overview-panel`） | 是 | 是 | 是 |
| `memory-panel` | 侧栏记忆维护（`dsh-editor-memory-panel`） | 是 | 是 | 是 |
| `assistant` | Chat / novel-kernel | 否 | 是 | 是 |
| `completion` | manuscript-assist | 否 | 是 | 是 |
| `zhihu` | 知乎普通服务 | 否 | 否 | 是 |
| `zhihu-tools` | 知乎 Tool 入口 | 否 | 否 | 是 |

基础写作仍使用 DSH session/workspace 权限，并安装上游基础服务；它证明业务 AI 可选，不代表整个编辑器没有 Harness。workbench 把校对引擎作为必需库：桌面 0.2.0 的 profile 已默认停用 `proofread` 入口，所有 recipe 均移除 `proofread-panel`。保留 workbench 时不能删掉引擎包；独立 Web 的校对插件仍可使用。

组合文件在 `apps/desktop/resources/compositions/{basic,smart,full}.json`，只声明 `id` / `label` / `features`。开发、模板准备、运行时物化和最终包校验由 `scripts/desktop-compositions.mjs` 调用 `scripts/plugin-manifest.mjs` 解析，得出包集合、停用入口、额外 insert 与 Shell feature 服务名。Shell 的业务 contracts 和编辑核心是构建时依赖，已内联；不会因 Shell 的运行依赖把移除的 kernel 或知乎装回来。

## 声明式拼装：dshEditor 与 feature 组合

每个业务包在 `package.json` 里声明 `dshEditor`：

- `role`: `core` 进入每份桌面组合并在插件界面锁定；`feature` 仅在被选中或被 workspace 依赖闭包拉入时装配。
- `visibility`: `public` 打 tarball；`desktop` 只进桌面 profile。
- `entries`: 与该包 `cordis.patch.yml` 的 insert 一一对应。带 `feature` 的入口在未选中该 feature 时写入 `disabledEntries`；`locked: true` 的入口在插件管理里不可关闭。带 `service` 的 feature 会写入 Shell `config.features`。
- `inserts`: 不在包 patch 里、只由组合脚本插入的入口（如 `zhihu-tools`），且仅在其 `feature` 被选中、`requires` 也已选中时加入。
- `wrapClient`: 开发监听是否在 tsdown 成功后跑 `wrap-client.mjs`；未写时也可由 `dsh.client` 推导。

食谱只列 feature。解析器选出全部 core 包、声明了所选 feature 的包，再并上 `dependencies` 里其他 `dsh-*` 工作区包。`proofread` 没有 feature，但 workbench 依赖它，因此每份桌面组合都会带上校对引擎。

没有 `dshEditor` 的纯库包（如 `dsh-editor-workspace-kit`）不成为 bundle：解析结果把它们放进 `libraries`，prepare/verify/e2e 按 `packages + libraries` 复制并断言，但 profile `dsh.profile.bundles` 只列 `packages`。只被 `devDependencies` 引用、构建时内联的库（如 `dsh-editor-seats`）既不进 `packages` 也不进 `libraries`。

运行时插件分级不再读死表：`dsh-editor-plugins` 从 profile `node_modules/<pkg>/package.json` 的 `dshEditor` 建目录。`@deepseek-ai/*` 隐藏；`locked` 入口归核心；其余带 `dshEditor` 的入口可开关；没有该块的包视为社区插件。受保护、不可卸载的包 = 当前 profile `dsh.profile.bundles` 加上 `@deepseek-ai/*`。

新增插件：给包装上 `dshEditor`（并保证 `entries` 与包 patch 一致），若它是可选能力，再把对应 feature 写进需要它的组合食谱。不要再改脚本里的包名列表。

侧栏工具走 Shell 座位与命令注册表，不要再改 `root.ts`。座位合同从 `dsh-editor-seats` 导入（构建时内联）。在 `dsh-editor.sidebar.tools` 或 `dsh-editor.center.overlays` 注册贡献，并从 `dshEditorCommands` 注册命令（含可选快捷键）。座位 props 是 Shell 传入的上下文（当前路径、脏标记、`openDocument`、`onApplied`、`refresh`、locale）。作者确认卡必须用座位上的 `ProposalCard`，插件不得自己写作者正文。中栏 overlay 打开时给根元素加 `CENTER_OVERLAY_ATTRIBUTE`（`data-dsh-center-overlay`），Shell 负责把它放进稿纸格并隐藏稿纸，插件不写 grid 规则。`cards`、`overview-panel` 与 `memory-panel` 使用这条路径；`proofread-panel` 保留合同和代码，但未加入当前 recipe。新增面板只在需要的 recipe 声明 feature。

```powershell
$env:DSH_EDITOR_COMPOSITION = 'basic' # smart / full
pnpm dev
# 或构建该组合的便携产物
pnpm pack:desktop
```

组合切换在保存草稿并关闭宿主后重启生效。运行中的模型任务不承诺热卸载；普通请求、slot 与监听器仍有进程内清理。

## 从本地 tarball 单独安装

```powershell
pnpm build
pnpm pack:plugins
# DSH 0.1.5-rc.2 的本地安装参数不能可靠处理带空格的 file: 路径。
# 将压缩包复制到不含空格的目录；下面在本机使用临时目录。
$stage = Join-Path $env:TEMP 'dsh-plugin-demo'
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item .pack\dsh-proofread-0.1.0.tgz $stage
Copy-Item .pack\dsh-zhihu-0.1.0.tgz $stage
$env:DSH_HOME = Join-Path $stage 'home'
dsh plugin --profile web add "file:$($stage.Replace('\','/'))/dsh-proofread-0.1.0.tgz"
dsh plugin --profile web add "file:$($stage.Replace('\','/'))/dsh-zhihu-0.1.0.tgz"
dsh --profile web
```

这个 HOME 独立于日常配置。只需要其中一个能力时只执行对应的 add。官方 Web 的「校对」和「知乎」入口由插件各自贡献；不用打开小说作品或配置模型即可校对。联网知乎功能需要用户提供凭据，校对不需要。

关闭进程后可移除或重新安装：

```powershell
dsh plugin --profile web remove dsh-proofread
dsh plugin --profile web remove dsh-zhihu
# 重新执行 add 即可恢复；不删除 HOME/storages 或作品文件。
```

`dsh-manuscript`、`dsh-proofread` 与 `dsh-zhihu` 可单独安装。公开产物列表为三包，不能把桌面私有包当成公开 npm 包。私有 Shell 应与受支持写作组合一起部署。

需要 Agent 调用知乎时，在该 profile 的 `cordis.patch.yml` 加入：

```yaml
- insert:
    - id: zhihu-tools
      name: dsh-zhihu/tools
```

该配置要求 `tools` 服务及其 peer；不加入时普通知乎服务没有 `tools` 强注入。桌面组合不用手写这段：`dsh-zhihu` 的 `dshEditor.inserts` 已声明 `zhihu-tools`，recipe 选中 feature `zhihu-tools` 时由 resolver 自动加入（默认 full 已选）。

## 复现验收

全新检出先构建跨包声明，再运行类型检查、测试和公开打包。组合验收按同一份配置准备；使用复制模式可排除工作区链接：

```powershell
pnpm build
pnpm typecheck
pnpm test --maxWorkers=2 --testTimeout=20000
pnpm pack:plugins
node e2e/plugin-matrix.mjs
$env:DSH_EDITOR_COPY_PACKAGES = '1'
foreach ($recipe in @('basic', 'smart', 'full')) {
  $env:DSH_EDITOR_COMPOSITION = $recipe
  node scripts/prepare-desktop-dev.mjs
  node e2e/compositions.mjs
  if ($LASTEXITCODE -ne 0) { throw '组合验收失败' }
}
# 此时模板为 full：验证默认禁用 proofread entry，但保留 workbench 引擎
node e2e/entry-disable.mjs
node e2e/missing-private-plugin.mjs
```

脚本使用隔离 HOME 与作品目录。错误、延迟与取消的界面测试使用受控响应；不会发送在线模型或知乎付费请求。复制模式仅影响开发验收，正常开发默认继续使用便于监听构建的链接。

## 接口合同的分工

插件的接口契约只在 [plugin-architecture.md](plugin-architecture.md) 维护，本文不复制。按需查阅：

- 入口目录、entry id 与 inject 清单：[插件与入口目录](plugin-architecture.md#插件与入口目录)。
- 座位、命令与消息卡合同：[Shell 座位与命令注册表](plugin-architecture.md#shell-座位与命令注册表)。
- RPC 端点表与 loopback 信任边界：[RPC 通用契约](plugin-architecture.md#rpc-通用契约)及 `/manuscript`、`/dsh-editor-workbench`、`/dsh-editor-cards`、`/dsh-editor-plugins` 四节（节标题即 channel 名）。
- 修改、替换与新建步骤：[如何修改或替换现有插件](plugin-architecture.md#如何修改或替换现有插件)、[新建 Host-only 插件](plugin-architecture.md#新建-host-only-插件)、[新建 overlay 插件](plugin-architecture.md#新建-overlay-插件)。

该篇未单列、组合安装需要知道的合同，在此保留一行式：

- proofread：`/proofread` → `text.check`，`{ text, kinds? }` → `{ findings, habitStats, truncated }`。UTF-8 文本 ≤ 2,000,000 字节、结果 ≤ 500 条；只接受文本，不接受路径或 session。finding 位置是 UTF-16 下标，结果只读；kinds 为 `punctuation` / `sensitive` / `repeat` / `typo` / `habit`，人物卡对照只在 workbench 作品扫描中提供。
- manuscript-assist：FIM/patch 与计量的可选服务，是 `dsh-manuscript` 包内的可选 entry，以 `manuscriptAssist` 服务承接 `/manuscript` channel 的转发。
- zhihu：`/zhihu` → `search` / `global.search` / `hot.list` / `ask` / `knowledge.search` / `knowledge.bases` / `knowledge.upload` / `usage.summary`。知识库上传只在界面显式发起，base64 ≤ 20 MB；用量默认 30 天、上限 90 天。五个知乎工具（`zhihu_search` 等）由 `zhihu-tools` 注册，与 UI 共用一个计量写入者（`dsh_editor_zhihu_usage`，version 1），凭据引用 `ZHIHU_ACCESS_TOKEN` 保持。卸载不迁移稿件、草稿、快照、设置 namespace 与凭据引用；换回旧代码不需要数据逆迁移，但仍应保留作品与应用数据备份。

## 最小插件开发范本

权威契约与完整的新建步骤见 [plugin-architecture.md](plugin-architecture.md)。直接阅读已可运行的 `packages/dsh-proofread/`，不另造示例协议：

1. `package.json` 声明 bundle patch、Host/Client 导出与 client 的真实依赖；`cordis.patch.yml` 只插入一个 `proofread` entry。
2. `src/contracts.ts` 固定 channel、输入预算和结果。`src/engine.ts`、`src/defaults.ts` 是纯库，不导入其他业务 Host。
3. `src/index.ts` 只注入 connection / webServer；严格验证输入，注册一个 loopback handler；把返回的 disposer 交给 `ctx.effect`。
4. `src/client.ts` 自己维护输入、加载、错误与结果；`client-state.ts` 用修订号和请求标识抑制旧结果，并实际取消过期请求。
5. proofread Client 只向官方 `shell.overlay` 贡献 UI。桌面 0.2.0 暂停该入口；不把通用扩展座位当成必须挂载的第二入口。
6. `e2e/proofread-host.mjs` 验证无 AI 服务的真实 Host、信任边界、卸载、重装与端口释放；`e2e/plugin-matrix.mjs` 验证 tarball 装卸；`e2e/compositions.mjs` 验证实际 Shell 消费。

桌面专用贡献由 Shell 通过 root 的 `children` 声明 `kind: list`、`scope: root` 并调用 `renderSlot`；插件使用 `slots.inject` 等待，再 `slots.register` 注册。知乎的桌面入口是 `dsh-editor.settings.zhihu`，普通 Web 仍用 `shell.overlay`；插件管理使用 `dsh-editor.settings.plugins`。通用 `dsh-editor.extensions` 保留，但当前 proofread 与知乎不在此挂载。slot 撤销由 Cordis 清理贡献，React 卸载终止请求，样式通过 effect 移除。

## 精简宿主实验

```powershell
node e2e/proofread-host.mjs
```

该脚本启动真实的 Cordis WebServer + Connection + proofread，没有 agents/sessions/fs/llm/tools/systemPrompt。没有选择 `dsh-web-app` 时，仍可用显式通信、静态资源、settings、locale、theme、layout、renderer 等条目完成校对与页面重连；它保留 `dsh-base` 的 Agent 服务，也继续使用官方基础组件。

完全移除 Agent 服务的浏览器组合目前无法启动。实际缺口为：`dsh-workspace` 要求 `sessionPersistence`；`dsh-host-apiproxy` 要求 agents/llm/sessions/tools 等全量服务；`dsh-cordis-host-runner` 要求 tools。最小上游工作是拆出仅服务普通业务的网关/客户端运行入口，让 Agent remotes 与工具宿主按需启用。文件型应用还需独立的工作区授权入口，当前继续保留 live session；不能在浏览器接受任意 cwd 或伪造 session。

拆分初次验收未把在线模型与知乎付费调用作为确定性回归执行；真实网络账单、服务配额和长时间运行表现不在这些回执的覆盖范围内。
