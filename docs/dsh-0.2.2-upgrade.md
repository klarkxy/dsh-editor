# DSH 0.2.2 升级审计

日期：2026-11-05。目标版本 **0.2.2-rc.1**（npm `next` 通道），仍不是无后缀稳定版。上一轮升级（0.2.0-rc.2 → 0.2.1-rc.5）的审计见 docs/dsh-0.2.1-upgrade.md。

本文前半记录首轮升级时的操作与验证状态；2026-11-14 的发布审查补验见文末。

## 升级范围

- 版本切换由 `node scripts/upgrade-dsh.mjs --to 0.2.2-rc.1 --skip-install` 完成，共改写 52 个文件 140 处版本钉住；未改全局 CLI，未提交、推送或发布。
- `scripts/upgrade-dsh.mjs` 的 `SKIP_REWRITE_PREFIXES` 新增 `docs/dsh-0.2.2-upgrade.md`，与三份历史升级审计一起免于后续盲替换。
- 依赖闭包：根 `package.json` 的 `pnpm.overrides` 中既有的全部 `@deepseek-ai/dsh-*` 钉住改为 0.2.2-rc.1；三条钉住从 overrides 中删除：`dsh-subagent-in-process-driver` 与 `dsh-invariants` 在 0.2.2-rc.1 上已无发布版本（npm 404），`dsh-web-search-exa` 随上游搜索默认迁移退出依赖图（`dsh-base` 现依赖 `dsh-web-search-deepseek`）。
- 新增两条非 DSH 钉住：`@deepseek-ai/cordis@4.1.0`（上游 0.2.2 各包 peer 要求 `~4.1.0`，而图里残留 4.0.5，桌面运行时依赖复制报 "bundled runtime dependency conflict"；钉 4.1.0 后只剩一份，自有包 peer `^4.0.4` 本就满足）与 `@deepseek-ai/schemastery@3.19.0`（上游精确钉 3.19.0，本仓 `^3.18.3` 解析出 3.18.5，两套实例让推断类型不可移植，shell 三个 config 文件报 TS2742）。
- 锁文件教训：首轮删除 `pnpm-lock.yaml` 重建后仍解析出 19 个 `@deepseek-ai/dsh-*@0.2.1-rc.5` 快照（上游 peer 区间 `0.2` 对既有 node_modules 里遗留的 0.2.1 副本做了 dedupe 复用）。删除全部 workspace `node_modules` 后重装，锁文件中 0.2.1-rc.5 上游快照归零；zod / cordis / schemastery 各保留一份（zod 4.4.3 沿用上游精确钉）。

## 补丁处置

| 补丁 | 处置 | 依据 |
| --- | --- | --- |
| `@deepseek-ai__dsh-web-frontend@0.2.2-rc.1.patch` | 移植，目标资产改名 | Tag 等规则仍是 11px/17px 内联在新哈希资产 `index-lh_YM6sT.css`；补丁把全部两处提升为 12px/18px，意图不变。 |
| `@deepseek-ai__dsh-experimental-client-ui-voice-input@0.2.2-rc.1.patch` | 移植，意图不变 | 上游 0.2.2 制品仍在查看语音准备页时 `acquire()` 采集预览（无 `wanted` 门控、无 `previewStart` 文案）。六处 hunk 按原样落到新 `lib/client.js`：`wanted` 状态门控、`wanted && !document.hidden` 采集条件、effect 依赖加 `wanted`、「测试麦克风 / 停止测试」按钮与中英文案；其余六个上游 locale 与旧补丁一致未覆盖。`scripts/voice-input-patch.spec.mjs` 校验安装制品。 |

## 官方升级指南核对

对照缓存的上游升级指南逐项检查。官方指南目录只有 `v0.2.2-alpha.2` 与 `v0.2.2-alpha.3` 两组（共 24 条），没有 alpha.1 或 rc.1 条目，覆盖止于 alpha.3；`code-scan.mjs` 已对全部 `packages/*` 与 `apps/desktop` 跑过并逐条分诊。

