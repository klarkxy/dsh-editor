# AI 插件与写作模型

当前桌面发行组合只预装网页搜索。当前标题、需求记录、会话纪要和知乎改为通过插件市场按需安装。版本以 [外部插件清单](../apps/desktop/resources/external-plugins.json) 为准，源码与公开插件独立测试由 dsh-plugins 维护。安装后的制品离线随包交付，应用启动不下载插件。

AI Services、Model Center、Memory、Self-improvement 与 Fusion 已移除。人物卡、私有写作记忆面板和作者文件保留；旧公共插件的持久化数据不删除。共享库 @klarkxy/dsh-plugin-kit 提供原生调用辅助与合同，不是需要启用的插件服务。

## 补全与改写

新对话、正文补全、选区改写分别使用现有写作偏好的 chatModel、completionModel、rewriteModel，在「设置 → 模型」管理。新对话未指定时跟随原生默认模型；补全与改写未指定时先跟随当前会话的模型选择，再使用原生默认模型。公共插件在自己的原生配置页保存模型选择。没有新的全局用途路由、模型档位或政策存储。

稿纸直接调用固定版本 DSH 0.2.0-rc.2 的 LLM。请求仍需经过工作区权限检查，候选不会自动改写正文；作者接受后才应用。取消、插件停用和同一会话同一用途的新请求会丢弃旧结果；超时、模型失败、工具调用和未完成输出不返回半段候选。补全最多 240 字符、改写最多 1200 字符，写作请求只尝试一次。用量保留在稿纸 usage.summary 与请求日志中，不估算未返回的 token。

## 验证边界

pnpm typecheck、pnpm test、pnpm build 检查源码与构建；pnpm pack:plugins 检查当前 tarball。模型设置夹具和隔离宿主测试使用本地固定响应，验证模型选择、保存、调用、启停和候选完整性；不能作为真实模型生成质量的证明。

## 历史实现与验收

以下为退役前的六插件与共享模型服务设计记录，不适用于当前运行时。历史测试数量、运行结果和发布交接仅对应记载的旧版本。


This implementation follows the accepted six-plugin design: current title, requirements clarification (Mood), recap and checkpoints, Memory with Dream, self-improvement, and Model Center. `@klarkxy/dsh-ai-services` is their shared mechanism, not a seventh user feature.

## Fixed boundaries

- DSH owns agents, sessions, model/provider catalogs, credentials, questions, approvals, and history. Keep the pinned DSH version `0.2.0-rc.2`.
- The portable design contains six feature bundles. In Editor, current title, Mood, Recap, Memory and self-improvement remain independently switchable; the existing Model Center service is adopted as the essential built-in model configuration carrier. Loading their UI does not start inference. Mood, current title, Recap, and self-improvement have no extra settings pages: enable them under Plugins → Installed and Market and they use fixed automatic defaults (Mood auto, title locale auto, Recap cards/checkpoints/semantic/idle-return on). Memory and web search have configuration views in the Plugins page. Dream still defaults on with an independent Memory switch. The shared service is inert until a feature explicitly calls it.
- The shared package owns model roles/purpose routing, bounded auxiliary calls, cancellation, usage receipts, and shared types. It does not own a parallel task engine, chat history, credential store, or generic artifact database.
- Normal/weak/strong are configured aliases; session-following is a distinct target. Unconfigured weak/strong can inherit normal; an explicitly broken route fails visibly without silently changing providers. Manuscript completion and rewrite keep dedicated purposes in the same policy; their settings UI edits that policy, while generation calls the pinned official LLM directly.
- Feature packages own their typed records. Memory is the shared record store for descriptive context and procedural lessons; current instructions and authoritative project documents take precedence. Maintenance remains auditable and reversible. Novel 正文与大纲 remain author-confirmed through proposals, while AGENTS.md、世界书、人物卡 are agent-maintained via direct writes. Rules still come only from the author's explicit statements.
- Self-improvement requires an explicitly enabled Memory service; enabling it must not enable Memory or Dream. Explicit human method requirements may take effect directly; outcome observations stay candidates until accepted. Vocabulary and recent activity belong to Dream. See [portable learning](portable-learning.md). Skill proposals can be previewed, accepted/exported and revoked from the same Memory compact entry without writing executable or policy files automatically.
- Every asynchronous publication checks session/source identity, input version and activation generation. Disabling cancels work and rejects late results. Data survives disable/uninstall.
- Mood runs at the Host pre-step boundary. Clarification distinguishes pending, answered, skipped, cancelled and stale; it resumes the same intercepted request once. Requirements confirmation never substitutes for file or publication approval.
- Recap display is not model context. Checkpoints have their own lineage and bounded context channel. Cards do not fabricate tool calls or human messages.
- Dream works on bounded snapshots and uses revision checks. Idle consolidation defaults on: it runs only while the project is idle for about 15 minutes, at least 24 hours after the last run, with at least 3 new items, at most once a day, and only all-active sources produce active replacements; candidate sources stay candidate. Context observation is a separate bounded turn-end pass controlled by the same Dream switch. The idle wait is a fixed default. Corrections/deletions win over in-flight consolidation; expired plans do not become completed facts.
- Public packages cannot depend on private Editor runtime packages. Editor provides narrow optional UI seats; native provider APIs remain authoritative.

