# @klarkxy/dsh-mood

Default-enabled requirements clarification at the Host `agent/pre-step` boundary.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH `0.1.5-rc.2`. The bundle entry starts enabled and remains independently switchable. Mood does not replace native permissions or writing proposal confirmation.

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-mood
```

Open **Settings → 需求澄清** and choose 自动, 手动, or 严格. The chat card uses seat `dsh-editor.chat.events` with `{sessionId, locale}`.

Clear requests do not call `mood.analyze`. Auto mode only asks when a conservative check finds material ambiguity or risk. Clarification waits in the same pre-step, then resumes that intercepted request once. Recap can read `ctx.aiMood.getContract(sessionId)`.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm exec vitest run packages/dsh-mood/src
pnpm --filter @klarkxy/dsh-mood build
```

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/LICENSE)

The Editor preinstalls this feature disabled. On pinned DSH 0.1.5-rc.2, a change to the active client module graph needs a page reload or app restart; save your work first. Standalone DSH must load the shared AI service bundle explicitly as well as this feature. New 0.1.0 packages are local candidates until published; use the corresponding tarballs in .pack for local installation.

For native web profiles, append the following entry to the profile directory's `cordis.patch.yml` and restart DSH (the Editor provides its own per-feature switch):

```yaml
- id: mood
  disabled: false
```
