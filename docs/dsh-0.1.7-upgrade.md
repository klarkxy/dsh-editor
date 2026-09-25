# DSH 0.1.7 升级与能力审计

> 本文档为已完成工作的历史留档，仅供查证。

日期：2026-09-22。目标版本为用户确认的 **0.1.7-alpha.1**，不是无后缀稳定版。上游依据为 [官方发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.1) 与该 tag 源码（c36a83ff6bb95e3f82cf79f9be7c724270a8aa61）。后续已升级到 0.1.7-rc.2，见文末补充。

## 升级范围

工作区直接依赖、各插件使用的 DSH 包、开发运行时、桌面打包脚本与锁文件已切到此版本。项目优先解析本地固定的 DSH；显式 DSH_CLI_PATH 仍可覆盖。升级脚本默认只改工作区，修改全局 CLI 需显式传入 --global。本次没有修改全局安装，也没有提交、推送或发布。

升级前工作树已存在的修改保留，初始快照位于本地 .dev/dsh-upgrade-backup。已经运行的旧开发窗口需要退出后重新启动，才能使用新的内置 DSH。

## 破坏性变化与处理

| 变化 | 当前处理 |
| --- | --- |
| settings/register 与 settingsScope 旧接口退场 | 写作和开发设置注册为原生配置 entry；界面通过 configForms 读取、保存并处理写入失败。 |
| 原生配置与用户 patch 写入边界变化 | 生成的基础配置及预设声明放入独立 bundle；用户 cordis.patch.yml 留给原生设置与插件开关。旧 settings.yaml 原件先备份，已迁移的 Editor 字段不再交给原生导入器二次覆盖。 |
| agent-presets 目录不再自动注册 | 现有发布格式在部署和插件生命周期边界转换为官方 agent-preset 声明，保留相对技能路径及延迟表达式，由官方 registry 管理。 |
| Session retain/reference 生命周期 | 打开、切换、取消、卸载均释放对应引用；作品文件会话和当前对话分开保留，避免新建对话时作品退回首页。 |
| 当前会话和待交互状态变化 | Editor 读取自身选择绑定；独立插件读取原生 uiSession.adapter.current。提问与审批读取 sessionStatus.pendingInteraction。 |
| Session V4 来源约束 | 注入消息使用生产者专属 plugin:<id> kind，并同步更新识别器。 |
| 私有 session.models RPC 消失 | 辅助模型选择从原生 Host projection、请求头与默认模型读取；适配器默认推理强度不会被误当成用户显式选择。 |
| 客户端图已支持动态更新 | 移除与启动时静态图比较的旧重启判断；订阅原生加载状态，只对实际失败提示恢复。 |
| pnpm 依赖布局与桌面运行时不一致 | 打包时物化完整依赖闭包，处理依赖版本冲突；开发运行时独立使用版本目录。 |

迁移文件包括 settings.yaml.before-dsh-0.1.7 和 cordis.patch.before-dsh-0.1.7.yml（存在对应旧配置时才生成）。生成配置损坏后的重部署不会覆盖用户 patch；原始备份保留。会话历史的格式升级仍归 DSH 所有，没有新增 Editor 历史存储。

## 重复与冲突结论

| 能力 | 判断 | 保留边界 |
| --- | --- | --- |
| 当前标题与原生自动标题 | 确有功能重叠；共用原生单一 provider 槽位，接管时停用原提供者，卸载时只恢复自己且未被他人修改的变更，避免双跑。 | 保留近期内容、标题格式、语言和用途路由差异。若以后取消这些差异，可直接采用原生标题。 |
| 模型中心与原生模型设置 | 有界面入口重叠，底层未建立第二套凭据或供应商存储。 | 原生负责供应商、凭据、模型目录和会话选择；模型中心增加用途、档位与调用限制。 |
| Editor 插件管理与原生插件机制 | 管理入口相邻。 | Editor 提供市场检查、桌面目录、写作预设与用户提示；启停和客户端加载继续使用原生机制。 |
| Memory／Dream 与 compaction | 都可能生成摘要，但用途不同。 | 前者管理作者可审核的跨会话知识；原生 compaction 负责缩减当前模型上下文，不互相替代。 |
| Recap／检查点与 compaction | 当前不重复执行上下文压缩。 | 回顾保留作者可见的进度记录；不把回顾当成另一套压缩器。 |
| 补全／改写与会话 Agent | 共用模型服务，写入权限不同。 | 辅助结果仍是候选；只有作者接受后才修改正文。升级不扩大其自动写入范围。 |

## 保留的后续改进

共享辅助调用目前有本地用量与结果记录，但还没有统一记录为原生 Session 请求事件；尤其自定义标题没有沿用原生 session/title-llm-request 的完整输入日志。这是日志可追溯性缺口，本次没有新建跨插件事件体系，也不将其宣称为已解决。若要让所有辅助模型输入都能从 Session log 重建，需要另行定义持久化事件、敏感内容与保留范围。

