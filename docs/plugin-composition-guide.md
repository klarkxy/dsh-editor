# 可组合插件：安装、接口与开发示例

> 后续更新：已授权的 MiniMax-M3 在线实测及修复见[在线验证记录](minimax-live-validation.md)。本文件的原始回执保留为当时快照；当前仍有两项非 AI 交互待定位。

本地实现基线：2026-09-09，DSH `0.1.1-rc.2`。这份指南对应当前工作区的拆分实现；包尚未发布到 npm。历史验证与本轮结果分开保存在 [实施记录](plugin-modularization-progress.md)。直观边界见 [组合边界图](https://klarkxy.github.io/dsh-editor/plugin-composition-boundaries.html) 与 [插件分级图](https://klarkxy.github.io/dsh-editor/dsh-editor-plugins.html)；读图时 Host 插件在 DSH 进程内，`host-api` 是库导入。

## 选择组合

| 组合 | 实际业务包 | AI/外部资料 |
| --- | --- | --- |
| 独立文本校对 | `dsh-proofread` | 文本 RPC 无 Agent、会话、文件、模型依赖 |
| 独立资料查询 | `dsh-zhihu` | 普通 RPC/UI 默认启用；Tool 入口另行加入 |
| `basic` 基础写作 | manuscript、proofread、workbench、shell、plugins | 不启用补全、Chat、自动索引、小说工具或知乎 |
| `smart` 智能写作 | basic + novel-kernel | 启用 manuscript-assist、workbench-tools 与 Chat |
| `full` 完整写作（默认） | smart + zhihu | 启用知乎普通服务与 Tool 入口 |

基础写作仍使用 DSH session/workspace 权限，并安装上游基础服务。它证明业务 AI 可选，不代表整个编辑器没有 Harness。workbench 将校对引擎作为必需库使用：可以停用校对插件入口，但保留 workbench 时不能删掉引擎包。

组合文件在 `apps/desktop/resources/compositions/{basic,smart,full}.json`。开发、模板准备、运行时物化和最终包校验均从 `scripts/desktop-compositions.mjs` 读取它们。Shell 的业务 contracts 和编辑核心是构建时依赖，已内联，不会因 Shell 的运行依赖把移除的 kernel 或知乎装回来。

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
# DSH 0.1.1-rc.2 的本地安装参数不能可靠处理带空格的 file: 路径。
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

这个 HOME 独立于日常配置。只需要其中一个能力时只执行对应的 add。官方 Web 的“校对”和“知乎”入口由插件各自贡献；不用打开小说作品或配置模型即可校对。联网知乎功能需要用户提供凭据，校对不需要。

关闭进程后可移除或重新安装：

```powershell
dsh plugin --profile web remove dsh-proofread
dsh plugin --profile web remove dsh-zhihu
# 重新执行 add 即可恢复；不删除 HOME/storages 或作品文件。
```

`dsh-manuscript`、`dsh-proofread` 与 `dsh-zhihu` 可单独安装。公开产物列表为三包，不能把三个桌面私有包当成公开 npm 包。私有 Shell 应与受支持写作组合一起部署。

需要 Agent 调用知乎时，在该 profile 的 `cordis.patch.yml` 加入：

```yaml
- insert:
    - id: zhihu-tools
      name: dsh-zhihu/tools
```

该配置要求 `tools` 服务及其 peer；不加入时普通知乎服务没有 `tools` 强注入。默认 full 桌面组合已显式加入，勿重复添加。

## 复现验收

先运行类型检查、测试、构建和公开打包。组合验收按同一份配置准备；使用复制模式可排除工作区链接：

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm pack:plugins
node e2e/plugin-matrix.mjs
$env:DSH_EDITOR_COPY_PACKAGES = '1'
foreach ($recipe in @('basic', 'smart', 'full')) {
  $env:DSH_EDITOR_COMPOSITION = $recipe
  node scripts/prepare-desktop-dev.mjs
  node e2e/compositions.mjs
  if ($LASTEXITCODE -ne 0) { throw '组合验收失败' }
}
# 此时模板为 full：保留引擎，仅停用 proofread entry 的额外场景
node e2e/entry-disable.mjs
node e2e/missing-private-plugin.mjs
```

脚本使用隔离 HOME 与作品目录。错误、延迟与取消的界面测试使用受控响应；不会发送在线模型或知乎付费请求。复制模式仅影响开发验收，正常开发默认继续使用便于监听构建的链接。

## 每块积木的合同

所有自定义 RPC 都使用已有 Connection 的 loopback 信任边界。返回统一的 `{ ok: true, value }` 或 `{ ok: false, error: { code, message, details } }`。

| 所有者 | 入口 | 核心输入/输出 | 权限与可选依赖 |
| --- | --- | --- | --- |
| proofread | `/proofread` → `text.check` | `{text, kinds?}` → `{findings, habitStats, truncated}` | 仅 connection；UTF-8 文本最多 2,000,000 字节、最多 500 条；不接受路径/session/自定义预算 |
| manuscript | `/manuscript` → 现有文件、草稿、search、proposal | 旧输入和版本门禁保持 | live session 重建文件权限；只有它注册此 channel |
| manuscript-assist | `manuscriptAssist` 服务 | 原 channel 转发 FIM/patch 与 usage | 同包可选 entry，依赖 llm/storageDomain；尚未另成 writing-assist 包 |
| workbench | `/dsh-editor-workbench` | 作品、卡片、扫描、快照、导入、归档 | 仍用同一 workspace authority；scan 保留 card 和跨文件 habit 聚合 |
| workbench-tools | `novel_overview` | 现有只读工具合同 | 可选 entry，依赖 tools 和工作区权限 |
| zhihu | `/zhihu` → `search`、`global.search`、`hot.list`、`ask`、`knowledge.search` | 查询、条数、搜索源/模型/召回范围 → 原结构结果 | connection/credentials/storageDomain；无小说和会话依赖 |
| zhihu | `knowledge.bases`、`knowledge.upload`、`usage.summary` | 上传显式确认，base64 ≤20 MB；用量默认30天、最大90天 | `ZHIHU_ACCESS_TOKEN` 引用保持；计量唯一所有者 |
| zhihu-tools | `zhihu_search`、`zhihu_global_search`、`zhihu_hot_list`、`zhihu_ask`、`zhihu_knowledge_search` | 现有工具输入输出 | 通过同一 zhihu 服务的生命周期与计量；无重复 channel |
| novel-kernel | 9个小说工具、guard、prompt、`/novel-kernel` | 小说协作及旧知乎知识库 endpoint 转发 | 不再依赖知乎凭据；缺知乎只影响兼容知乎调用 |
| shell | `/dsh-editor-shell` → `capabilities.get` | `{assistant, completion, zhihu}` | 已选依赖缺失返回明确错误；正常未启用返回 false |
| plugins | `/dsh-editor-plugins` | 已装清单、开关、GitHub `dsh-plugin` 搜索、静态检查与安装 | 核心插件锁定；`blocked` 拒绝安装；安装/卸载后重启 |

proofread finding 位置沿用 UTF-16 下标；结果只读，不直接修改当前文稿。支持 `punctuation/sensitive/repeat/typo/habit`，人物卡检查只在 workbench 作品扫描中提供。

`/novel-kernel` 的 `zhihu.knowledge.bases/upload` 和 `/manuscript` 的 `zhihu.usage` 由原 channel 所有者转发至新服务。旧、新 UI 和 Tool 共用一个计量写入者，继续写 `dsh_editor_zhihu_usage` version 1。稿件、草稿、快照、设置 namespace 和凭据引用不迁移；换回旧代码不需要数据逆迁移，但仍应保留作品与应用数据备份。

## 最小插件开发范本

直接阅读已可运行的 `packages/dsh-proofread/`，不另造示例协议：

1. `package.json` 声明 bundle patch、Host/Client 导出与 client 的真实依赖；`cordis.patch.yml` 只插入一个 `proofread` entry。
2. `src/contracts.ts` 固定 channel、输入预算和结果。`src/engine.ts`、`src/defaults.ts` 是纯库，不导入其他业务 Host。
3. `src/index.ts` 只注入 connection；严格验证输入，注册一个 loopback handler；把返回的 disposer 交给 `ctx.effect`。
4. `src/client.ts` 自己维护输入、加载、错误与结果；`client-state.ts` 用修订号和请求标识抑制旧结果，并实际取消过期请求。
5. 同一个 Client 在官方 `shell.overlay` 与产品 `dsh-editor.extensions` 两个 list slot 上等待声明并贡献 UI。单个根所有者只声明自己消费的座位，不把另一产品的 root 或整个 ShellContext 暴露给插件。
6. `e2e/proofread-host.mjs` 验证无 AI 服务的真实 Host、信任边界、卸载、重装与端口释放；`e2e/plugin-matrix.mjs` 验证 tarball 装卸；`e2e/compositions.mjs` 验证实际 Shell 消费。

`dsh-editor.extensions` 的最小参数为空：插件有自己的开关、关闭和输入。Shell 通过 root 的 `children` 声明 `kind: list, scope: root` 并调用 `renderSlot`，插件使用 `slots.inject` 等待、再 `slots.register` 注册。slot 撤销/插件销毁由 Cordis 清理贡献；React 卸载终止请求，样式通过 effect 移除。两个真实消费者是 proofread 和 zhihu，不需要额外插件注册中心。

## 精简宿主实验

```powershell
node e2e/proofread-host.mjs
node e2e/host-minimization.mjs
```

前者启动真实 Cordis WebServer + Connection + proofread，没有 agents/sessions/fs/llm/tools/systemPrompt。后者从真实 DSH profile 启动：不选择 `dsh-web-app` 时，以显式通信、静态资源、settings、locale、theme、layout、renderer 等条目完成校对与页面重连；它仍保留 `dsh-base` 的 Agent 服务，也继续使用官方基础组件。

完全移除 Agent 服务的浏览器组合目前无法启动。实际缺口为：`dsh-workspace` 要求 `sessionPersistence`；`dsh-host-apiproxy` 要求 agents/llm/sessions/tools 等全量服务；`dsh-cordis-host-runner` 要求 tools。最小上游工作是拆出仅服务普通业务的网关/客户端运行入口，让 Agent remotes 与工具宿主按需启用。文件型应用还需独立的工作区授权入口，当前继续保留 live session；不能在浏览器接受任意 cwd 或伪造 session。

拆分初次验收时，在线模型与知乎付费调用未作为确定性回归执行；真实网络账单、服务配额和长时间运行不是这些回执的结论。
