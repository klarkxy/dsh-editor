# @klarkxy/dsh-ai-services

Shared Cordis service for model-role routing, bounded auxiliary calls, cancellation, and usage receipts. It is a supporting service, not a user-facing feature. Loading it does not start inference.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.7-alpha.1`. The host must provide `llm`, `storageDomain`, `connection`, and `webServer`.

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
```

DSH Editor includes this package as a locked core service. Feature plugins call `ctx.aiServices.activate(plugin)` when they need a model; this package never calls the model by itself.

## Routing

Roles `weak`, `normal`, `strong`, and `fantasy` represent Quick, Chat, Thinking, and Fantasy (the Haiku, Sonnet, Opus, and Fable tiers respectively). They can bind models from any provider. Built-in plugins never default to Fantasy; it is reserved for explicit user selection. Unbound tiers inherit Chat, falling back to the host default chat model if Chat is unset. Without Model Center, tier-based calls use Chat or the host default directly; saved tier bindings remain intact. The host default is read on each call, so standalone plugins need no Editor initialization. A missing default chat model fails visibly. An explicit invalid provider/model/reasoning choice fails without switching to another route. Session targets read the current picker via `session.models`, not the last request header.

Policy is one storage-domain record with compare-and-swap revision. It does not copy provider credentials. Manuscript completion and rewrite settings stay on their existing path.

Auxiliary calls are plain text with no tools. Limits cap input size, output tokens, wall time, attempts, and per-provider concurrency. Interactive work is queued ahead of background work. Native agent-loop requests, when present, occupy the same provider’s foreground so background jobs wait.

Usage receipts store token counts when the adapter reports them. Cost is `null` when unknown. Prompts and secrets are not stored.

Host RPC is `/dsh-ai-services` (`status`, `update`, `resolve`, `usage`) and requires the host authorization policy.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-ai-services typecheck
pnpm exec vitest run packages/dsh-ai-services/src
pnpm --filter @klarkxy/dsh-ai-services build
```

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/LICENSE)

Manuscript completion and rewrite share purpose routing, cancellation, quotas and receipts. Host compatibility imports use `importPurposes` to persist missing defaults and a one-time marker atomically. `run({ insert: { maxChars } })` supports bounded plain-writing candidates; other auxiliary calls still require a successful complete stream.
