# @klarkxy/dsh-web-search-manager

在一个设置页中配置 DSH 网络搜索与网页读取。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.7-rc.2`，无需构建本仓库。安装：

```sh
npm install @klarkxy/dsh-web-search-manager
```

然后加载：

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

重启 DSH Web，打开「设置 → 网络搜索」。模型需要使用搜索工具时，在所用 `agent.cordis.yml` 的插件列表加入：

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

## 配置搜索

设置页分两个标签页：「搜索服务」管理供应商，「请求限制」设置请求限额。默认开启 DuckDuckGo，无需密钥。需要其它后端时在设置中开启并填写凭据；一个可用后端即可。拖拽后端调整顺序；按优先级使用第一个就绪后端，缺密钥的跳过，失败不自动换家。

内置搜索后端：

- **DuckDuckGo**：无需注册、无需密钥，默认后端，免费。
- **DeepSeek 搜索**：与模型设置共用 DeepSeek API Key（`DEEPSEEK_API_KEY`），可能在模型费用外产生额外搜索费用。
- **Exa**：独立 Search API，需要单独的 Key（`DSH_EDITOR_WEB_EXA_API_KEY`）。Exa 供应商已声明为本插件的运行时依赖。
- **Brave**：Brave Search API，需要 `DSH_EDITOR_WEB_BRAVE_API_KEY`。
- **博查**：中文网页搜索 API，需要 `DSH_EDITOR_WEB_BOCHA_API_KEY`。
- **Serper**：Google 结果 Search API，需要 `DSH_EDITOR_WEB_SERPER_API_KEY`。
- **Firecrawl**：网页搜索与提取 API，需要 `DSH_EDITOR_WEB_FIRECRAWL_API_KEY`。
- **Tavily**：Search API，固定 basic 检索深度，不自动升级；需要 `DSH_EDITOR_WEB_TAVILY_API_KEY`。适配器已并入本插件，原独立的 `dsh-web-search-tavily` 包已退役。

开启搜索也会启用公开网页读取，由内置 HTTP 读取后端直接从本机读取页面，无需密钥、不产生搜索费用。请求限制包括每条查询的结果上限（`maxResults`）、每次工具调用的查询上限（`maxQueries`）、请求超时（`timeoutMs`）和网页正文字符上限（`maxFetchChars`）。连接测试发送固定查询，不发送作品内容，可能产生一次调用费用。

加入 tools 入口后，模型获得 `@deepseek-ai/dsh-tool-web` 的官方 `web_search` 与 `web_fetch` 工具，仅在搜索与网页读取开启时挂载。

只配置可信 HTTPS 端点，密钥会发送到该地址。凭据由 DSH 保存，落盘保护取决于其后端配置。用量计数是调用尝试，不等于账单或消费上限。

关闭受管后端会取消其请求，但不能阻止其它插件自行联网。搜索结果是外部资料，不授权修改稿件。

若部署环境的供应商覆盖与设置页冲突，移除冲突的覆盖配置。设置保存失败时，受管联网会暂停，成功保存后恢复。

## 扩展与开发

复用 DSH 的 `ctx.web`。扩展供应商可参照[管理接口](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/contracts.ts)、[内置注册](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/builtins.ts)和 [Tavily 适配器](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/tavily.ts)。须传递取消信号；`available()` 只检查本地状态，不发送网络请求。扩展后端可在注册描述中提供 `pricing`、HTTPS `pricingUrl`；共用凭据时可提供 `credentialHint`，由后端维护自己的设置页文案。

在仓库根运行：

```sh
pnpm --filter @klarkxy/dsh-web-search-manager typecheck
pnpm exec vitest run packages/dsh-web-search-manager/src
pnpm --filter @klarkxy/dsh-web-search-manager build
```

测试使用模拟凭据和响应，不产生搜索费用。

[发布维护](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE)
