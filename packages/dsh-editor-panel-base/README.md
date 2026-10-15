# dsh-editor-panel-base

面板公共基础设施，供 `dsh-editor-memory-panel`、`dsh-editor-overview-panel` 使用。

## 用途

提供统一的 RPC 通信、请求管理和国际化工厂，避免面板包重复代码。

## 导出

### RPC 层 (`dsh-editor-panel-base/rpc`)

详见 [src/rpc/index.ts](./src/rpc/index.ts)：
- `safeRpcCall()` — 安全 RPC 调用包装
- `errorMessage()` — 错误消息本地化
- `LatestRequestGate` — 请求竞态保护（`begin()`, `setScope()`, `isCurrent()`）
- `RpcResult<T>` — RPC 结果类型
- `RequestTicket` — 请求凭证类型

### 请求管理 (`dsh-editor-panel-base/requests`)

详见 [src/requests/index.ts](./src/requests/index.ts)：
- `createRequestManager()` — 创建请求管理器
- `PanelRequest` — 基础请求类型

### 国际化 (`dsh-editor-panel-base/messages`)

详见 [src/messages/index.ts](./src/messages/index.ts)：
- `createMessages()` — 创建国际化工厂
- 返回 `t()`, `message()`, `setLocale()`, `intlLocale()`, `interpolate()`

各面板业务样式由各自包维护，设计 token 直接来自 `dsh-editor-seats/tokens`。

## 依赖

仅依赖 `dsh-editor-seats`，不依赖 `dsh-editor-workbench`。

## 架构

面板包通过此基础设施统一模式，各自保留业务逻辑、UI 组件和 Cordis 适配器。详见 [架构重构方案](../../docs/refactoring/refactoring-plan.md)。
