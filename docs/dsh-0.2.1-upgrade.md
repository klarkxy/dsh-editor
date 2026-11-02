# DSH 0.2.1 升级审计

日期：2026-11-01。目标版本 **0.2.1-rc.5**，仍不是无后缀稳定版。上一轮升级（0.1.7-rc.2 → 0.2.0-rc.2）的审计见 docs/dsh-0.2.0-upgrade.md。本次同时完成第三方预装清零：发行版不再随包安装任何非 `dsh-editor-*` / 非 DSH 运行时的插件，网页搜索改由 DSH 原生能力承担。

## 升级范围

- 版本切换由 `node scripts/upgrade-dsh.mjs --to 0.2.1-rc.5 --skip-install` 完成，共改写 51 个文件 143 处版本钉住；未改全局 CLI，未提交、推送或发布。
- `scripts/upgrade-dsh.mjs` 的 `SKIP_REWRITE_PREFIXES` 新增 `docs/dsh-0.2.1-upgrade.md`，与两份历史升级审计一起免于后续盲替换。
- 依赖闭包：根 `package.json` 的 `pnpm.overrides` 中既有的全部 `@deepseek-ai/dsh-*` 钉住改为 0.2.1-rc.5；`dsh-client-ui-primitives` 已退出依赖图，从 overrides 中删除；未新增 DSH 包条目。删除 `pnpm-lock.yaml` 后重建，最终锁文件中 0.2.0-rc.2 / 0.1.7 上游快照为零（残留的 `0.1.7` 字符串仅为无关的 `partial-json@0.1.7`）。
- 新增 `zod@4.4.3`：override 钉到上游统一版本，并列入根 devDependencies 让 `auto-install-peers` 的 dedupe 走工作区根解析。上游各包精确钉 zod 4.4.3，本仓 `^4.1.5` 区间会解析出 4.6.7，两套 zod 实例在 `ZodObject` 上互不兼容导致类型检查失败；同时 pi-ai 子图里 `@anthropic-ai/sdk` / `openai` / `@agentclientprotocol/sdk` 的 zod peer 会被自动安装成 4.6.7，桌面运行时依赖复制会因两个副本冲突而报错。钉 4.4.3 后锁文件只剩一份 zod（SDK 的 peer 范围 `^3.25 || ^4.0` 本就满足）。
- `pnpm.patchedDependencies` 的三处补丁见下节；`scripts/dsh-cli.mjs` 的 `EXPECTED_DSH_VERSION`、桌面运行时准备脚本、语音输入包等其余钉住由升级脚本统一改写。

## 补丁处置

0.2.0 时代的三份补丁不盲跨版本：逐个核对 0.2.1-rc.5 制品后再定移植或放弃。

| 补丁 | 处置 | 依据 |
| --- | --- | --- |
| `@deepseek-ai__dsh-client-ui-plugin-manager@0.2.1-rc.5.patch` | 移植，意图不变 | 上游仍是 "Components"/「包含的组件」、裸 `<section>`、行区不带包名；补丁改为「Advanced components / 高级组件」、`<details>` 折叠区（失败行或含元数据错误时默认展开）并显示包名。`scripts/plugin-manager-patch.spec.mjs` 在已安装制品上验证全部断言。 |
| `@deepseek-ai__dsh-web-frontend@0.2.1-rc.5.patch` | 移植，目标资产改名 | Tag 字号仍是 11px/17px 内联在新哈希资产 `index-BNyAYEM7.css`；补丁提升为 12px/18px。 |
| `@deepseek-ai__dsh-client-ui-primitives@0.2.0-rc.2.patch` | 删除，不再移植 | primitives 包不再独立出现在依赖图中：0.2.1-rc.5 里 web-frontend 把 primitives 内联进自家资产，同一 Tag 规则由 web-frontend 补丁覆盖，`patchedDependencies` 不再需要这条钉住。 |
| `@deepseek-ai__dsh-experimental-client-ui-voice-input@0.2.1-rc.5.patch` | 新增 | 上游 0.2.1 的 `MicrophonePicker` 在挂载时即 `getUserMedia` 做电平预览，与「查看准备页不请求麦克风」的产品承诺冲突。补丁把采集收敛到显式点击：新增 `wanted` 状态门控 `acquire()`，设备行增加「测试麦克风 / 停止测试」按钮（沿用插件自身 i18n 与 `inlineAction` 样式，无新增设计系统）；第二次点击、切换设备、离开页面均释放。`scripts/voice-input-patch.spec.mjs` 校验安装制品。 |

## 官方升级指南核对

对照缓存的上游升级指南 `v0.2.1-*` 逐项检查。只有 working-directory 一项需要改代码，其余均无需改动：

- **working-directory（alpha.1）**：上游移除提示词变量 `{{cwd}}`，未解析的 `{{cwd}}` 会在模型请求前失败；会话当前目录改由 working-directory 服务作为必需的用户上下文提供。五个自有预设的 persona prefix 原本写有「当前作品目录是 {{cwd}}」，已改为不含变量的表述，作品目录仍由该服务提供给模型。静态扫描没有覆盖到 YAML 中的这个变量，问题由真实模型走查发现（见验证记录）。