## Acceptance

Verify the default-enabled state and each feature enabled/disabled/enabled again; loading the surfaces does not infer, and disabled features add no inference or context injection; stale results are rejected; storage failure preserves previous state; role/session/explicit model selection, native approval boundaries, cross-plugin source filtering, clean npm tarball imports/installation, and usable UI flows all remain intact. Report automated, UI, packaging and live-model evidence separately.

The npm packages are published from this repository's main branch after compatibility checks. Archiving the former repository remains separate.

## 使用

桌面组合只预装网页搜索。知乎、当前标题、需求记录和会话纪要改为在「插件 → 发现插件」复制规格，由官方「添加插件」按需安装；人物卡与写作记忆面板随包提供，默认关闭，可在「设置 → 插件 → 记忆维护」开启。Self-improvement 与 Fusion 已退役，其历史数据不删除。模型配置为必需内置模块；归属与升级边界见[内置插件与设置](builtin-plugins.md)。

1. 在「设置 → 模型」为对话、补全和改写选择模型；供应商支持时可为每个选择指定思考强度。取消、超时与输出长度是固定边界，不在设置中调整。
2. 知乎、当前标题、需求记录和会话纪要按需安装后默认可用；不需要的功能可在插件页关闭，停用不删除其数据。写作记忆面板开启后，经侧栏工具项或命令面板查看搭档的维护历史，写入需作者确认、可撤销。
3. 规则类内容只来自作者的明确表述，不从正文推断。作者明确的维护要求由搭档记录到 AGENTS.md、人物卡或世界书，均以待确认提案呈现，作者确认后才落盘。

DSH 0.2.0-rc.2 支持客户端模块图动态更新。插件设置订阅原生加载状态；正常启停无需重启，仅实际加载失败时提示保存工作后重试。安装、卸载或宿主明确返回需要重启的变更，仍按提示处理。关闭后的后台任务和注入立即取消。

公共插件的安装规格在「插件 → 发现插件」复制，粘贴到官方「添加插件」执行；源码与发布由 dsh-plugins 仓库维护，本仓库只维持发行组合与离线制品清单。

## Local verification

`pnpm typecheck`、`pnpm test`、`pnpm build` 检查源代码与构建；`pnpm pack:plugins` 检查本地 tarball。`node e2e/writing-models.mjs` 在隔离目录和真实 DSH 宿主中操作页面，模型请求由本地固定响应服务提供。它验证集成与生命周期，不代表真实模型的生成质量。

Editor 自有 profile 使用原生 patchReload: startup。插件管理器保存用户开关后，通过原生 Loader 应用一次；不再让文件监听器并发重放旧开关快照。直接编辑 patch 文件需重启生效，供应商等设置仍使用原有服务接口。

## 独立 web 验收

独立 DSH web 只随包交付网页搜索管理器一个公共包；安装后其配置由原生设置承载。Editor 的模型与供应商始终在原生「模型」设置管理，对话、补全与改写的模型选择保存在写作偏好；公共插件各自保存自己的模型选择。

运行 `pnpm test:e2e:ai-plugins:standalone` 会把当前 tarball（网页搜索管理器）安装到全新隔离 profile；本地包依赖只在该测试 profile 内绑定到对应 tarball，不修改全局包管理器配置。手动安装到原生 web 后功能默认启用；如需停用，可在插件设置中关闭后重启。