- **web-search-default-provider（alpha.2）**：上游 `web.searchProvider` 默认从 `deepseek-official`（走模型请求、按 token 计费）改为 `deepseek-search-api`（直连 Search API，可能按 Search API 计费；默认把用户最近一条提问截断到 128 字符作 `ori_question` 发送，`web-deepseek-api.sendOriginalQuestion` 置 `false` 可关）。编辑器有意不覆写 `web` 配置，跟随上游默认；Exa 与 Perplexity 搜索包上游移除，overrides 中 exa 钉住同步删除，仓库内无 perplexity 引用；`dsh-web-search-tavily` 的退役钉住保留为旧 profile 守卫。
- **web-search-credential-modes（alpha.2）**：Search/Fetch 端点改随 DeepSeek 模型路由，`baseURL` / `apiKeyEnv` / `apiKey` 共享字段移除（旧值静默忽略），`DEEPSEEK_BASE_URL` 现同时影响搜索与抓取。五个写作预设的 `tool-web` 行只设 `fetch` / `searchTimeoutMs`，不含被移除字段，无需迁移。
- **session-header-menu（alpha.2）**：自定义 Web composition 需为 Session 动作提供上下文菜单。编辑器 shell 以自有 `uiWorkspace` / `layout` 替换官方会话界面，无上游 Session 动作行。新增的上游 `ui-context-menu` 行提供 `contextMenus` 服务，被仍启用的官方停靠条目依赖，因此保留启用（见下节）。
- **context-menu-target / css-anchored-menus（alpha.2）**：要求改用带前缀的菜单类型与 CSS anchor。编辑器客户端不消费上游菜单 API（文件树 `menuTargetPath` 等是自有 UI prop），不适用。
- **llm-request-purpose-declarations（alpha.2）**：辅助 LLM 请求的 `purpose` 需要生产者自有类型声明。编辑器调用点本就是生产者字面值（`manuscript.completion`、`manuscript.rewrite`、`compaction`），类型检查通过，无需改动。
- **projection-snapshot-scope / projection-event-frames / projection-released-checkpoint（alpha.2）**：`llm-bridge` 里 `ctx.get('sessionProjections', true)` 仅为弱类型可观测读取（`unknown`），不消费快照结构；无 projection 注册或使用，无改动。
- **cordis-loader-entry-trees（alpha.2）**：`apps/desktop` 与 scripts 不使用 `EntryTree` / `applyEntryPatches` / Include journal；profile 补丁合并沿用 cordis.patch.yml 机制，不适用。
- **fs-observation-policy-default-off（alpha.2）**：上游策略行改为默认关闭，写/改/apply_patch 不再要求先读，`dsh-base` 与 Web 标准预设获得 `apply_patch`；对编辑器无强制动作，能力随 `dsh-base` 流动。
- **schedule-agent-tools（alpha.2）**：`schedule_create` / `schedule_list` / `schedule_view` / `schedule_edit` 替换 `schedule_update` / `schedule_delete`。发行补丁中 `schedule` 与 `ui-schedule` 保持 `disabled: true`，重命名不影响编辑器组合。
- **subagent-explicit-reasoning（alpha.2）与 subagent-names（alpha.3）**：子代理推理覆写需显式 provider/model，控制与 Team 工具改按名字寻址，`list_agents` 行变化。编辑器预设不配置子代理。**持久化注意**：subagent catalog 写 payload version 3，升级后创建过子代理的会话无法用旧版运行时打开（单向）。
- **chat-process-activity-context（alpha.3）**：`ProcessActivity` 增加 `context` 类别；编辑器不消费该类型。
- **其余 alpha.2 条目**（cua-source-dev-helper、desktop-stable-channel、forge-git-permissions、forge-worktree-entry、pi-ai-request-image-count、retained-ptc-timeout、schedule-remote-host-tasks、sdk-run-commands）：均为编辑器不发行的能力或宿主外工具，不适用。

## 上游新增 / 移除行

对比 `dsh-base` 与 `dsh-web-app` 的 cordis.patch.yml（0.2.1-rc.5 → 0.2.2-rc.1）：

