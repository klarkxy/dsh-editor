# 插件组合：选择与安装

本文是桌面 **0.2.0** / DSH `0.1.5-rc.2` 的插件组合指南，覆盖桌面能力集合、canonical recipe `desktop` 与 `basic` / `smart` / `full` 兼容别名、声明式拼装、本地 tarball 安装与复现验收。接口契约只在 [插件架构](plugin-architecture.md) 维护，本文不复制。本轮结果见 [0.2.0 验收记录](release-0.2.0.md)。

桌面包版本与公开插件包版本分别维护；三个公开插件经本地 tarball 安装。运行时边界见 [architecture.md](architecture.md)。直观边界见 [组合边界图](https://klarkxy.github.io/dsh-editor/plugin-composition-boundaries.html) 与 [插件分级图](https://klarkxy.github.io/dsh-editor/dsh-editor-plugins.html)；读图时 Host 插件在 DSH 进程内，`host-api` 是进程内库导入。

## 一份 canonical recipe，三个兼容别名

桌面能力集合只有一份 canonical recipe：`apps/desktop/resources/compositions/desktop.json`（label `桌面写作`）。`basic`、`smart`、`full` 不再是三种产品模式，只是工具解析的兼容别名——解析 `desktop.json` 后仅覆盖 `id` / `label`，feature、包、停用入口、insert 与 Shell 服务名完全相同。四个 id 都可写给脚本和环境变量（`DSH_EDITOR_COMPOSITION`），未指定时默认 `desktop`。

写作模式属于新对话 Preset，不在 recipe 里分支。四个当前 Preset 共用同一套桌面 UI：

| Preset | 用途 | 来源 |
| --- | --- | --- |
| `dsh-editor-writing` | 通用写作；新会话默认；不挂 novel-kernel | 应用模板内建；核心锁定，不可关闭 |
| `dsh-editor-novel` | 小说创作；以 `knowledge-only` 挂 novel-kernel（仅 `novel_knowledge`），外加共用 `writing_propose` / `author_observe` | `dsh-editor-novel-kernel` 的 `presets/`；可在设置「插件 → 写作模式」开关 |
| `dsh-editor-article` | 文章与自媒体；不挂 novel-kernel | `dsh-editor-writing-presets` 的 `presets/`；同上可开关 |
| `dsh-editor-technical` | 技术文档；不挂 novel-kernel | `dsh-editor-writing-presets` 的 `presets/`；同上可开关 |

第一方 preset 由包以 `dshEditor.presets` 声明、随 recipe feature `writing-presets` 进入组合，`configureProfile` 把它们复制进物化模板的 `agent-presets/`（写 app-owned marker），部署通道与模板内建 preset 相同。开关立即部署 / 删除 `<dshHome>/.agent-presets/<id>`，picker 下次列表即反映；进行中的会话不受影响。

历史 `dsh-editor` 不进新建 picker（设置页"开发者模式"开启时例外：picker 追加列出 Host 返回的全部 preset，旧版带"诊断用途"徽标与迁移指引描述）。新对话：草稿保护通过后 `list` 四个 Preset → 确认后才 blank `create` → `select` → 以 Host 真实投影打开；取消确认不 create。已有对话只切换。四个新 Preset 走 `writing_propose` V2：改已有文件必须带生成时 Host-read 的目标基线（edit/split 的 `targetVersion`，merge 的 `targetVersion`+`sourceVersion`，renames 每项 `version`）；可选 `basis` 只做独立来源依赖校验，不能代替目标基线。V2 create 是独占新建。不自动建索引、scratch、frontmatter，也不走 `context.compile`。可见 `dsh-editor-novel` 只多 `novel_knowledge`。只有 Host 上的 hidden legacy 会话才挂 novel-kernel 完整表面，并跑旧采访、自动索引、frontmatter 与 `context.compile`。旧版会话打开时顶部显示迁移横幅（可新建写作会话继续作品；关闭仅记忆在内存，历史与文件不动）。通用 / 文章 / 技术不挂 novel-kernel。作品是普通文件夹；专业目录只在作者确认 create 提案后出现。

| 交付 | 实际业务包 | AI/外部资料 |
| --- | --- | --- |
| 独立文本校对 | `dsh-proofread` | 文本 RPC 无 Agent、会话、文件、模型依赖 |
| 独立资料查询 | `dsh-zhihu` | 普通 RPC/UI 默认启用；Tool 入口另行加入 |
| 桌面能力集合（canonical 或任一别名） | manuscript、proofread、workbench、novel-kernel、writing-presets、zhihu、shell、plugins、overview-panel、proofread-panel | 启用 Chat、补全、知乎普通服务与 Tool、四个 Preset 共用的文稿校对 UI；不装 cards / memory-panel（core 不强依赖） |

桌面 recipe 的 canonical features 是 `assistant`、`completion`、`zhihu`、`zhihu-tools`、`overview-panel`、`proofread-panel`、`writing-presets`：

| Feature | 作用 | 当前桌面 |
| --- | --- | --- |
| `assistant` | Chat；把 novel-kernel 打进包集合 | 是 |
| `completion` | manuscript-assist | 是 |
| `zhihu` | 知乎普通服务 | 是 |
| `zhihu-tools` | 知乎 Tool 入口 | 是 |
| `overview-panel` | 中栏作品概览（`dsh-editor-overview-panel`） | 是 |
| `proofread-panel` | 侧栏文稿校对（`dsh-editor-proofread-panel`）；当前文档 / 全部可见 md/txt；五项 kind，不含 `card` | 是 |
| `writing-presets` | 第一方写作模式 preset 包（`dsh-editor-writing-presets`：文章与自媒体、技术文档） | 是 |
| `cards` | 人物卡与世界书 UI（`dsh-editor-cards`） | 否（默认关闭；需显式 feature 才会装入） |
| `memory-panel` | 侧栏记忆维护（`dsh-editor-memory-panel`） | 否 |

novel-kernel 包随桌面能力集合安装。可见 `dsh-editor-novel` 显式 `mode: knowledge-only`（仅 `novel_knowledge`）；完整表面只挂 hidden legacy `dsh-editor`（显式 `mode: legacy`）；通用 / 文章 / 技术不挂该入口。四个 Preset 共用 `proofread-panel` 文稿校对 UI。workbench 把校对引擎作为必需库；桌面顶层 `proofread` 入口仍可 disabled，因为面板调 workbench `proofread.scan`。保留 workbench 时不能删掉引擎包；独立 Web 的校对插件仍可使用。

组合文件只有一份：`apps/desktop/resources/compositions/desktop.json`，只声明 `id` / `label` / `features`。`basic` / `smart` / `full` 没有独立文件，由 `scripts/desktop-compositions.mjs` 的内置别名表解析为同一份 recipe 并覆盖 `id` / `label`。开发、模板准备、运行时物化和最终包校验由 `scripts/desktop-compositions.mjs` 调用 `scripts/plugin-manifest.mjs` 解析，得出包集合、停用入口、额外 insert 与 Shell feature 服务名。Shell 的业务 contracts 和编辑核心是构建时依赖，已内联；不会因 Shell 的运行依赖把未选中的面板装回来。

## 声明式拼装：dshEditor 与 feature 组合

每个业务包在 `package.json` 里声明 `dshEditor`：

- `role`: `core` 进入桌面组合并在插件界面锁定；`feature` 仅在被选中或被 workspace 依赖闭包拉入时装配。
- `visibility`: `public` 打 tarball；`desktop` 只进桌面 profile。
- `entries`: 与该包 `cordis.patch.yml` 的 insert 一一对应。带 `feature` 的入口在未选中该 feature 时写入 `disabledEntries`；`locked: true` 的入口在插件管理里不可关闭。带 `service` 的 feature 会写入 Shell `config.features`。
- `inserts`: 不在包 patch 里、只由组合脚本插入的入口（如 `zhihu-tools`），且仅在其 `feature` 被选中、`requires` 也已选中时加入。
- `features`: 没有 Cordis 入口的包（如 `dsh-editor-writing-presets`）靠这个清单参与 feature 选择；选中即整包进入组合。
- `presets`: 包内对话 preset `[{ id, path }]`；`visibility: desktop` 的第一方包可声明 `dsh-editor` 前缀 id，社区/公开插件不可。被选中包的 preset 进入 `composition.json`，由 `configureProfile` 复制进模板 `agent-presets/`。
- `wrapClient`: 开发监听是否在 tsdown 成功后跑 `wrap-client.mjs`；未写时也可由 `dsh.client` 推导。

食谱只列 feature。解析器选出全部 core 包、声明了所选 feature 的包（入口的 `feature` 或包级 `dshEditor.features`），再并上 `dependencies` 里其他 `dsh-*` 工作区包。`proofread` 没有 feature，但 workbench 依赖它，因此桌面组合总会带上校对引擎。

没有 `dshEditor` 的纯库包（如 `dsh-editor-workspace-kit`）不成为 bundle：解析结果把它们放进 `libraries`，prepare/verify/e2e 按 `packages + libraries` 复制并断言，但 profile `dsh.profile.bundles` 只列 `packages`。只被 `devDependencies` 引用、构建时内联的库（如 `dsh-editor-seats`）既不进 `packages` 也不进 `libraries`。

运行时插件分级不再读死表：`dsh-editor-plugins` 从 profile `node_modules/<pkg>/package.json` 的 `dshEditor` 建目录。`@deepseek-ai/*` 隐藏；`locked` 入口归核心；其余带 `dshEditor` 的入口可开关；没有该块的包视为社区插件。受保护、不可卸载的包 = 当前 profile `dsh.profile.bundles` 加上 `@deepseek-ai/*`。

新增插件：给包装上 `dshEditor`（并保证 `entries` 与包 patch 一致），若它是可选能力，再把对应 feature 写进 canonical recipe `desktop.json`（三个别名自动跟随）。不要再改脚本里的包名列表，也不要再按 basic / smart / full 拆产品模式。

侧栏工具走 Shell 座位与命令注册表，不要再改 `root.ts`。座位合同从 `dsh-editor-seats` 导入（构建时内联）。在 `dsh-editor.sidebar.tools` 或 `dsh-editor.center.overlays` 注册贡献，并从 `dshEditorCommands` 注册命令（含可选快捷键）。座位 props 是 Shell 传入的上下文（当前路径、脏标记、`openDocument`、`onApplied`、`refresh`、locale）。作者确认卡必须用座位上的 `ProposalCard`，插件不得自己写作者正文。中栏 overlay 打开时给根元素加 `CENTER_OVERLAY_ATTRIBUTE`（`data-dsh-center-overlay`），Shell 负责把它放进稿纸格并隐藏稿纸，插件不写 grid 规则。`overview-panel` 与 `proofread-panel` 使用这条路径；`cards` 与 `memory-panel` 合同仍在，但当前能力集合不启用。

```powershell
$env:DSH_EDITOR_COMPOSITION = 'desktop' # canonical recipe；basic / smart / full 为兼容别名，解析结果除 id/label 外相同
pnpm dev
# 或构建该组合的便携产物
pnpm pack:desktop
```

更换组合 id（`desktop` 或任一别名）在保存草稿并关闭宿主后重启生效，能力集合不变。运行中的模型任务不承诺热卸载；普通请求、slot 与监听器仍有进程内清理。

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

`dsh-manuscript`、`dsh-proofread` 与 `dsh-zhihu` 可单独安装。公开产物列表为三包，不能把桌面私有包当成公开 npm 包。私有 Shell 应与当前桌面能力集合一起部署。

需要 Agent 调用知乎时，在该 profile 的 `cordis.patch.yml` 加入：

```yaml
- insert:
    - id: zhihu-tools
      name: dsh-zhihu/tools
```

该配置要求 `tools` 服务及其 peer；不加入时普通知乎服务没有 `tools` 强注入。桌面能力集合不用手写这段：`dsh-zhihu` 的 `dshEditor.inserts` 已声明 `zhihu-tools`，当前 recipe 已选 feature `zhihu-tools`，由 resolver 自动加入。

## 复现验收

全新检出先构建跨包声明，再运行类型检查、测试和公开打包。组合验收按同一份配置准备；使用复制模式可排除工作区链接：

```powershell
pnpm build
pnpm typecheck
pnpm test --maxWorkers=2 --testTimeout=20000
pnpm pack:plugins
node e2e/plugin-matrix.mjs
$env:DSH_EDITOR_COPY_PACKAGES = '1'
# canonical recipe 一次即可：e2e/compositions.mjs 内部会同时物化 desktop 与 basic/smart/full 三个别名并断言一致
$env:DSH_EDITOR_COMPOSITION = 'desktop'
node scripts/prepare-desktop-dev.mjs
node e2e/compositions.mjs
if ($LASTEXITCODE -ne 0) { throw '组合验收失败' }
# canonical 与三个别名解析同一能力集合后，验证默认禁用 proofread entry，但保留 workbench 引擎
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

- proofread：`/proofread` → `text.check`，`{ text, kinds? }` → `{ findings, habitStats, truncated }`。UTF-8 文本 ≤ 2,000,000 字节、结果 ≤ 500 条；只接受文本，不接受路径或 session。finding 位置是 UTF-16 下标，结果只读；kinds 为 `punctuation` / `typo` / `sensitive` / `repeat` / `habit`，不含 `card`。桌面文稿校对不走此公开入口，而走 workbench `proofread.scan`。
- manuscript-assist：FIM/patch 与计量的可选服务，是 `dsh-manuscript` 包内的可选 entry，以 `manuscriptAssist` 服务承接 `/manuscript` channel 的转发。
- zhihu：`/zhihu` → `search` / `global.search` / `hot.list` / `ask` / `knowledge.search` / `knowledge.bases` / `knowledge.upload` / `usage.summary`。知识库上传只在界面显式发起，base64 ≤ 20 MB；用量默认 30 天、上限 90 天。五个知乎工具（`zhihu_search` 等）由 `zhihu-tools` 注册，与 UI 共用一个计量写入者（`dsh_editor_zhihu_usage`，version 1），凭据引用 `ZHIHU_ACCESS_TOKEN` 保持。卸载不迁移稿件、草稿、快照、设置 namespace 与凭据引用；换回旧代码不需要数据逆迁移，但仍应保留作品与应用数据备份。

## 最小插件开发范本

权威契约与完整的新建步骤见 [plugin-architecture.md](plugin-architecture.md)。直接阅读已可运行的 `packages/dsh-proofread/`，不另造示例协议：

1. `package.json` 声明 bundle patch、Host/Client 导出与 client 的真实依赖；`cordis.patch.yml` 只插入一个 `proofread` entry。
2. `src/contracts.ts` 固定 channel、输入预算和结果。`src/engine.ts`、`src/defaults.ts` 是纯库，不导入其他业务 Host。
3. `src/index.ts` 只注入 connection / webServer；严格验证输入，注册一个 loopback handler；把返回的 disposer 交给 `ctx.effect`。
4. `src/client.ts` 自己维护输入、加载、错误与结果；`client-state.ts` 用修订号和请求标识抑制旧结果，并实际取消过期请求。
5. 公开 `dsh-proofread` Client 只向官方 `shell.overlay` 贡献 UI。桌面顶层 `proofread` 入口仍可 disabled；四个 Preset 的文稿校对由 `dsh-editor-proofread-panel` 挂侧栏座位。不把通用扩展座位当成必须挂载的第二入口。
6. `e2e/proofread-host.mjs` 验证无 AI 服务的真实 Host、信任边界、卸载、重装与端口释放；`e2e/plugin-matrix.mjs` 验证 tarball 装卸；`e2e/compositions.mjs` 验证实际 Shell 消费。

桌面专用贡献由 Shell 通过 root 的 `children` 声明 `kind: list`、`scope: root` 并调用 `renderSlot`；插件使用 `slots.inject` 等待，再 `slots.register` 注册。知乎的桌面入口是 `dsh-editor.settings.zhihu`，普通 Web 仍用 `shell.overlay`；插件管理使用 `dsh-editor.settings.plugins`。通用 `dsh-editor.extensions` 保留，但当前 proofread 与知乎不在此挂载。slot 撤销由 Cordis 清理贡献，React 卸载终止请求，样式通过 effect 移除。

## 精简宿主实验

```powershell
node e2e/proofread-host.mjs
```

该脚本启动真实的 Cordis WebServer + Connection + proofread，没有 agents/sessions/fs/llm/tools/systemPrompt。没有选择 `dsh-web-app` 时，仍可用显式通信、静态资源、settings、locale、theme、layout、renderer 等条目完成校对与页面重连；它保留 `dsh-base` 的 Agent 服务，也继续使用官方基础组件。

完全移除 Agent 服务的浏览器组合目前无法启动。实际缺口为：`dsh-workspace` 要求 `sessionPersistence`；`dsh-host-apiproxy` 要求 agents/llm/sessions/tools 等全量服务；`dsh-cordis-host-runner` 要求 tools。最小上游工作是拆出仅服务普通业务的网关/客户端运行入口，让 Agent remotes 与工具宿主按需启用。文件型应用还需独立的工作区授权入口，当前继续保留 live session；不能在浏览器接受任意 cwd 或伪造 session。

拆分初次验收未把在线模型与知乎付费调用作为确定性回归执行；真实网络账单、服务配额和长时间运行表现不在这些回执的覆盖范围内。
