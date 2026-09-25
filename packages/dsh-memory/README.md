# @klarkxy/dsh-memory

Descriptive context for DeepSeek Harness: scoped vocabulary, explicit preferences, project facts, decisions and recent activity. Dream observes human context and consolidates it. The shared store can hold procedural lessons, but Self Improve owns their creation and injection. Novel canon stays in authoritative worldbook files.

[简体中文](docs/README.zh-CN.md)

## Standalone DSH Web

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. On a standalone DSH Web host, install:

```sh
npm install @klarkxy/dsh-memory
```

Load it and the shared service explicitly:

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-memory
```

No application-private packages or Self Improve are required. The bundle starts enabled; merely opening its UI does not call a model. Use Settings → Memory to manage records, prompt injection and the Dream observation/consolidation switch.

## Context, not procedures

`ctx.aiMemory` implements the shared `MemoryService`. New `vocabulary` and `activity` records may carry subject, domain, term/topic key, aliases, host observation time, literal event-time text and activity status. Project scope comes from the native session cwd, never an arbitrary client path. Automatic observation without a cwd is skipped rather than promoted to global.

At turn end, Dream observes original human messages only. A new session contributes its latest message; later batches include at most four new messages, each capped at 2000 characters. Accepted output requires exact quoted evidence from real human events. Pure continuation acknowledgements do not trigger inference. The `memory.observe-context` purpose uses the normal model role and shared budgets.

Activity has a default seven-day freshness bound. Expiry removes it from recall; it does not prove completion. A new explicit update supersedes the previous matching subject/domain/topic while preserving history. Stable vocabulary has no automatic activity expiry. Existing authoritative task records and project documents remain authoritative.

Idle Dream runs after roughly 15 minutes of inactivity, at least 24 hours after the previous attempt, with at least three changes. It never consolidates lessons, crosses kinds or identities, extends source expiry, refreshes observation dates, or confirms candidate sources. Only all-active sources produce active replacements; otherwise the result stays candidate. Old manual records without referenceable evidence are left unchanged rather than assigned invented provenance. Corrections, deletion and lifecycle cancellation invalidate stale results.

Recall contains at most five active records, about 800 tokens including the wrapper. Lessons are omitted. For a continuation request, recent in-scope activity can restore the task context. Candidates, revoked, rejected, deleted, superseded and expired records are not injected. Current instructions and permissions take precedence.

Observation cursors are persisted across restart and deletion. The 512-session cursor bound fails closed for new sessions instead of evicting deletion protection. Disabling Dream stops observation and idle consolidation, not Memory storage or Self Improve. Disabling the plugin preserves stored data.

Existing records remain readable without synthetic metadata. Update the shared service and both learning packages together when testing these new fields; merging source does not publish an npm release.

```sh
pnpm --filter @klarkxy/dsh-memory typecheck
pnpm exec vitest run packages/dsh-memory/src
pnpm --filter @klarkxy/dsh-memory build
```

## API and exports

The package has three entry points:

- `.` — the Cordis plugin (`name`, `inject`, `apply`), the `MemoryRuntime` service class and the shared constants `CHAT_EVENTS_SLOT`, `MEMORY_RPC_CHANNEL`, `defaultSettings` and `projectIdFromCwd`. `apply` provides the runtime as `ctx.aiMemory` and registers the host RPC channel.
- `./contracts` — browser-safe types and constants. `MemoryRecord`, `MemoryService`, `MemoryQuery`, `NewMemoryRecord` and the other shared interfaces are re-exported from the frozen `@klarkxy/dsh-ai-services` contracts; this package adds `MemorySettings`, `DreamPlan`, `MemoryStatus`, the recall/injection bounds and the `/dsh-memory` channel name.
- `./client` — the settings UI bundle loaded by the host web client.

`MemoryRuntime` implements the frozen `MemoryService` surface — `list`, `create`, `update`, `promoteToGlobal`, `remove` and `recall` — and adds settings (`status`/`readStatus`, `updateSettings`), the candidate lifecycle (`accept`, `reject`, `revoke`), manual records (`createManualRecord`), turn hooks (`handlePreStep`, `observeSession`) and the Dream lifecycle (`previewDream`, `runIdleDream`, `applyDream`, `cancelDream`).

The host RPC channel is `/dsh-memory` with endpoints `status`, `settings.update`, `records.list`, `records.create`, `records.update`, `records.remove`, `records.accept`, `records.reject`, `records.revoke` and `dream.run`.

[Design and limits](../../docs/portable-learning.md) · [Publishing](../PUBLISHING.md) · [License](LICENSE)
