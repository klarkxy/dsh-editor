# @klarkxy/dsh-web-search-manager

Configure DSH web search providers and page fetching from one settings page.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. No repository build is needed. Install:

```sh
npm install @klarkxy/dsh-web-search-manager
```

Then load it:

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Restart DSH Web and open **Settings → Web search**. For agent access, add this entry to the plugin list in its `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

## Configure search

The settings page has two tabs: **搜索服务** manages providers, and **请求限制** sets request limits. DuckDuckGo is enabled by default and requires no key. Enable another provider and configure credentials in settings if needed; one ready provider is enough. Drag providers to reorder them; the first ready provider by priority handles each request. Missing credentials are skipped; failed requests do not automatically switch providers.

Built-in search backends:

- **DuckDuckGo**: no registration and no key; the default backend, free of charge.
- **DeepSeek 搜索**: shares the DeepSeek API key from model settings (`DEEPSEEK_API_KEY`); may incur additional search charges on top of model usage.
- **Exa**: an independent Search API; requires its own key (`DSH_EDITOR_WEB_EXA_API_KEY`). The Exa provider is declared as a runtime dependency of this plugin.
- **Brave**: the Brave Search API; requires `DSH_EDITOR_WEB_BRAVE_API_KEY`.
- **博查**: a Chinese web search API; requires `DSH_EDITOR_WEB_BOCHA_API_KEY`.
- **Serper**: a Google results API; requires `DSH_EDITOR_WEB_SERPER_API_KEY`.
- **Firecrawl**: a web search and extraction API; requires `DSH_EDITOR_WEB_FIRECRAWL_API_KEY`.
- **Tavily**: a Search API fixed to basic search depth, never auto-upgraded; requires `DSH_EDITOR_WEB_TAVILY_API_KEY`. The adapter is built into this plugin; the former standalone `dsh-web-search-tavily` package is retired.

Enabling search also enables public-page fetching through the built-in HTTP fetch provider, which reads pages directly from your machine: no key and no search charges. Request limits cap each query's results (`maxResults`), queries per tool call (`maxQueries`), request timeout (`timeoutMs`), and fetched page characters (`maxFetchChars`). A connection test sends a fixed query, not manuscript content, and may incur a provider charge.

With the tools entry enabled, the agent receives the official `web_search` and `web_fetch` tools from `@deepseek-ai/dsh-tool-web`, mounted only while search and fetching are enabled.

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
