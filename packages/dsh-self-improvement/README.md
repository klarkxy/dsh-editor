# @klarkxy/dsh-self-improvement

Default-enabled self-improvement: extracted lessons take effect automatically in shared Memory, with an audit view and optional Markdown skill export.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-self-improvement/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. The bundle entry starts enabled and remains independently switchable. It does **not** load Memory or turn on Dream; standalone hosts must install and load `@klarkxy/dsh-memory` separately.

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-memory
dsh plugin --profile web add @klarkxy/dsh-self-improvement
```

Open **Settings → 记忆** and expand **自我改进** to audit lessons and skill drafts. The plugin does not render status, empty states, or management controls in chat, and it has no standalone settings page.

## Behaviour

Candidates come only from explicit human corrections or a tool failure that is later verified by a successful result for the same tool. Silence and model self-report are not treated as success. Extracted lessons are stored as Memory `kind: lesson` with `source: self-improvement` and take effect immediately — they join prompts as soon as they are relevant, and can be revoked any time from the audit view. Host pre-step injection uses `createUserMessage`, keeps decision flags such as `startsRequestSeries`, and only inserts active unexpired lessons relevant to the current user request (at most 5, ~800 tokens including the wrapper). Disabling this plugin or Memory mid-await stops lesson injection even if Memory stays on.

Accepted lessons can preview a skill Markdown draft with `name`/`description` frontmatter. Export is a browser download of that proposal; it does not install a skill or write `AGENTS.md`, scripts, or other plugins. The in-app export record is written only after the download is invoked. Revoking an export updates the in-app record only — downloaded files are not recalled.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-self-improvement typecheck
pnpm exec vitest run packages/dsh-self-improvement/src
pnpm --filter @klarkxy/dsh-self-improvement build
```

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-self-improvement/LICENSE)

The Editor preinstalls this feature enabled. In the Editor, use Settings → Plugins to switch it without restarting. Standalone DSH must load `@klarkxy/dsh-ai-services` before this package; installation or removal may require a restart when the host asks for one. It also requires Memory to be installed and enabled.
