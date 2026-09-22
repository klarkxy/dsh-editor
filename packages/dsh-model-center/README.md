# @klarkxy/dsh-model-center

[简体中文](./docs/README.zh-CN.md)

Model Center for DSH. Starts enabled and remains independently switchable.

[License](./LICENSE)

## Install

Requires Node.js ≥22 and DSH `0.1.5-rc.2`.

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-model-center
```

AI policy is stored by `@klarkxy/dsh-ai-services`. Provider credentials stay in native DSH settings.

## Use

Settings → **模型中心** (or the host Models page when the editor supplies that seat).

- **Model routing** opens first. Chat, completion, and rewrite are grouped under common features; other plugin features can follow a preset or choose a model directly.
- **Runtime** owns concurrency, timeout, input/output caps, and retry attempts.
- **Providers** only manages connections and available models.
- Default, efficient, and high-quality presets live under **Advanced settings**.

## Develop

```sh
pnpm --filter @klarkxy/dsh-model-center typecheck
pnpm exec vitest run packages/dsh-model-center/src
pnpm --filter @klarkxy/dsh-model-center build
```

The Editor preinstalls this feature disabled. On pinned DSH 0.1.5-rc.2, a change to the active client module graph needs a page reload or app restart; save your work first. Standalone DSH must load the shared AI service bundle explicitly as well as this feature. New 0.1.0 packages are local candidates until published; use the corresponding tarballs in .pack for local installation.

For native web profiles, append the following entry to the profile directory's `cordis.patch.yml` and restart DSH (the Editor provides its own per-feature switch):

```yaml
- id: model-center
  disabled: false
```