| 行 | 变化 | 处置 |
| --- | --- | --- |
| `tool-executor-native`（dsh-base） | 新增 | 能力行，保留上游默认；core-loop e2e 验证工具调用。 |
| `tool-executor-ptc`（dsh-base） | 新增 | 能力行，保留上游默认。 |
| `tool-subagent-list-agents`（dsh-base / dsh-web-app） | 移除 | 上游删除，发行补丁未引用，无需处置。 |
| `deliverable-file-references`（dsh-web-app） | 新增 | 服务行，保留上游默认。 |
| `message-quotes`（dsh-web-app） | 新增 | 服务行，保留上游默认。 |
| `ui-context-menu`（dsh-web-app） | 新增 | 能力行（提供 `contextMenus` 服务），保留上游默认；被 enabled 的 `dsh-client-ui-*` 停靠条目依赖，禁用会导致 sidebar/chat 等条目 pending（实测复现后保留启用）。 |
| `ui-file-actions`（dsh-web-app） | 新增 | 服务行，保留上游默认。 |
| `ui-file-drag`（dsh-web-app） | 新增 | 能力行（提供 `fileDrag` 服务），保留上游默认；同被停靠条目依赖。 |
| `tools`（dsh-web-app） | 移除 | 上游删除，发行补丁未引用。 |
| `ui-deepseek-model-label-1017`（dsh-web-app） | 移除 | 上游删除，发行补丁未引用。 |

上游 web-frontend 资产哈希变化，`scripts/scan-dsw-vars.mjs` 重新生成官方制品变量表 `dsw-vars.ts`（431 个变量）。

## 验证记录

- 真实 dev profile 验证：`prepare-desktop-dev.mjs` 物化 `.dev/desktop-dsh-runtime-0.2.2-rc.1`；`sync-desktop-dev-package.mjs` 将 10 个 bundled workspace 包同步进模板与 `.dev/desktop-home` 的 `dsh-editor` profile；profile 顶层运行时链接按 52450c6 的 restage 语义重指到新运行时后直接以 `bin.js --profile dsh-editor` 启动——宿主日志无跳过/不兼容警告，Playwright 打开首页（标题 DSH Editor，最近作品/新建作品/打开作品正常渲染），0 pageerror、0 控制台错误（截图 `.dev/upgrade-022-boot.png`，日志 `.dev/upgrade-022-boot.log`）。
- `pnpm typecheck`、`pnpm build`：通过。
- `pnpm test`：首轮 3 项失败（一次 Windows EPERM 重命名、两次 5 秒超时，与 0.2.1 审计记录的环境抖动同类），重跑全部通过。
- `node --test scripts/external-plugins.test.mjs`、`node --test scripts/check-ui-drift.test.mjs`、`node scripts/check-ui-drift.mjs --base 3ac46ab`、`node scripts/check-ui-design.mjs`（21 项）、`scripts/voice-input-patch.spec.mjs`：通过。
- `pnpm test:e2e:composition`、`pnpm test:e2e:core-loop`：通过。
- 禁用 5 个新增上游行的试验版本复现了 5 个停靠条目 pending，据此改为保留上游默认后重验通过。

未通过 / 未运行：

- `pnpm test:e2e:desktop` 及依赖 Electron 窗口的 `settings-ui`、`settings-lifecycle`、`plugins-page`、`official-plugins`：在 Agent 执行环境中 Electron 无法启动（`electron.exe --version` 直接退出码 3，Playwright 报 "Process failed to launch!"）；加 `ELECTRON_DISABLE_SANDBOX=1` 后首启部署遇到 Windows junction `ENOENT` / `ENOTEMPTY`。`deployProfile` 单独运行可正常建立嵌套链接，尚未判定是环境问题还是升级回归，需在普通终端复跑。
- `pnpm pack:desktop` 与 `scripts/verify-desktop-package.mjs`、plugin-matrix、npm 发布渠道验证与真实 `DEEPSEEK_API_KEY` 下的联网搜索（环境无凭据）；发布前补齐。

## 2026-11-14 发布审查补验

目标桌面版本为 `0.5.0`。本轮保留前述升级基线，没有跟随上游更换版本。

首轮标签 `v0.5.0` 的干净环境检查发现设计清单差异，发行未公开。后续修复扫描器以兼容 Windows 缩短的 pnpm 存储目录名，并沿声明依赖排除旧缓存与全局包干扰；核实锁定的 `dsh-web-frontend/dist/assets/index-lh_YM6sT.css` 后，清单只新增此前漏扫的 `--dsw-hovercard-bg`。`v0.5.1` 的 Linux 检查与 macOS 单测通过，Windows 检出 CRLF 导致逐字校验失败；生成文件随后增加 LF 属性和真实 Git 检出回归。发行目标改为 `0.5.2`，保留未公开的失败标签。

