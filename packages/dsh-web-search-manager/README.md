# dsh-web-search-manager

DSH `0.1.5-rc.2` 的独立网络搜索管理插件。提供设置页、明确授权、供应商管理描述和生命周期控制；不实现第二套搜索执行服务。

## 使用

桌面默认组合安装此插件和 Tavily 扩展。进入 **设置 → 网络搜索**，选择供应商并填写自己的 API Key，点击 **保存并启用搜索**。仅保存凭据不会启用搜索。网页读取有独立开关，默认同样关闭。测试连接是用户主动触发的固定查询，可能产生一次供应商调用费用，不发送作品内容。

Exa 复用 `@deepseek-ai/dsh-web-search-exa` 的官方 `ExaSearchProvider`，HTTP 读取复用 `HttpFetchProvider` 的公开地址、DNS 固定和重定向安全策略。不会自动读取聊天 Key，不会匿名搜索，不会在鉴权或额度失败时自动切换供应商。供应商可配置可信 HTTPS API 端点，密钥将发送到该端点。

模型工具由 `dsh-web-search-manager/tools` 在会话上下文内按授权状态挂载官方 `dsh-tool-web`。关闭、切换配置或卸载供应商会取消正在进行的受管请求。其他业务插件继续使用：

```ts
const result = await ctx.web.search({ query: 'example', maxResults: 5 }, signal)
const page = await ctx.web.fetch({ url: 'https://example.com' }, signal)
```

## 扩展供应商

独立插件注入 `webSearchManager`，使用管理注册接口贡献描述和工厂。管理层把受授权保护的标准 `WebSearchProvider` 注册到 **现有 `ctx.web`**；供应商选择和结果协议仍归 DSH 管理。

```ts
export const inject = ['webSearchManager']
export function apply(ctx) {
  ctx.effect(() => ctx.webSearchManager.registerSearchProvider({
    id: 'example', label: 'Example Search', description: 'Independent REST search',
    defaultBaseURL: 'https://search.example.com',
    credentialRef: 'DSH_EDITOR_WEB_EXAMPLE_API_KEY', billing: 'request',
  }, options => new ExampleProvider(options)))
}
```

工厂遵循 `ProviderOptions`，返回标准 `WebSearchProvider`，必须传递取消信号。`available()` 只检查本地状态，不进行联网测试。纯网页读取供应商可通过 `registerFetchProvider` 注册，无 Key 的读取须独立授权。当前版本的搜索供应商必须声明凭据引用。Tavily 包是完整示例。

独立 DSH 部署还需在所用的 `agent.cordis.yml` 加入 `name: dsh-web-search-manager/tools`。Editor 的组合构建会为已选择该能力的应用自带写作预设加入这一入口；未选择该插件的组合不会产生悬空引用。

## 边界与安全

- 设置通过 Host 的认证/来源检查，按版本号串行保存，配置不包含密钥。凭据写入现有 Host 凭据服务，每次请求重新解析，不复制到环境变量或模型上下文。现有凭据后端的落盘保护取决于 DSH 配置，本插件不宣称操作系统密钥库加密。
- 有 Key 不等于授权。环境中的独立搜索 Key 也必须在设置页主动启用；聊天 Key 不自动复用。历史明确授权可以随持久化设置恢复。
- 全局 `ctx.web` 的环境供应商选择覆盖可能与管理页选择冲突，此时 DSH 会拒绝调用，不进行隐藏回退。移除这类部署覆盖再使用设置页选择供应商。
- 管理接口的关闭操作约束受管供应商，不是任意第三方插件 HTTP 请求的网络沙箱。自行绕过管理注册直接发 HTTP 的插件不在此授权边界内。
- API Key 输入不落本地存储。界面删除前先停用搜索；并发设置有 revision 冲突检查。配置保存失败时，本次 Host 运行暂停受管网络访问。
- 网页和搜索结果是外部不可信资料，不授权模型执行网页内指令，也不改变写作提案和作者确认边界。
- 查询数量、结果数、超时及正文长度有边界，但不是美元预算上限。当前运行的计数只统计适配器调用尝试，不保存查询或正文，不声称等于供应商账单。模型原生搜索的内部计费与精确账单仍应由对应扩展另行提供。

## 验证

```sh
pnpm --filter dsh-web-search-manager typecheck
pnpm exec vitest run packages/dsh-web-search-manager/src packages/dsh-web-search-tavily/src
pnpm --filter dsh-web-search-manager build
```

测试使用模拟 Key 和响应，不产生真实搜索费用。
