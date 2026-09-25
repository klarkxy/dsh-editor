# @klarkxy/dsh-model-center

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-model-center/docs/README.zh-CN.md)

Model Center for DSH. Starts enabled and remains independently switchable.

[License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-model-center/LICENSE)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`.

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-model-center
```

AI policy is stored by `@klarkxy/dsh-ai-services`. Provider credentials stay in native DSH settings. When Model Center is absent or disabled, tier-based calls use Chat or the host default directly; saved tier bindings remain intact.

## Use

Settings → **模型中心** (or the host Models page when the editor supplies that seat).

- **Model routing** opens with four tiers: Quick, Chat, Thinking, and Fantasy. These correspond to Haiku, Sonnet, Opus, and Fable respectively, while allowing models from any provider. Fantasy is reserved for explicit user selection and is never a built-in plugin default. Each tier configures a model and reasoning effort; unconfigured tiers inherit Chat. Capability defaults can follow any tier or use a separate model and effort. Auxiliary capabilities can also follow the current session.
- **Runtime** owns concurrency, timeout, input/output caps, and retry attempts.
- **Providers** only manages connections and available models.
- Tier changes apply to capabilities that follow them. New conversations read the saved default; existing conversation selections stay unchanged.

## Develop

```sh
pnpm --filter @klarkxy/dsh-model-center typecheck
pnpm exec vitest run packages/dsh-model-center/src
pnpm --filter @klarkxy/dsh-model-center build
```

The Editor preinstalls this feature enabled. In the Editor, use Settings → Plugins to switch it without restarting. Standalone DSH must load `@klarkxy/dsh-ai-services` before this package; installation or removal may require a restart when the host asks for one.