- **tool-executor-plugins（rc.2）**：工具执行需要启用的 `tool-executor-native` 行；上游 `dsh-base` 已在宿主级挂载该服务，五个写作预设 scope 内的工具调用（含 `writing_propose`）经 core-loop e2e 验证可执行。
- **session-store-writes（rc.2）**：`packages/dsh-editor-shell/src/client/chat-conversation-controls.ts`、`ui-workspace.ts` 中的 `ctx.sessions.create` 是客户端 API，不在受影响 Host API 之列。
- **context-menu-services（rc.2）**：GUI 插件的 contextMenus / fileActions 由官方行注入；发行补丁未关闭其提供者（`official-layout` 的 `slots.provideRoot` 链路完整）。
- **install-over-installed（alpha.2）**：对已安装包再次 `installBundle` 在 HMR 下返回 `already-installed` 错误码。`packages/dsh-editor-plugins/src/native-tools.ts` 只包装官方 `installBundle` 并原样转发其回执，不按错误码分支；安装与更新仍由官方插件管理器执行（官方「更新」先移除再安装），无需改动。
- **plugin-engines-dsh（alpha.3）**：`IncompatiblePlugin.peers` 改名 `requirements`；本仓不读取 `IncompatiblePlugin` / `PluginCompatibility`，自有包也未声明 `engines.dsh`，无需改动。
- **session-title-adapters（alpha.1）**：`dsh-manuscript` 的 `llm-bridge.ts` 使用 `llm.prepareCall` 的推理档位排序与适配方式与新约定一致。

## 上游新行的处置

`dsh-web-app` / `dsh-base` 0.2.0-rc.2 → 0.2.1-rc.5 的新行逐项处置：

- `schedule`、`ui-schedule`、`ui-secret-mask`、`ui-deepseek-model-label-1017`：保持上游默认（`ui-schedule` 沿用既有关闭约定，日程相关工具不进写作发行版）。
- `harness-dev-context`：开发期 prompt 上下文，不属于写作应用，发行补丁新增 `disabled: true`。
- `entry-customization`：官方区域「更多」菜单注入，发行补丁新增 `disabled: true`，与其他官方界面件一致。
- `remote-access`、`tool-working-directory`、`working-directory`、`web-deepseek-api`（base 新行）：上游默认保留；`skill-badge` 与旧 `tool-ralph` 行随上游移除，无需处置。
- 官方制品扫描变量表 `dsw-vars.ts` 随新资产重新生成（421 个，`--dsw-font-sm-13` 移除）。

## 第三方预装清零与原生网页搜索

- `apps/desktop/resources/external-plugins.json` 钉住集合清空为 `{ "schema": 1, "packages": {} }`；`@klarkxy/dsh-web-search-manager` 移出根 devDependencies；`scripts/external-plugins.mjs` 的通用外部插件钉住机制保留，空集合照常通过校验。
- `apps/desktop/resources/compositions/desktop.json` 移除 `web-search` feature 与管理器的 preinstalled 声明（该 feature 只由管理器 manifest 声明）。
- `apps/desktop/resources/profile/package.json` 移除模板残留的 `@klarkxy/dsh-zhihu`；`scripts/plugin-manifest.mjs` 的 `STABLE_PACKAGE_ORDER` 同步移除。
- `apps/desktop/src/distribution-contract.json` 为 `web-search-manager` 登记 `optionalPackage`（与 zhihu 同样处理：未自装用户的过期覆盖被修剪，市场可再安装），并去掉 `web` / `web-search-deepseek` / `web-fetch-http` 上的 `restore: true`（原守卫随管理器移除而失效）。
- `apps/desktop/resources/profile/cordis.patch.yml`：删除 `web` 行的 `config: {}` 覆盖（它会抹掉上游 `searchProvider: deepseek-official` 与 `fetchProvider: http`），删除 `web-search-deepseek`、`web-fetch-http` 的 `disabled` 行；`tool-web` 保持宿主级 `disabled: true`，与上游 web-app 一致，由预设 scope 按需挂载。
- 五个自有写作预设（`dsh-editor`、`dsh-editor-writing`、`dsh-editor-novel`、`dsh-editor-article`、`dsh-editor-technical`）各加入一条预设级 `tool-web` 行：`@deepseek-ai/dsh-tool-web`，`fetch: true`，`searchTimeoutMs: 60000`，与上游预设写法一致。搜索走官方 DeepSeek 后端，凭据为 `DEEPSEEK_API_KEY`。
- 预设改写器 `scripts/configure-web-search.mjs` 及其 spec、`scripts/desktop-compositions.mjs` 中的调用点删除。
- `@deepseek-ai/dsh-experimental-voice-input-bundle`、`dsh-base`、`dsh-web-app`、`dsh-editor-cards`、`dsh-editor-memory-panel` 及全部 `dsh-editor-*` 包保留；`@klarkxy/dsh-plugin-kit` 作为库依赖保留。

## 验证记录

