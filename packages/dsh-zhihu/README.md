# @klarkxy/dsh-zhihu

Zhihu search, answers, knowledge bases, and usage tracking for DSH.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. No repository build is needed. Install:

```sh
npm install @klarkxy/dsh-zhihu
```

Then load it:

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

Restart DSH Web, open **Zhihu resources**, and enter your Access Secret (DSH credential `ZHIHU_ACCESS_TOKEN`). Use the full scoped name; the unscoped `dsh-zhihu` package belongs to another maintainer.

To enable agent tools, add this entry to the plugin list in the agent's `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

## Use

DSH Web provides search, settings, usage, and knowledge-base views. Open **Settings → Zhihu resources** for configuration, usage, knowledge bases, and a connection test; the agent tools are included.

Five agent tools are available once the tools entry is enabled:

- `zhihu_search`: search within Zhihu for community evidence; results are community/reader feedback only, never canon, and never written into project files.
- `zhihu_global_search`: search the wider web beyond Zhihu through the open platform's global search; reference only.
- `zhihu_hot_list`: pull the Zhihu hot list to see current community trends; reference for topics and hotspots only.
- `zhihu_ask`: ask Zhihu 直答, an OpenAI-compatible AI answer service grounded in Zhihu community content; suited for research and background investigation.
- `zhihu_knowledge_search`: retrieve RAG fragments from Zhihu knowledge bases — public bases by default, with personal and subscription recall scopes available after you upload material on Zhihu's web side.

Usage is tracked as daily counters of calls, failures, and returned results; usage views default to the last 30 days and accept at most 90. Knowledge-base uploads are limited to 20 MB per file.

Search covers Zhihu in-site search, the wider web, the hot list, Zhihu 直答 AI answers, and public knowledge bases. Uploaded reference files are stored in Zhihu's cloud; do not upload unpublished manuscripts.

When [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) is also installed in the same profile, this plugin registers **Zhihu global search** as a provider in its web search settings. Enable that provider to use Zhihu's global search through the standard web search tool with the Access Secret from Zhihu settings. The dedicated Zhihu tools work independently.

## Development

Read [contracts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/contracts.ts) and [tools](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/tools.ts) for the API.

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/LICENSE)