- `pnpm install --frozen-lockfile`、全工作区构建与类型检查通过；完整测试 218 个文件、1831 项通过、4 项跳过。新增真实 Cordis 作用域回归，检查搭档 RPC 与回忆工具能实际读取声明的服务。
- 修复工作台与工具入口缺失的服务依赖声明。此前真实宿主的 `bot.check`、`bot.history`、换模型时的 `bot.attach` 会返回 `cannot get property "sessionQuery" without inject`；对象模拟测试没有触发 Cordis 的检查。
- 选段改写请求按作品归属并在填入后消费，避免换作品或换段时重发；补全跟随当前搭档会话模型，文件保存与草稿继续绑定文件会话。
- `e2e/writing-models.mjs` 通过：真实选区改写、换模型自动换段、实际编辑器补全路由、用量、核心插件禁用保护与重启持久化；所有捕获的搭档 RPC 回执成功。模型使用本地确定性测试服务，不代表外部模型联网验收。
- `e2e/desktop.mjs`、`core-loop.mjs`、`compositions.mjs`、`writing-shortcuts.mjs`、`missing-private-plugin.mjs` 通过。布局不变量通过 1440 / 1024 / 760 / 390 四档宽度，并确认主题、字号、设置切换不重建编辑器。
- `plugin-matrix.mjs` 通过 4 个状态、6 次转换；`ai-plugins-standalone.mjs` 在无私有 Editor 包的原生 Web profile 中验证公开插件安装与重启。验收适配了新版首次使用弹窗，压缩包读取兼容 Windows 自带 tar，并为原生包安装隔离存储。
- UI 检查器回归 12 项、增量偏移与设计契约 21 项通过；Markdown 本地文件链接检查无失效链接。
- 本机标准打包遇到 Electron 下载失败；改用本机同版本 Electron 可生成便携包，但 NSIS 自提取步骤未成功。本机结果不替代最终发行产物检查；Windows/macOS 构建、包校验与便携包启动须由本次标签的发布工作流完成后，才可将草稿发行公开。
- 未进行真实 DeepSeek Search API 联网请求；网页搜索沿用上游默认配置与计费边界。

## 0.2.2-rc.5 升级

日期：2026-11-22。目标版本 **0.2.2-rc.5**（npm `next` 通道），起点 0.2.2-rc.1、起点提交 4adfd23。

### 升级范围（rc.5）

- 版本切换由 `node scripts/upgrade-dsh.mjs --to 0.2.2-rc.5 --skip-install` 完成，共改写 52 个文件 137 处版本钉住；未改全局 CLI。
- `pnpm.overrides` 中全部 43 个 `@deepseek-ai/dsh-*` 钉住改为 0.2.2-rc.5；逐包 npm 核实均存在，无 404 删除、无新增钉住。`zod` 钉住与根 devDependency 从 4.4.3 改为 4.6.6（上游 rc.5 `dsh-llm` 精确钉 4.6.6）；`@deepseek-ai/cordis@4.1.0`、`@deepseek-ai/schemastery@3.19.0` 与上游一致保持不变。
- 锁文件：首轮 `pnpm install` 后仍解析出 `@deepseek-ai/dsh-*@0.2.2-rc.1` 快照（与上一轮相同的 dedupe 复用）；删除全部 workspace `node_modules` 重装后归零，`cordis` / `schemastery` / `zod` 各一份。
- `scripts/prepare-desktop-dev.mjs` 物化目标改为 `.dev/desktop-dsh-runtime-0.2.2-rc.5`，`scripts/dsh-cli.mjs` 期望版本 0.2.2-rc.5；`packages/dsh-editor-plugins/README.md` 的宿主版本钉由升级脚本同步改写。
- 安装期间发现 `packages/dsh-editor-workspace-kit` 目录缺失（`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`），自 git 恢复后重装；与升级内容无关。

### 补丁处置（rc.5）

