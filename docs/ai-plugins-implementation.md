# Optional AI plugins

This implementation follows the accepted six-plugin design: current title, requirements clarification (Mood), recap and checkpoints, Memory with Dream, self-improvement, and Model Center. `@klarkxy/dsh-ai-services` is their shared mechanism, not a seventh user feature.

## Fixed boundaries

- DSH owns agents, sessions, model/provider catalogs, credentials, questions, approvals, and history. Keep the pinned DSH version `0.1.7-alpha.1`.
- All six feature bundle entries are enabled when installed and remain independently switchable. Loading their UI does not start inference. Mood, current title, Recap, and self-improvement have no extra settings pages: enable them under Settings → Plugins and they use fixed automatic defaults (Mood auto, title locale auto, Recap cards/checkpoints/semantic/idle-return on). Memory and web search still have settings pages. Dream still defaults on with an independent Memory switch. The shared service is inert until a feature explicitly calls it.
- The shared package owns model roles/purpose routing, bounded auxiliary calls, cancellation, usage receipts, and shared types. It does not own a parallel task engine, chat history, credential store, or generic artifact database.
- Normal/weak/strong are configured aliases; session-following is a distinct target. Unconfigured weak/strong can inherit normal; an explicitly broken route fails visibly without silently changing providers. Manuscript completion and rewrite now use the same service with dedicated purposes; their existing settings UI edits the central policy.
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

桌面组合已预装并启用六个功能。在「设置 → 插件」中可分别停用。

1. 在「设置 → 模型 → 模型配置」为对话、补全和改写选择模型。默认／省资源／高质量预设在「高级设置」；并发、超时和输入输出上限在「运行设置」。
2. 当前标题、需求澄清、回顾默认可用；不需要的功能可在插件页关闭。启用后按固定自动行为运行，不再提供单独设置页。记忆仍可在「设置 → 记忆」管理条目、注入和闲时整理；闲时等待约 15 分钟，不可调。
3. 经验学习依赖记忆；两者在桌面组合中默认同时可用。明确方法要求可直接生效，结果观察保留为候选；随时可在「设置 → 记忆」的自我改进条目撤回；Skill 草稿可以预览、采纳、下载和撤回，不会自动改写政策文件或执行脚本。

DSH 0.1.7-alpha.1 支持客户端模块图动态更新。插件设置订阅原生加载状态；正常启停无需重启，仅实际加载失败时提示保存工作后重试。安装、卸载或宿主明确返回需要重启的变更，仍按提示处理。关闭后的后台任务和注入立即取消。

独立安装需要先显式加载共享服务 bundle，再安装所需功能；Self-improvement 还需要单独加载并启用 Memory。各包 README 给出对应命令。新增包由主线的 npm 发布流程交付；旧仓库归档另行处理。

## Local verification

`pnpm typecheck`、`pnpm test`、`pnpm build` 检查源代码与构建；`pnpm pack:plugins` 检查本地 tarball。`node e2e/ai-plugins.mjs` 在隔离目录和真实 DSH 宿主中操作页面，模型请求由本地固定响应服务提供。它验证集成与生命周期，不代表真实模型的生成质量。

Editor 自有 profile 使用原生 patchReload: startup。插件管理器保存用户开关后，通过原生 Loader 应用一次；不再让文件监听器并发重放旧开关快照。直接编辑 patch 文件需重启生效，供应商等设置仍使用原有服务接口。

## 独立 web 验收

原生“设置”页保留 Memory 的管理入口，并从宿主的会话选择绑定读取当前选择。教训与 Skill 草稿在 Memory 页面管理；Mood、当前标题、Recap 和自我改进只通过插件开关控制。模型中心在 Editor 内复用供应商界面；独立 web 的供应商编辑仍由原生“模型”页负责。

运行 `pnpm test:e2e:ai-plugins:standalone` 会把七个当前 tarball 安装到全新隔离 profile；本地包依赖只在该测试 profile 内绑定到对应 tarball，不修改全局包管理器配置。手动安装到原生 web 后功能默认启用；如需停用，可在插件设置中关闭后重启。

原生提问接收器在 Editor 中保持加载，问题由原有写作卡片呈现。需求确认、权限审批和正文修改提案各走原有边界。

长期存储在每次写入前验证容量；只能清理无引用的已结束整理历史与删除标记，不自动删除作者记录或待审核候选。达到容量时保留原状态并返回明确错误。

## 升级前验证（2026-09-22，DSH 0.1.5-rc.2）

下面记录保留原验证范围；0.1.7-alpha.1 的现行结果见 [升级审计](dsh-0.1.7-upgrade.md)。

- 全仓类型检查与构建通过；全量自动化为 261 个测试文件、1857 项通过、3 项跳过；写作调用统一的增量验收见下方。
- 独立审查完成，已报告问题均修复并复核。
- 真实 DSH 宿主及 Chromium 流程覆盖：六插件默认启用且仅加载界面不触发推理、模型配置及原生恢复、标题生成、双窗口设置冲突、Memory/Dream、经验采纳与 Skill 预览/下载/撤回、Mood 等待回答后恢复一次、全部停用后正常聊天。
- 原生 web 的七包独立安装、设置管理、标题接管与记忆重启回读通过。
- 上述模型请求使用本地固定响应服务，验证的是集成与生命周期；没有把它作为真实模型生成质量或正式发布证明。

运行记录由两个验收脚本写入 `e2e/out/ai-plugins` 与 `e2e/out/ai-standalone`。本地 tarball、校验和及源码状态清单在 `.pack`。本轮未提交、推送、发布，也未归档旧插件仓库。

## 补全与改写统一管理

正文行内补全、选区改写现已依赖 ai-services，分别使用 manuscript.completion、manuscript.rewrite 用途，默认跟随当前会话。模型中心开启后，它们与对话模型一起显示在「常用功能」，可跟随预设、直接选择模型或跟随会话；关闭模型中心时，原来的「补全模型／改写模型」仍直接编辑同一份中央策略。

旧写作模型配置在 Editor 启动时仅导入一次，已有中央用途优先。迁移标记与策略一起保存；删除中央覆盖并重启不会恢复旧值。迁移失败会保留原数据并阻止这两个写作调用，可在模型设置重新选择后重载。旧字段留作回退数据，后续中央修改不会同步给旧版本。

两项调用共用中央并发、输入、输出、超时、取消和用量记录。补全最多 240 字符、改写最多 1200 字符；达到上限就终止生成。结果仍是候选，需作者接受才改变正文。模型中心关闭不会停用共享服务，也不会自动启用其他 AI 插件。

运行 pnpm test:e2e:writing-ai-services 可验证旧配置迁移、模型中心关闭时的配置、两项正式 RPC 调用与用量、正文不被候选直接改写、模型中心用途展示和真实进程重启。使用本地固定响应，未验证真实模型生成质量。

写作统一最终验收：261 个测试文件，1857 项通过、3 项跳过；类型检查、构建和 11 个公开 tarball 校验通过。写作宿主流程记录为 e2e/out/writing-ai/1790017489601/report.json；默认启用后的桌面兼容回归记录为 e2e/out/ai-plugins/1790038923396/report.json，独立安装记录为 e2e/out/ai-standalone/1790039206241/report.json，均 ok=true。
