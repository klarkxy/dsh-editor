# @klarkxy/dsh-model-center

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-model-center/docs/README.zh-CN.md)

Model Center for DSH. Starts enabled and remains independently switchable.

[License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-model-center/LICENSE)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`.

```sh
npm install @klarkxy/dsh-model-center
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-model-center
```

AI policy is stored by `@klarkxy/dsh-ai-services`. Provider credentials stay in native DSH settings. When Model Center is absent or disabled, tier-based calls use Chat or the host default directly; saved tier bindings remain intact.

## Use

Settings → **模型中心** (or the host Models page when the editor supplies that seat).

- **Model routing** opens with four tiers: Quick, Chat, Thinking, and Fantasy. Quick is for cheap latency-sensitive auxiliary calls, Chat is the everyday default, Thinking is for heavier reasoning, and Fantasy is the highest-cost creative tier. Any tier can bind a model from any provider. Fantasy is reserved for explicit user selection and is never a built-in plugin default. Each tier configures a model and reasoning effort; unconfigured tiers inherit Chat. Capability defaults — new conversations, completion, rewrite, title, clarification, recap, and the rest — can follow any tier or use a separate model and effort. Auxiliary capabilities can also follow the current session. Reasoning effort options come from the current model catalogue. An invalid provider, model, or reasoning choice reports an error and never silently switches to another route.
- **Runtime** owns concurrency, timeout, input/output caps, and retry attempts.
- **Providers** only manages connections and available models.
- Tier changes apply to capabilities that follow them. New conversations read the saved default; existing conversation selections stay unchanged.

Built-in plugin default tiers: manuscript completion, current title, and recap use Quick; new conversations, selection rewrite, requirements clarification, and self-improvement use Chat; memory consolidation uses Thinking. Fantasy is never a default. Saved per-capability overrides are preserved. When Model Center is not installed or is disabled, tier-based calls use the default chat model directly.

## API / Exports

- `.` — Cordis plugin entry (`name`, `inject`, `apply`), the `ModelCenter` service provided as `ctx.modelCenter` (`status()`), and `handleHostRpc`.
- `./contracts` — channel and plugin constants (`MODEL_CENTER_RPC_CHANNEL`, `MODEL_CENTER_PLUGIN`, `MODEL_CENTER_ENTRY_ID`, `MODEL_ROLES`), policy types re-exported from `@klarkxy/dsh-ai-services/contracts`, and UI types (`ModelCenterStatus`, `ModelCenterTab`, `RegisteredPurpose`, `ProviderListing`, `DiscoveredModel`, `RoutePreview`).
- `./client` — web client entry (`apply`) that registers the settings seats and renders the Model Center tabs.

Host RPC is `/dsh-model-center` with a single `status` endpoint reporting `{ enabled, plugin }`. Policy reads and writes go through `/dsh-ai-services`: `status` returns the stored policy and registered purposes, `update` writes the policy with compare-and-swap (`expectedRevision`), and `resolve` previews the route for a purpose without calling a model.

## Develop

```sh
pnpm --filter @klarkxy/dsh-model-center typecheck
pnpm exec vitest run packages/dsh-model-center/src
pnpm --filter @klarkxy/dsh-model-center build
```

Hosts that bundle this feature usually enable it by default; where the host supports live plugin switching, toggling needs no restart. Standalone DSH must load `@klarkxy/dsh-ai-services` before this package; installation or removal may require a restart when the host asks for one.