- `pnpm typecheck`：全仓通过（修复两处：zod 双版本冲突；`dsh-client-store` 退出依赖图后 `Shortcuts['catalog']` 类型变为 `unknown`，`official-surfaces.tsx` 改用本地结构类型）。
- `pnpm test`：Vitest 215 个文件、1915 项、4 项跳过；首轮 3 个文件失败——`design-system.spec.ts` 因上游制品变量表过期（重新生成 `dsw-vars.ts` 后通过），`windows-update-helper.spec.ts` 与 `proposal-ops.spec.ts` 各一次 Windows 临时文件竞态（ENOENT / EBUSY + 超时），单文件重跑全部通过，判定为环境抖动而非升级回归。
- `pnpm build`：全仓构建通过。
- `node --test scripts/external-plugins.test.mjs`：10 项通过（末项断言改为钉住集合为空且无 `@klarkxy` 根依赖）。
- `node --test scripts/check-ui-drift.test.mjs`：12 项通过；`node scripts/check-ui-drift.mjs --base 6186418`：1 个 UI 文件无新增字面量违规；`node scripts/check-ui-design.mjs`：21 项通过。
- `pnpm test:e2e:desktop`：通过（四个窗口阶段全部断言通过）。DSH 0.2.1 的 client-connection 新增软握手诊断 `[connection] generation is still not ready after 3000ms`，在无凭据开发环境的 Electron 冷启动里会撞上 3 秒诊断阈值（硬超时 `generationReadyTimeoutMs` 另算），e2e 把它与既有 Electron Security Warning 一样列为可接受的开发警告。
- `pnpm test:e2e:core-loop`：通过（预设 scope 内 `writing_propose` 等工具调用正常执行，印证 tool-executor-plugins 指南项）。
- `pnpm test:e2e:composition`：通过（含全部新断言：能力集无 web-search、无第三方预装、五个预设各挂原生 tool-web）。首轮 `page.goto` 15 秒超时、次轮 `.tree` 30 秒超时，第三次通过，判定为本机时序抖动。
- `node e2e/settings-ui.mjs`：通过（56 页、12 项交互、0 布局/无障碍问题）。`node e2e/settings-lifecycle.mjs`：通过（上游 `claimStyles(id)` 改签名 `claimStyles(id, before)`，验收脚本按新契约传入工厂前快照后断言不变）。
- `node e2e/plugins-page.mjs`、`pnpm test:e2e:writing-shortcuts`、`pnpm test:e2e:missing-private`：均通过。
- `node e2e/official-plugins.mjs`：12 项检查通过（含语音补丁验收：准备页访问零麦克风请求，点「测试麦克风」恰好一次请求，再点停止，关/开 bundle 不新增请求）；仅剩 `preview.docx` 的 Office→PDF 转换失败，为本机缺少可用 Office 转换器的既有环境问题（见 docs/redesign/acceptance.md 已知失败 #1），非升级回归。
- `pnpm pack:desktop`：通过。本机 electron 缓存中 `electron-v42.11.8-win32-x64.zip` 为损坏的重复写入产物（280MB、bsdtar 无法解析），曾导致 electron-builder 报 "zip: not a valid zip file"；改名 `.corrupt` 后重新下载 149MB 官方包即恢复。`scripts/verify-desktop-package.mjs` 通过（SHA-256 清单一致、runtimeSmoke 通过）。
- `pnpm test:e2e:portable`：通过。此前「portable wrapper exited before its window was ready (9)」的根因已定位：VS Code 集成终端注入的 `ELECTRON_RUN_AS_NODE=1` 随 `portableEnv` 传入，打包后的 Electron 以纯 Node 运行、拒绝 `--remote-debugging-port` 直接退出 9；`e2e/portable.mjs` 现与其他启动器一样剥掉该变量。acceptance.md 归因「旧制品」不正确——根因是测试进程环境，不是产物。
- 真实模型走查（本机 OpenAI 兼容网关，模型 MiniMax-M3.1-Flash，仅在隔离 home 内配置、不进任何产品默认值；面向用户的推荐仍是 DeepSeek 官方）：发现并修复一个真回归——五个自有预设的 persona prefix 使用 `{{cwd}}`，而 0.2.1 的 `deployment:persona-prefix` 注册变量只有 `provider / model / editor_global_preferences / editor_project_rules`，导致每一轮对话都以 UNKNOWN 变量错误结束；已改为中性表述并加 `desktop-profile.spec.ts` 断言。走查证据：真实回复到达；`writing_propose` 正常产出待确认提案卡；`web_fetch` 对 example.com 返回 HTTP 200（证明预设 scope 内原生 tool-web 已挂载）；`web_search` 在无 `DEEPSEEK_API_KEY` 下明确报错「DeepSeek search has no API key」并由模型优雅降级（不挂起）；补全幽灵字须 Tab 接受；键盘输入中文落盘。脚本与产物在 `e2e/out/real-machine-0.2.1/`。
- 锁文件检查：`@deepseek-ai/dsh-*` 的 0.2.0-rc.2 / 0.1.7 快照为 0（仅无关的 `partial-json@0.1.7`）。

未运行：plugin-matrix、npm 发布渠道验证与真实 `DEEPSEEK_API_KEY` 下的联网搜索（环境无凭据）；发布前按需补齐。