部分插件仍用 snapshotEvents 扫描历史；0.1.7 仍提供此接口，后续可按实际性能需要迁移到 projections。当前没有新增第二套历史权威或后台扫描器。

## 验证与边界

- 全仓类型检查、全仓构建通过；最后的 shell 适配另行通过类型检查与重建。
- 全量 Vitest：264 个文件，1895 项通过、3 项跳过（.dev/dsh-final-tests.log）。
- 核心写作闭环：新建、保存、重开通过（e2e/out/core-loop/report.json）。
- 写作 AI：模型迁移、用途配置、补全／改写候选、作者确认、真实进程重启通过（e2e/out/writing-ai/1790075155096）。
- AI 插件：12 项交互通过，包括标题、Memory／Dream、经验与 Skill、手动回顾、原生提问等待与单次恢复、全部停用后的聊天（e2e/out/ai-plugins/1790077320621）。
- 配置组合：desktop/basic/smart/full 等价、预设部署与开关、Markdown/TXT 保存和搜索、重载通过（e2e/out/composition-desktop/report.json）。
- Electron：首次启动、配置后启动、多窗口、重开及正常关闭通过（.pack/desktop-e2e/report.json）。
- 最终桌面运行时已生成，manifest 的 DSH 版本为 0.1.7-alpha.1；最终 shell 客户端与运行时内两个副本哈希一致（.pack/desktop-runtime/manifest.json，该证据属于 alpha.1 轮次）。
- 独立审查复核配置保留、二次导入、默认推理强度与运行时 bundle；末轮复核当前会话选择、动态加载状态，以及真实原生审批载体的允许、拒绝、身份校验和取消后过期响应。
- 工作树差异检查通过（忽略 Windows CRLF 行尾）。

所有模型交互验收使用隔离目录和本地固定响应服务，验证集成、数据流与生命周期，不代表真实模型质量。没有对用户真实历史执行破坏性迁移，没有生成或发布安装程序；运行时物化与安装包发布是不同证据。升级前的 AI 插件验收记录保留在原实现文档，并已标注旧版本范围。

## 2026-09-25 补充：升级到 0.1.7-rc.2 并解除插件后向限制

目标版本为 **0.1.7-rc.2**（上游 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)），仍不是无后缀稳定版。以上各节的审计结论与验证记录属于 alpha.1 轮次，本节记录 rc.2 轮次的增量。

- 版本切换仍由 `node scripts/upgrade-dsh.mjs --to 0.1.7-rc.2` 完成，工作区 pin、e2e 与打包脚本同步改写；未改全局 CLI，未提交、推送或发布。
- 插件版本边界：各插件 peerDependencies 保留最低宿主版本下限 `>=0.1.7-alpha.1 <0.2.0`——插件依赖的原生接口（配置 entry、Session V4 `plugin:<id>` kind、`sessionStatus.pendingInteraction` 等）从 alpha.1 才存在，下限如实标注接口起点；安装检查器 `inspect.ts` 的 `peerAllows` 由字符串启发式改为真实 semver 比较器求值，`>=0.1.7-alpha.1 <0.2.0` 对宿主 0.1.7-rc.2 正确判定为兼容，不再误拦。`PINNED_CORDIS` 从 4.0.2 更正为实际解析的 4.0.4。
- cordis 从 `^4.0.3` 升到 `^4.0.4`：rc.2 各包的 peer 要求 `~4.0.4`。
- 依赖闭包：rc.2 发布后部分上游包的内部 peer 仍指向上一个预发布版本，pnpm 会在闭包中留下 alpha.1 副本；根 `package.json` 的 overrides 扩展到全部受影响的 `@deepseek-ai/dsh-*` 包（在原 sandbox/invariants/scope/storage 之外新增 25 个），并重新生成锁文件（注意需同时删除 `node_modules/.pnpm/lock.yaml`，否则 pnpm 复用旧解析）。最终锁文件 0.1.7-alpha.1 引用为 0，与 alpha.1 轮次的单一版本闭包一致。
- 增量验证：全仓类型检查通过，无 rc.2 相对 alpha.1 的 API 破坏；全量 Vitest 272 个文件、2023 项通过、3 项跳过；全仓构建通过；`node --test scripts/check-ui-drift.test.mjs` 通过；核心写作闭环 e2e 通过（新建、保存、重开）；AI 插件 e2e 12 项检查通过（e2e/out/ai-plugins/1790307815844，六项独立功能启停、模型中心档位、Memory/Dream、经验与 Skill、Mood 原生提问）。
- playwright 经 overrides 固定在 1.62.1：锁文件重建会让 `^1.62.1` 浮到需要重新下载浏览器的版本，而本机网络下载浏览器二进制失败；固定后与 alpha.1 轮次使用同一浏览器构建。

未重新运行完整桌面打包（pack:desktop）、安装程序发布与组合矩阵 e2e；这些证据仍属于 alpha.1 轮次，发布前需要补齐。
