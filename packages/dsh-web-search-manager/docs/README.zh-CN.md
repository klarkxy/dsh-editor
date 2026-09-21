# @klarkxy/dsh-web-search-manager

在一个设置页中配置 DSH 网络搜索与网页读取。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.5-rc.2`，无需构建本仓库。

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

重启 DSH Web，打开「设置 → 网络搜索」。模型需要使用搜索工具时，在所用 `agent.cordis.yml` 的插件列表加入：

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

DSH Editor 已内置此插件、模型工具及 Tavily 适配器。

## 配置搜索

默认开启 DuckDuckGo，无需密钥。需要其它后端时在设置中开启并填写凭据；一个可用后端即可。DeepSeek 共用模型设置中的密钥，可能产生额外搜索费用。

按优先级使用第一个就绪后端，缺密钥的跳过，失败不自动换家。开启搜索也会启用公开网页读取。连接测试发送固定查询，不发送作品内容，可能产生一次调用费用。

安装 [@klarkxy/dsh-zhihu](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) 后，「知乎全网搜索」共用知乎设置中的 Access Secret。

只配置可信 HTTPS 端点，密钥会发送到该地址。凭据由 DSH 保存，落盘保护取决于其后端配置。用量计数是调用尝试，不等于账单或消费上限。

关闭受管后端会取消其请求，但不能阻止其它插件自行联网。搜索结果是外部资料，不授权修改稿件。

若部署环境的供应商覆盖与设置页冲突，移除冲突的覆盖配置。设置保存失败时，受管联网会暂停，成功保存后恢复。

## 扩展与开发

复用 DSH 的 `ctx.web`。扩展供应商可参照[管理接口](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/contracts.ts)、[内置注册](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/builtins.ts)和 [Tavily 适配器](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/tavily.ts)。须传递取消信号；`available()` 只检查本地状态，不发送网络请求。

在仓库根运行：

```sh
pnpm --filter @klarkxy/dsh-web-search-manager typecheck
pnpm exec vitest run packages/dsh-web-search-manager/src
pnpm --filter @klarkxy/dsh-web-search-manager build
```

测试使用模拟凭据和响应，不产生搜索费用。

[发布维护](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE)
