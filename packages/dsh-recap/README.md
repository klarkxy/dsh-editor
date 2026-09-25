# @klarkxy/dsh-recap

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-recap/docs/README.zh-CN.md)

Background recap generation and separate agent checkpoints. The plugin starts enabled and can be switched off under Settings → Plugins. Recaps, agent checkpoints, and semantic checkpoints use fixed automatic defaults. Recaps are display-only and are not model context.

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. Auxiliary generation requires `@klarkxy/dsh-ai-services`. `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-session` are required peers.

```sh
npm install @klarkxy/dsh-recap
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-recap
```

Long turns and returning after the idle interval (default 15 minutes of focused document/user activity, not assistant streaming, and not while the chat panel is `hidden`) can generate recaps in the background. The chat events seat is a quiet lifecycle controller and renders no card, button, empty state, or error. There is no separate Recap settings page or manual generation control. Status reads do not call the model; each watermark gets at most one generation unless you retry the card or request a manual `refresh`. Checkpoints are injected only at host `agent/pre-step` on meaningful boundaries, using native `createUserMessage`.

When Mood is active in the same profile, Recap reads its task contract through `ctx.aiMood.getContract(sessionId)` for checkpoint context.

The per-ability switches have no settings UI: they can be changed through the `update` RPC, or by disabling the whole plugin under Settings → Plugins. Turning an ability off cancels in-flight generation and stops auto injection. Stored recaps remain. Unloading the plugin waits for pending writes and ignores later session events.

## Host RPC

Channel `/dsh-recap` requires the host authorization policy.

- `status` — settings, storage health, and stored cards and checkpoints (optionally for one `sessionId`). Never calls the model.
- `update` — write settings (`cardsEnabled`, `checkpointsEnabled`, `semanticCheckpointsEnabled`, `idleReturnMs`) with compare-and-swap (`expectedRevision`).
- `cards` / `checkpoints` — the stored recap cards or checkpoints, optionally for one session.
- `cancel` / `retry` — cancel a card's in-flight generation, or regenerate that card (`{ cardId, sessionId }`).
- `idle.return` — run the idle-return check for a session immediately.
- `refresh` — generate a recap for a session on demand (`manual` trigger), independent of the one-generation-per-watermark rule.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-recap typecheck
pnpm exec vitest run packages/dsh-recap/src
pnpm --filter @klarkxy/dsh-recap build
```

Hosts that bundle this feature usually enable it by default; where the host supports live plugin switching, toggling needs no restart. Standalone DSH must load `@klarkxy/dsh-ai-services` before this package; installation or removal may require a restart when the host asks for one.
