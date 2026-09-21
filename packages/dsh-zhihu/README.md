# @klarkxy/dsh-zhihu

Zhihu search, knowledge-base access, usage tracking, and optional agent tools for DSH. The service and tool entry points can be used separately.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/README.zh-CN.md)

## Install in DSH Web

Requires Node.js 22 or later and a DSH `0.1.5-rc.2` Web profile.

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

Restart `dsh web`, open **Zhihu resources (知乎资料)**, and configure the DSH credential `ZHIHU_ACCESS_TOKEN`.

To make the Zhihu tools available to an agent, add this entry to the plugin list in its `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

Use the full scoped package name. The unscoped npm package `dsh-zhihu` belongs to another maintainer. This package includes compiled output; you do not need to clone or build this repository to install it. Its version is maintained independently of the DSH version.

## Features and entry points

- **DSH Web:** a `shell.overlay` entry with ID `zhihu`, containing search, settings, usage, and knowledge-base views.
- **DSH Editor desktop:** **Settings → Zhihu resources (知乎资料)** provides configuration, usage, knowledge bases, and a connection test.
- **Host service:** `zhihu`, exposed through `/zhihu`.
- **Agent tools:** the optional `@klarkxy/dsh-zhihu/tools` entry.

The desktop composition enables both the `zhihu` and `zhihu-tools` features. The `basic`, `smart`, and `full` recipe aliases resolve to the same desktop feature set.

## Service and tool API

The `/zhihu` RPC methods are `search`, `global.search`, `hot.list`, `ask`, `knowledge.search`, `knowledge.bases`, `knowledge.upload`, and `usage.summary`.

The agent tools are:

- `zhihu_search`
- `zhihu_global_search`
- `zhihu_hot_list`
- `zhihu_ask`
- `zhihu_knowledge_search`

The UI and tools share usage accounting in `dsh_editor_zhihu_usage`. The Web client uses the host UI contracts without importing private Shell packages.

## Integration with web search

When the same profile provides `webSearchManager` through [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager), this plugin also registers a `zhihu-global` search backend. It shares `ZHIHU_ACCESS_TOKEN` with the Zhihu settings and is available through the standard `web_search` tool when enabled in the manager.

The integration is optional: without the manager, no backend is registered and no extra dependency is required. The dedicated `zhihu_global_search` tool remains available independently.

## Documentation

The following repository guides are in Chinese:

- [User guide](https://github.com/klarkxy/dsh-editor/blob/main/docs/user-guide.md)
- [Product principles](https://github.com/klarkxy/dsh-editor/blob/main/docs/product-principles.md)
- [Plugin publishing and marketplace discovery](https://github.com/klarkxy/dsh-editor/blob/main/docs/plugin-distribution.md)

See [LICENSE](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/LICENSE) for the package license.
