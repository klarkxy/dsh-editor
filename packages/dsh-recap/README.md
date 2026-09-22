# @klarkxy/dsh-recap

[简体中文](./docs/README.zh-CN.md)

Background recap generation and separate agent checkpoints. The plugin starts enabled and turns **回顾卡片** on by default so a session gets usable recaps without a second toggle. Checkpoints and semantic checkpoints stay off until chosen. Recap is display-only and is not model context.

Requires Node.js ≥22 and DSH `0.1.5-rc.2`. Auxiliary generation uses `@klarkxy/dsh-ai-services` when that service is present. `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-session` are required peers.

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-recap
```

Long turns and returning after the idle interval (default 15 minutes of focused document/user activity, not assistant streaming, and not while the chat panel is `hidden`) can generate recaps in the background. The chat events seat is a quiet lifecycle controller and renders no card, button, empty state, or error. Stored recaps and manual generation remain available in **Settings → 回顾**. Status reads do not call the model; each watermark gets at most one generation unless you retry. Checkpoints are injected only at host `agent/pre-step` on meaningful boundaries, using native `createUserMessage`.

Turning either ability off cancels in-flight generation and stops auto injection. Stored card metadata remains. Unloading the plugin waits for pending writes and ignores later session events.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-recap typecheck
pnpm exec vitest run packages/dsh-recap/src
pnpm --filter @klarkxy/dsh-recap build
```

The Editor preinstalls this feature disabled. On pinned DSH 0.1.5-rc.2, a change to the active client module graph needs a page reload or app restart; save your work first. Standalone DSH must load the shared AI service bundle explicitly as well as this feature. New 0.1.0 packages are local candidates until published; use the corresponding tarballs in .pack for local installation.

For native web profiles, append the following entry to the profile directory's `cordis.patch.yml` and restart DSH (the Editor provides its own per-feature switch):

```yaml
- id: recap
  disabled: false
```
