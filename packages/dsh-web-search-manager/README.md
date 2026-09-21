# @klarkxy/dsh-web-search-manager

Manage web search providers, credentials, permissions, and request lifecycles through DSH's existing `ctx.web` service. Includes a settings UI and an optional agent tool entry point.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/docs/README.zh-CN.md)

## Install in DSH Web

Requires Node.js 22 or later and a DSH `0.1.5-rc.2` Web profile.

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Restart `dsh web`, then open **Settings → Web search (设置 → 网络搜索)**. To expose search tools to an agent, add this entry to the plugin list in its `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

The package includes the compiled host plugin, Web client, type declarations, and `cordis.patch.yml`. No repository build is needed for installation. DSH Editor's desktop composition already includes this plugin and its Tavily adapter.

## Choose a provider

DuckDuckGo is enabled by default and requires no API key. Brave, Bocha, Serper, Firecrawl, Exa, DeepSeek, and Tavily are also supported; enable the provider you want and configure its credentials in the settings page. DeepSeek reuses the API key from the model settings and may incur additional search charges.

One enabled provider is enough. The manager selects the first ready provider by priority, skipping providers with missing credentials. A failed request does not trigger a retry with another provider, including on authentication or quota errors.

Installing [@klarkxy/dsh-zhihu](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) in the same profile adds a **Zhihu global search (知乎全网搜索)** backend. It shares the access token configured in the Zhihu settings.

Enabling search also enables public-page fetching through the local HTTP adapter. Agents use the standard `web_search` tool. Connection tests run a fixed query only when requested by the user; they may incur a provider charge and do not send manuscript content.

Provider endpoints can be customized to trusted HTTPS URLs. API keys are sent to the configured endpoint.

## Runtime behavior

The `@klarkxy/dsh-web-search-manager/tools` entry mounts the official `dsh-tool-web` tools in the session context according to the current authorization state. Disabling a provider, changing its configuration, or uninstalling it cancels its in-flight managed requests.

Other plugins continue to use the standard DSH API:

```ts
const result = await ctx.web.search({ query: 'example', maxResults: 5 }, signal)
const page = await ctx.web.fetch({ url: 'https://example.com' }, signal)
```

DeepSeek uses `@deepseek-ai/dsh-web-search-deepseek` and its Anthropic-compatible `web_search` support. Exa uses the official `ExaSearchProvider`. Page fetching uses `HttpFetchProvider`, including its public-address checks, DNS pinning, and redirect restrictions.

The bundled Tavily adapter retains provider ID `tavily`, credential reference `DSH_EDITOR_WEB_TAVILY_API_KEY`, and existing priority and endpoint settings. It uses basic search, does not upgrade search depth automatically, does not retry billable requests, and does not forward keys through redirects. A separate Tavily plugin is not required.

## Add a provider

A plugin can inject `webSearchManager` and register a provider descriptor and factory. The manager registers an authorized standard `WebSearchProvider` with the existing `ctx.web` service; DSH retains provider selection and the search result contract.

The following sketch assumes you have implemented `ExampleProvider`:

```ts
export const inject = ['webSearchManager']

export function apply(ctx) {
  ctx.effect(() => ctx.webSearchManager.registerSearchProvider({
    id: 'example',
    label: 'Example Search',
    description: 'Independent REST search',
    defaultBaseURL: 'https://search.example.com',
    credentialRef: 'DSH_EDITOR_WEB_EXAMPLE_API_KEY',
    billing: 'request',
  }, options => new ExampleProvider(options)))
}
```

The factory accepts `ProviderOptions` and returns a standard `WebSearchProvider`. Providers must forward cancellation signals. Their `available()` method checks local state only; it must not make a network request. Providers that do not require a key can omit the credential reference.

Use `registerFetchProvider` to register a page-fetching provider. The built-in Tavily adapter in `src/tavily.ts` is a concrete search-provider example.

Standalone DSH deployments need the `/tools` entry shown above in each relevant `agent.cordis.yml`. DSH Editor's composition build adds it to bundled writing presets when this feature is selected.

## Credentials and authorization

- Settings use the host's authentication and origin checks. Saves are serialized and checked for revision conflicts. Provider configuration does not contain secrets.
- Credentials are stored through the existing DSH host credential service and resolved for each request. They are not copied into environment variables or model context. Protection at rest depends on the DSH credential backend; this plugin does not guarantee operating-system keychain encryption.
- API key inputs are not saved to browser local storage. The UI disables search before deleting a key. If saving configuration fails, managed network access is paused for the current host process.
- Global `ctx.web` environment overrides can conflict with the settings page's provider selection. DSH rejects the call in that case; remove the conflicting deployment override to use the settings selection.
- Disabling managed providers controls requests made through this registration API. It does not sandbox arbitrary HTTP calls made directly by other plugins.
- Search results and fetched pages are untrusted external material. They do not authorize instructions embedded in a page or change the application's author-confirmation requirements.
- Query count, result count, timeouts, and response length are bounded. These limits are not a monetary budget. Runtime counters track adapter call attempts without retaining queries or page bodies; they are not provider billing statements. Provider-specific extensions must supply exact billing or model-native search accounting where needed.

## Development

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-web-search-manager typecheck
pnpm exec vitest run packages/dsh-web-search-manager/src
pnpm --filter @klarkxy/dsh-web-search-manager build
```

Tests use mock credentials and responses and do not incur real search charges.

See the Chinese [user guide](https://github.com/klarkxy/dsh-editor/blob/main/docs/user-guide.md) and [publishing and marketplace guide](https://github.com/klarkxy/dsh-editor/blob/main/docs/plugin-distribution.md) for repository documentation. Package license: [LICENSE](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE).
