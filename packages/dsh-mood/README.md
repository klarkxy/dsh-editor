# @klarkxy/dsh-mood

Default-enabled requirements clarification at the Host `agent/pre-step` boundary.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH `0.1.7-alpha.1`. The bundle entry starts enabled and remains independently switchable. Mood does not replace native permissions or writing proposal confirmation.

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-mood
```

Enable or disable the feature under **Settings → Plugins**. When enabled, it uses automatic clarification. The chat card uses seat `dsh-editor.chat.events` with `{sessionId, locale}`.

Clear requests do not call `mood.analyze`. Auto mode only asks when a conservative check finds material ambiguity or risk. Clarification waits in the same pre-step, then resumes that intercepted request once.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm exec vitest run packages/dsh-mood/src
pnpm --filter @klarkxy/dsh-mood build
```

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/LICENSE)

The Editor preinstalls this feature enabled. In the Editor, use Settings → Plugins to switch it without restarting. Standalone DSH must load `@klarkxy/dsh-ai-services` before this package; installation or removal may require a restart when the host asks for one.