| 补丁 | 处置 | 依据 |
| --- | --- | --- |
| `@deepseek-ai__dsh-web-frontend@0.2.2-rc.5.patch` | 移植，目标资产改名 | Tag 等规则仍是 11px/17px 内联在新哈希资产 `index-CSAdOBx6.css`；补丁把全部两处提升为 12px/18px，意图不变。 |
| `@deepseek-ai__dsh-experimental-client-ui-voice-input@0.2.2-rc.5.patch` | 移植，按新产物重写 hunk | rc.5 的 `lib/client.js` 是压缩产物，旧补丁上下文不可套用；按实际压缩字符串重建，意图不变：`wanted` 状态门控、`wanted && !document.hidden && !capture` 采集条件、effect 依赖加 `wanted`、「测试麦克风 / 停止测试」按钮与中英文案。`scripts/voice-input-patch.spec.mjs` 断言同步改为压缩产物形式并校验安装制品。 |

### 官方升级指南核对（rc.5）

plugin-fast-adapt 的 `run.mjs` 对全部 11 个 `packages/*` 与 `apps/desktop` 扫描（`--from 0.2.2-rc.1 --target 0.2.2-rc.5`），共 402 处命中逐条分诊，全部判定误报或不适用，无代码改动：

- **forge-provider-hosts（约 170 处）**：仓内无 `ctx.forge` / `ForgeProvider` / `dsh-experimental-forge` 使用，命中是 `describe(`、`subscribe(` 等泛词匹配——误报。
- **session-status-package（约 68 处）**：无 `@deepseek-ai/dsh-client-ui-session` 导入、无 `ctx.uiSession.sessionStatus` 读取；`dsh-compat.ts` 的 `sessionStatus` 是自有兼容形状——误报。
- **workspace-write-boundary-follows-root（51 处）**：命中为 spec 中构造 `sandboxPolicy.resolve` 返回值的桩；发行组合无 worktree 会话，profile 未设 `workspaceRoot` / `additionalWritableRoots`——误报。
- **session-retain-conversation-facet（37 处）**：对照已安装制品核实，`dsh-api-session-controller@0.2.2-rc.5` 的 `retain()` 只解构 `{source, signal}`，运行时不含 `facets` / `retainedFacets`——npm 制品未包含该机制，不适用；后续制品带上时按指南补 `facets: { conversation: true }`。
- **deepseek-request-auth（31 处）**：命中为注释与测试夹具（`llm-deepseek` 名字空间键、`hasRunningAccountTasks` RPC），无被移除 helper 的调用——误报。
- **personalized-recommendations-bundle-retired（3 处）**：rc.5 npm 制品仍单独发布 `dsh-personalized-recommendations` 并在其中挂载六个行，web-app 组合未并入；profile 也未引用该 bundle——制品未含此变更，不适用。
- **web-search-deepseek-model-default（7 处）**：命中为 settings 测试夹具里的 `deepseek-account` provider id；编辑器不覆写 `web` 配置，跟随上游新默认（DeepSeek 模型会话走 Messages 搜索按 token 计费，其余走 Search API）——误报，行为变化随上游默认生效。
- **client-module-metadata（6 处）**：自有 `<style data-plugin>` 注入由插件卸载时自行 remove，无 `data-plugin-css` 选择器依赖——不适用。
- **profile-context-overlay-paths（1 处）**：`readProfilePatches('dsh-editor', profile)` 已是 `readProfilePatches(binName, ProfileContext)` 新签名——误报。
- **working-directory-tool-removed（2 处）**、**cordis-loader-entry-validation（1 处）**、**ptc-tool-result-inspection（2 处）**：仓内无 `tool-working-directory` 行、无 `applyEntryPatches` / `EntryTree` 使用，命中的是自有 `tool.output.render` 测试辅助——误报。
- apps/desktop 仅 1 条 medium 命中（`profile.ts` 的 `PEER_PACKAGES` 列表泛词匹配 `dsh-llm`）——误报。

扫描环境说明：各报告内 "tsconfig 假绿" 与冒烟阻断是扫描器在未构建状态解析 workspace paths、无法加载同级 workspace 依赖所致，仓库自身 `pnpm typecheck`、`pnpm build` 通过；`panel-base` 首次扫描因子进程 spawn 未给带空格的 node 路径加引号而失败，改用短路径 `C:\PROGR~1\nodejs\node.exe` 重跑完成。签名差分因无 rc.1 基线跳过，rc.5 签名已留存供下次差分。日志：`.dev/upgrade-025/scan-*.log`。

