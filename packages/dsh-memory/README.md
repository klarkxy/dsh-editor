# @klarkxy/dsh-memory

Default-enabled Memory with optional Dream. Stores long-term preferences, project facts, decisions, and lessons. Novel canon stays in author-confirmed worldbook files, not here.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-memory/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.5-rc.2`. The bundle entry starts enabled, but loading it does not start inference or load `@klarkxy/dsh-ai-services`.

Standalone DSH must load the shared service explicitly before this feature can start:

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-memory
```

Idle Dream is a separate switch on **Settings → 记忆**. Memory itself remains independently switchable in plugin settings.

## Behaviour

`ctx.aiMemory` implements the frozen `MemoryService`. Project identity is the shared untruncated `projectIdFromCwd(session.meta.cwd)` (DSH also exposes it as `session.header.cwd`). RPC derives that path from the live session id; clients cannot submit an arbitrary directory. Record ids are UUID-backed and cannot reuse a tombstone after restart. Durable writes are one typed aggregate snapshot.

Recall injects at most 3–5 active records (~800 tokens) at Host `agent/pre-step`, exact project scope plus explicit global records. Lessons are not injected here (self-improvement owns them). Candidates, rejected, revoked, deleted, expired, and superseded records stay out of prompts.

Human preference and project-fact candidates need evidence or an explicit manual add. Global writes require the global checkbox. Dream produces merge/dedup **previews**; apply writes candidates only, never overwrites active records or expands project scope to global. Corrections and deletions win over in-flight previews. Deleted ids cannot be resurrected.

Disabling the plugin or injection/Dream switches cancels pending results and injection. Stored records remain.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-memory typecheck
pnpm exec vitest run packages/dsh-memory/src
pnpm --filter @klarkxy/dsh-memory build
```

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-memory/LICENSE)

The Editor preinstalls this feature disabled. On pinned DSH 0.1.5-rc.2, a change to the active client module graph needs a page reload or app restart; save your work first. Standalone DSH must load the shared AI service bundle explicitly as well as this feature. New 0.1.0 packages are local candidates until published; use the corresponding tarballs in .pack for local installation.

For native web profiles, append the following entry to the profile directory's `cordis.patch.yml` and restart DSH (the Editor provides its own per-feature switch):

```yaml
- id: memory
  disabled: false
```
