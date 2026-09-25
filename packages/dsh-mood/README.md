# @klarkxy/dsh-mood

Mood is a default-enabled requirements clarification feature: it intercepts agent requests at the Host `agent/pre-step` boundary and asks before ambiguous work starts.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. The bundle entry starts enabled and remains independently switchable. Mood does not replace native permissions or writing proposal confirmation.

```sh
npm install @klarkxy/dsh-mood
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-mood
```

Enable or disable the feature under **Settings → Plugins**. When enabled, it uses automatic clarification. The chat card uses seat `dsh-editor.chat.events` with `{sessionId, locale}`.

Clear requests do not call `mood.analyze`. Auto mode only asks when a conservative check finds material ambiguity or risk, and asks at most `MAX_QUESTIONS` (3) questions. Clarification waits in the same pre-step, then resumes that intercepted request once.

## Task contract

Each session's clarified requirements are stored as a `TaskContract` (goal, deliverables, scope, constraints, acceptance, assumptions, questions, evidence). The chat card renders the goal, the evidence list, and the clarification questions with their answers, plus three actions: **修订** (amend the goal), **重新分析** (reanalyze the session), and **按原请求重试** (retry the held original request when one is waiting).

The contract carries a `readiness` state: `pending` (待确认), `clear-request` (表述清楚), `user-confirmed` (作者已确认), `disclosed-assumptions` (按已披露假定继续), `cancelled` (已取消，未确认), or `stale` (已过期).

At `agent/pre-step` the contract snapshot is injected into the model context as a bounded user message; it is descriptive context and never replaces file or publish approval.

### Naming

The same feature appears under several names; they are one thing:

| Surface | Name |
| --- | --- |
| Settings → Plugins entry | 需求澄清 |
| Chat seat label | 需求约定 |
| Chat card title | 任务约定 |
| API and contract type | `TaskContract` |

## Host RPC

Channel `/dsh-mood` requires the host authorization policy.

- `status` — settings and, with `sessionId`, the session view (contract, clarification, held and pending flags).
- `contract` — the session's current task contract, or `null`.
- `mode` — persist the clarification mode with compare-and-swap (`{ mode, expectedRevision }`); while the feature is enabled the stored mode is `auto`.
- `manual` — queue a manual analysis for a session.
- `retry` — resume the session's held original request once.
- `edit` — amend the contract goal with compare-and-swap (`{ sessionId, expectedRevision, patch }`).

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm exec vitest run packages/dsh-mood/src
pnpm --filter @klarkxy/dsh-mood build
```

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/LICENSE)

Hosts that bundle this feature usually enable it by default; where the host supports live plugin switching, toggling needs no restart. Standalone DSH must load `@klarkxy/dsh-ai-services` before this package; installation or removal may require a restart when the host asks for one.