### 审查补修（rc.5）

评审补查发现的四处遗漏，均已修复：

- **account/watch 流元素形状**：rc.5 的 `dsh-deepseek-account` 把 `watch` / `watchState` 流元素从 `AccountView` 快照改为 `AccountUpdate` 事件（`{ type: 'snapshot' | 'credentials-changed', state: AccountView }`，见制品 `lib/types/types.d.ts`）。`dsh-compat.ts` 的类型与 `settings-models-account.tsx` 的消费循环按新形状解包 `event.state`；`getState()` 仍直接返回快照不变。升级指南扫描未扫出的原因：指南规则按已知破坏性变更模式匹配（`ctx.forge`、`retain` 参数等），deepseek-account 远程流的契约变化没有对应条目，且我方 `watch` 适配层形状与上游同名 API 近似，泛词分诊无法识别，属制品级类型差分才能发现的变化。
- **e2e/official-plugins.mjs**：能力清单断言的 `dsh-office-to-pdf` 已在上游被 `dsh-office-kit` 组合替代，断言改为 `dsh-office-kit` 恰好一条且启用。
- **e2e/settings-lifecycle.mjs**：rc.5 把 `removeOwnedStyles` / `claimStyles` 压成单行，原依赖缩进换行的提取正则失配。改为按函数名定位后花括号配平提取（跳过字符串字面量），并增加显式断言：提取不到或内容不像预期 helper 时直接失败，不再静默跳过。
- **历史文档版本号还原**：升级脚本机械改写把 `docs/redesign/acceptance.md`（验收截图环境）与 `docs/redesign/decision.md`（视觉基准决策）里的历史版本 `0.2.2-rc.1` 改成 rc.5，按 `4adfd23` 原文还原；`scripts/upgrade-dsh.mjs` 的 `SKIP_REWRITE_PREFIXES` 增加 `docs/redesign/`。`docs/` 全量复查确认其余 rc.1→rc.5 改写均为现行钉住版本声明（architecture、ai-plugins-implementation、diagrams、ui-design），保留。

### 上游新增 / 移除行（rc.5）

对比 `dsh-base` 与 `dsh-web-app` 的 cordis.patch.yml（0.2.2-rc.1 → 0.2.2-rc.5）。处置已定并落到 `apps/desktop/resources/profile/cordis.patch.yml`：

| 行 | 所属 | 变化 | 处置 |
| --- | --- | --- | --- |
| `agent-team`（dsh-agent-team，config maxTasks: 256） | dsh-base | 新增 | `disabled: true` —— Editor 不提供子代理和团队协作（ui-subagent 已关），写作搭档不能拿到团队工具 |
| `tool-agent-team`（dsh-tool-agent-team） | dsh-base | 新增 | `disabled: true` —— 同上 |
| `deepseek-account` | dsh-base | 包名 `dsh-deepseek-account-platform` 改为 `dsh-deepseek-account` | 跟随上游（非新增行） |
| `tool-subagent-control` | dsh-base | 新增 `config.interrupt: false` | 跟随上游默认 |
| `web` | dsh-base | 移除 `searchProvider: deepseek-official` 钉 | 跟随上游默认（见指南核对） |
| `web-deepseek-api` | dsh-base | 移除 `apiKeyEnv: DEEPSEEK_API_KEY` | 跟随上游默认 |
| `account-controller`（dsh-api-account-controller） | dsh-web-app | 移除 | 上游删除，profile 未引用 |
| `ui-account-notifications`（dsh-client-ui-account-notifications） | dsh-web-app | 新增 | `disabled: true` —— 官方壳区域的账户通知 UI 由 Editor 外壳接管 |
| `mcp-manager`（dsh-mcp-manager，inject `[credentials]`） | dsh-web-app | 新增 | 跟随上游默认（统一 MCP server 管理，实测 enabled + active） |
| `office-to-pdf`（dsh-office-to-pdf） | dsh-web-app | 移除 | 上游删除，由 office-kit 组合替代 |
| `office-kit`（dsh-office-kit，outputDirectory 指向 dshHomePath） | dsh-web-app | 新增 | 跟随上游默认（资料预览的 Office 文档可能依赖，实测 enabled + active） |
| `workspace-dependencies`（dsh-tool-workspace-dependencies） | dsh-web-app | 新增 | 跟随上游默认（自带 disabled 守卫，无 `DSH_PRIMARY_RUNTIME` 时禁用，实测 disabled） |
| `skill-office`（dsh-skill-office） | dsh-web-app | 新增 | `disabled: true` —— 写作搭档技能面只保留写作相关技能 |
| `ui-agent-team`（dsh-client-ui-agent-team） | dsh-web-app | 新增 | `disabled: true` —— agent team UI，与 agent-team/tool-agent-team 一并关闭 |

