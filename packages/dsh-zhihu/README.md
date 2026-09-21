# @klarkxy/dsh-zhihu

Zhihu search, answers, knowledge bases, and usage tracking for DSH.

[简体中文](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.5-rc.2`. No repository build is needed.

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

Restart DSH Web, open **Zhihu resources**, and enter your Access Secret (DSH credential `ZHIHU_ACCESS_TOKEN`). Use the full scoped name; the unscoped `dsh-zhihu` package belongs to another maintainer.

To enable agent tools, add this entry to the plugin list in the agent's `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

## Use

DSH Web provides search, settings, usage, and knowledge-base views. In DSH Editor, open **Settings → Zhihu resources** for configuration, usage, knowledge bases, and a connection test; the agent tools are included.

Search covers Zhihu, the wider web, trending topics, answers, and public knowledge bases. Uploaded reference files are stored in Zhihu's cloud; do not upload unpublished manuscripts.

Installing [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) in the same profile adds **Zhihu global search** to its provider list. Enable it there to use standard web search with the same Access Secret. The dedicated Zhihu tools work independently.

## Development

Read [contracts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/contracts.ts) and [tools](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/src/tools.ts) for the API.

[Publishing](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-zhihu/LICENSE)
