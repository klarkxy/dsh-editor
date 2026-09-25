# @klarkxy/dsh-web-search-manager

Configure DSH web search providers and page fetching from one settings page.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. No repository build is needed.

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Restart DSH Web and open **Settings → Web search**. For agent access, add this entry to the plugin list in its `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

DSH Editor already includes the plugin, its tools, and the Tavily adapter.

## Configure search

DuckDuckGo is enabled by default and requires no key. Enable another provider and configure credentials in settings if needed; one ready provider is enough. DeepSeek shares the key from model settings and may incur additional search charges.

The first ready provider by priority is used. Missing credentials are skipped; failed requests do not automatically switch providers. Enabling search also enables public-page fetching. A connection test sends a fixed query, not manuscript content, and may incur a provider charge.

Only configure trusted HTTPS endpoints: API keys are sent to them. Credentials use DSH storage; protection at rest depends on its configured backend. Usage counters are call attempts, not billing statements or a spending cap.

Disabling a managed provider cancels its requests, but does not sandbox HTTP calls made directly by other plugins. Search results are external material and cannot authorize changes to manuscripts.

If deployment environment overrides conflict with the settings selection, remove the conflicting overrides. If saving configuration fails, managed network access pauses until settings are successfully saved.

## Extend or develop

Use DSH's existing `ctx.web` service. For a provider extension, see [manager contracts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/contracts.ts), [built-in registration](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/builtins.ts), and the [Tavily adapter](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/tavily.ts). Forward cancellation signals; `available()` must check local state without a network request. Provider extensions can supply `pricing`, an HTTPS `pricingUrl`, and `credentialHint` for a shared credential in their registration metadata.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-web-search-manager typecheck
pnpm exec vitest run packages/dsh-web-search-manager/src
pnpm --filter @klarkxy/dsh-web-search-manager build
```

Tests use mock credentials and responses and incur no search charges.

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE)
