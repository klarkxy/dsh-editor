# dsh-web-search-tavily

独立供应商扩展，为 `dsh-web-search-manager` 增加 Tavily Search API。安装本包不会自动启用联网，也不会从环境中直接读取 `TAVILY_API_KEY`。

在设置 → 网络搜索打开 Tavily 卡片，填写自己的 Key，然后主动启用。凭据引用为 `DSH_EDITOR_WEB_TAVILY_API_KEY`。密钥通过 Host 凭据服务读取，普通设置只保存供应商地址与授权状态。

适配器调用 `POST https://api.tavily.com/search`，使用 Bearer 鉴权。固定 `search_depth: basic`、`topic: general`、`auto_parameters: false`，关闭 answer、raw content 和 images。不进行额外模型调用，不自动升级搜索深度，不重试计费请求，不跟随重定向转发密钥。

返回标准 DSH `WebSearchResult`。过滤非 HTTP(S) 来源和带凭据的 URL，限制结果数量、摘要长度以及响应体大小，支持调用方取消。供应商错误不会把原始响应或密钥回传给模型。

第一版仅搜索，不把 Tavily Extract 冒充普通 HTTP Fetch。后续读取适配器可以通过管理插件的 `registerFetchProvider` 接口增加。

官方 API 参考：https://docs.tavily.com/documentation/api-reference/endpoint/search
