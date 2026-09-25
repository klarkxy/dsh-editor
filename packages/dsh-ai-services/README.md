# @klarkxy/dsh-ai-services

Shared Cordis service for model-role routing, bounded auxiliary calls, cancellation, and usage receipts. It is a supporting service, not a user-facing feature. Loading it does not start inference.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. The host must provide `llm`, `storageDomain`, `connection`, `webServer`, `agents`, `sessionProjections`, and `agentDefaultModel`.

```sh
npm install @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-ai-services
```

This package is a locked core service of the host. Feature plugins call `ctx.aiServices.activate(plugin)` when they need a model; this package never calls the model by itself.

## Routing

Roles `weak`, `normal`, `strong`, and `fantasy` represent the Quick, Chat, Thinking, and Fantasy tiers: Quick for cheap latency-sensitive auxiliary calls, Chat as the everyday default, Thinking for heavier reasoning, and Fantasy as the highest-cost creative tier. They can bind models from any provider. Built-in plugins never default to Fantasy; it is reserved for explicit user selection. Unbound tiers inherit Chat, falling back to the host default chat model if Chat is unset. The host default is read on each call, so standalone plugins need no application-specific initialization. A missing default chat model fails visibly. An explicit invalid provider/model/reasoning choice fails without switching to another route. Session targets use the native Host projection, the request header, and the host default model; they do not call the removed `session.models` RPC.

Policy is one storage-domain record with compare-and-swap revision. It does not copy provider credentials. Host compatibility imports use `importPurposes` to persist missing defaults and a one-time marker atomically.

Auxiliary calls are plain text with no tools. Limits cap input size, output tokens, wall time, attempts, and per-provider concurrency. Interactive work is queued ahead of background work. Native agent-loop requests, when present, occupy the same provider's foreground so background jobs wait. `run({ insert: { maxChars } })` supports bounded text candidates; other auxiliary calls still require a successful complete stream.

Usage receipts store token counts when the adapter reports them. Cost is `null` when unknown. Prompts and secrets are not stored.

Host RPC is `/dsh-ai-services` (`status`, `update`, `resolve`, `usage`) and requires the host authorization policy.

## API / Exports

- `.` — Cordis plugin entry (`name`, `inject`, `apply`), `AiServicesRuntime`, `registerHostRpc`, the RPC channel and seat constants, and every contract type re-exported from `./contracts`.
- `./contracts` — browser-safe shared contracts with no host implementation.
- `./host-rpc` — `registerHostRpc` and `HostRpcContext` for hosts that mount the `/dsh-ai-services` channel.
- `./client-utils` — web client helpers: `NativeSurfaceClient`, `useNativeSeat`, `useFeatureRefresh`, `selectedSessionId`.
- `./insert-output` — bounded insert candidate helpers: `sanitizeInsert`, `collectInsertText`, `createInsertCollector`.

### AiServices

Feature plugins reach the service as `ctx.aiServices`:

- `activate(plugin)` — returns an `AiFeatureScope` (`registerPurpose`, `run`, `dispose`) bound to the plugin; disposed when the plugin unloads.
- `importPurposes(migrationId, defaults, roles?)` — host-only compatibility entrypoint; persists missing purpose defaults and a one-time marker atomically.
- `getPolicy()` / `updatePolicy(policy, expectedRevision)` — read the policy, or write it with compare-and-swap revision.
- `resolve(purpose, sessionId?, override?)` — resolve a purpose to a `ResolvedRoute` without calling a model.
- `purposes()` — every registered `PurposeSpec` with its owning plugin.
- `usage()` — stored usage receipts.

### Shared contracts (`./contracts`)

| Export | Purpose |
| --- | --- |
| `MemoryService`, `MemoryRecord` | Memory storage contract implemented by the memory plugin; observations stay candidates until explicitly accepted |
| `TaskContract`, `TaskCheckpoint`, `EvidenceRef` | Requirements-clarification contract and checkpoint shapes shared with the Mood and Recap plugins |
| `CHAT_EVENTS_SLOT` | Chat events seat name (`dsh-editor.chat.events`) |
| `MODEL_SETTINGS_SLOT` | Model settings seat name (`dsh-editor.settings.models`) |
| `AI_RPC_CHANNEL` | Host RPC channel name (`/dsh-ai-services`) |
| `projectIdFromCwd` | Derive a project key from the host-validated session directory |

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-ai-services typecheck
pnpm exec vitest run packages/dsh-ai-services/src
pnpm --filter @klarkxy/dsh-ai-services build
```

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/LICENSE)
