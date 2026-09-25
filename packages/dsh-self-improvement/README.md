# @klarkxy/dsh-self-improvement

Procedural learning for DeepSeek Harness: what to do, under which conditions, what to avoid and how to check the result. Lessons live in the shared Memory store; Dream — the context observation and consolidation mechanism inside `@klarkxy/dsh-memory` — owns vocabulary, author context and recent activity, while this package only creates procedural `lesson` records.

[简体中文](docs/README.zh-CN.md)

## Standalone DSH Web

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. No application-specific runtime packages are needed. On a standalone DSH Web host, install:

```sh
npm install @klarkxy/dsh-self-improvement
```

Install the public shared service and explicitly enable Memory storage:

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-memory
dsh plugin --profile web add @klarkxy/dsh-self-improvement
```

This plugin never enables Memory or Dream on the user's behalf. Dream may remain off. Review methods and Skill drafts under Settings → Memory → Self-improvement; there is no extra chat panel or separate settings page. The bundle starts enabled and can be switched off independently.

## Evidence and activation

New `lesson` records carry a structured procedure: origin (`instruction` or `observation`), goal, applicability conditions, recommended steps, actions to avoid and verification checks. Exceptions and original evidence are retained. Descriptive corrections are skipped; mixed messages contribute only their method clause. One-off requests, fictional dialogue and quoted documents do not become durable methods.

Explicit human method requirements may become active immediately within their scope. Positive method feedback and correlated tool recoveries remain candidates until accepted. Acceptance means permission to use the method, not independent proof of its quality. Current instructions, task acceptance criteria and permissions always prevail.

A tool recovery requires the same human request, an explicit matching target and changed arguments. The same tool succeeding elsewhere, an unknown target or an unchanged transient retry is insufficient. Even a correlated recovery is an observation, not verified task success. Silence and assistant self-reports are not evidence. Without AI, the fallback only preserves conservative explicit method instructions, never raw error narratives or word definitions.

Host pre-step injection uses native `createUserMessage`, preserves decision flags and inserts at most five active, unexpired, relevant lessons, about 800 tokens including the wrapper. Chinese retrieval is supported. On a continuation request, recent in-scope activity is read before selecting methods, independently of hook registration order. Disabling the plugin or losing Memory during an await stops injection.

Active methods can form a Skill Markdown draft with name/description frontmatter. Preview, acceptance, browser download and revocation remain explicit. No skill is installed automatically; no AGENTS.md or executable script is changed. Download revocation only changes the application record, not files already downloaded. Legacy lessons remain readable without inventing new metadata or validation history.

## API and exports

The package has three entry points:

- `.` — the Cordis plugin (`name`, `inject`, `apply`), the `SelfImprovementEngine` class and the shared constants `CHAT_EVENTS_SLOT` and `SELF_IMPROVEMENT_RPC_CHANNEL`. `apply` provides the engine as `ctx.selfImprovement` and registers the host RPC channel.
- `./contracts` — browser-safe types and constants: the frozen AI/Memory interfaces re-exported from `@klarkxy/dsh-ai-services`, plus `SkillRecord`, `ReviewSnapshot`, `LessonTrigger`, injection bounds and the `/dsh-self-improvement` channel name.
- `./client` — the review UI bundle. It provides the `dshSelfImprovementReview` render service that the Memory settings page embeds as its Self-improvement section.

The host RPC channel is `/dsh-self-improvement` with endpoints `status`, `extract`, `inspect`, `accept`, `reject`, `revoke`, `skill.preview`, `skill.accept`, `skill.reject`, `skill.revoke`, `skill.export`, `skill.exported` and `skill.unexport`.

[Design and limits](../../docs/portable-learning.md) · [Publishing](../PUBLISHING.md) · [License](LICENSE)