原生提问接收器在 Editor 中保持加载，问题由原有写作卡片呈现。需求确认、权限审批和正文修改提案各走原有边界。

长期存储在每次写入前验证容量；只能清理无引用的已结束整理历史与删除标记，不自动删除作者记录或待审核候选。达到容量时保留原状态并返回明确错误。

## 升级前验证（2026-09-22，DSH 0.1.5-rc.2）

下面记录保留原验证范围；0.2.0-rc.2 的现行结果见 [升级审计](dsh-0.1.7-upgrade.md)。

- 全仓类型检查与构建通过；全量自动化为 261 个测试文件、1857 项通过、3 项跳过；写作调用统一的增量验收见下方。
- 独立审查完成，已报告问题均修复并复核。
- 真实 DSH 宿主及 Chromium 流程覆盖：桌面五项可选插件与必需模型服务默认启用，且仅加载界面不触发推理、模型配置及原生恢复、标题生成、双窗口设置冲突、Memory/Dream、经验采纳与 Skill 预览/下载/撤回、Mood 等待回答后恢复一次、全部停用后正常聊天。
- 原生 web 的七包独立安装、设置管理、标题接管与记忆重启回读通过。
- 上述模型请求使用本地固定响应服务，验证的是集成与生命周期；没有把它作为真实模型生成质量或正式发布证明。

运行记录由两个验收脚本写入 `e2e/out/ai-plugins` 与 `e2e/out/ai-standalone`。本地 tarball、校验和及源码状态清单在 `.pack`。本轮未提交、推送、发布，也未归档旧插件仓库。

## 补全与改写统一管理

正文行内补全、选区改写分别使用 `manuscript.completion`、`manuscript.rewrite` 用途，默认使用快速档与对话档。模型策略仍由 ai-services 解析，生成直接调用固定版本的官方 `ctx.llm.stream`。这三项始终在 Editor「设置 → 模型」中配置，可跟随档位、直接选择模型或跟随会话；插件页只编辑其他已注册的插件用途。

旧写作模型配置在 Editor 启动时仅导入一次，已有中央用途优先。迁移标记与策略一起保存；删除中央覆盖并重启不会恢复旧值。迁移失败会保留原数据并阻止这两个写作调用，可在模型设置重新选择后重载。旧字段留作回退数据，后续中央修改不会同步给旧版本。

两项调用在同一写作插件实例内按供应商共用并发额度，读取中央策略的并发、输入、输出与超时上限。写作额度与其他辅助调用的额度独立计数，因此并发设置不再是两类请求合计的总上限。写作只尝试一次，辅助调用的 `maxAttempts` 不控制写作重试。

写作用量进入稿纸原有的 `usage.summary` 日统计与请求日志，不再生成 ai-services 的写作用途回执。补全最多 240 字符、改写最多 1200 字符，达到上限就停止生成；若供应商尚未返回用量，提前停止的调用可能没有统计记录。取消、停用或同一会话同一用途的新请求会作废旧候选；超时与模型失败不会返回半段文本。结果仍需作者接受才改变正文。模型配置服务为必需载体，不会自动启用其他 AI 功能。

运行 `pnpm test:e2e:writing-models` 可验证内置设置的配置、两项正式 RPC 调用、原生用量记录、候选不直接改写正文、内置用途与插件用途分开配置和真实进程重启；旧配置迁移需设置 `RETIREMENT_LEGACY_FIXTURE=1` 后运行同一脚本。`pnpm test:e2e:writing-routes` 单独验证模型切换、思考强度兼容、保存冲突、连接切换与卸载后的迟到响应。宿主验收使用本地固定响应，未验证真实模型生成质量。

历史验收（2026-09-21，迁移前的共享调用路径）：261 个测试文件，1857 项通过、3 项跳过；类型检查、构建和 11 个公开 tarball 校验通过。写作宿主流程记录为 e2e/out/writing-ai/1790017489601/report.json；默认启用后的桌面兼容回归记录为 e2e/out/ai-plugins/1790038923396/report.json，独立安装记录为 e2e/out/ai-standalone/1790039206241/report.json，均 ok=true。