`@deepseek-ai/dsh` 依赖：新增 `dsh-cua-bundle`、`dsh-deepseek-chat-import`，移除 `dsh-experimental-agent-team-profile`。`dsh-web-app` 依赖：新增 `dsh-agent-tool-presentation`、`dsh-client-ui-account-notifications`、`dsh-client-ui-agent-team`、`dsh-mcp-manager`、`dsh-office-kit`、`dsh-skill-office`、`dsh-tool-office`、`dsh-tool-workspace-dependencies`；移除 `dsh-office-to-pdf`、`dsh-api-account-controller`（`tool-office` 与 `agent-tool-presentation` 在 `dsh-sdk-app` 组合挂载，未进 web-app 行）。

上游 web-frontend 资产哈希变化，`scripts/scan-dsw-vars.mjs` 重新生成变量表 `dsw-vars.ts`（463 个变量）。

### 验证记录（rc.5）

- `pnpm typecheck`：通过。
- `pnpm build`：通过（各 e2e 前置构建均成功）。
- `pnpm test`：通过，219 个测试文件、1835 项通过、4 项跳过。
- `node --test scripts/external-plugins.test.mjs`：10/10 通过。
- `node --test scripts/check-ui-drift.test.mjs`：12/12 通过。
- `node scripts/check-ui-drift.mjs --base 4adfd23`：无新增字面量违规（1 个改动 UI 文件）。
- `node scripts/check-ui-design.mjs`：21 项通过。
- `scripts/voice-input-patch.spec.mjs`：随 `pnpm test` 2/2 通过。
- `pnpm test:e2e:composition`：通过（4 个组合物化，failures: []）。
- `pnpm test:e2e:core-loop`：通过（failures: []）。
- `pnpm test:e2e:on-demand-plugins`（`e2e/writing-models.mjs --optional-install`）：通过，`"ok":true`，含四个可选公共插件真实 npm 安装、工具即时生效、卸载与重启恢复；输出 `e2e/out/writing-models/1795350958796`。此前一轮清理阶段 `removeBundle` 超时为抖动。
- rc.5 新增行守卫实测（dev profile 真实启动，`/api/pluginManager/listBundles` + `listPlugins`，脚本 `.dev/curation-inspect.mjs`）：`agent-team` / `tool-agent-team` / `ui-agent-team` / `ui-account-notifications` / `skill-office` 均 `enabled:false`；`mcp-manager` 与 `office-kit` `enabled:true` 且 `fiberPhase:'active'`；`workspace-dependencies` 由上游自带守卫 `enabled:false`。宿主 stdout 无 pending 条目、无不兼容警告；composition 与 core-loop e2e 均通过，未出现 ui-context-menu 式的依赖卡 pending。

未运行：

- `pnpm test:e2e:desktop` 及依赖 Electron 窗口的 settings-ui / settings-lifecycle / plugins-page / official-plugins / writing-shortcuts / layout-invariants：本轮未运行，上一轮同环境 Electron 无法启动的记录仍适用（见上文「未通过 / 未运行」）。
- `pnpm pack:desktop`、`scripts/verify-desktop-package.mjs`、plugin-matrix、真实 `DEEPSEEK_API_KEY` 下的联网搜索。
- Electron 窗口渲染冒烟：dev profile 真实启动已由 curation-inspect（web 方式起宿主）与 on-demand e2e 覆盖，Electron 壳本身未跑。
