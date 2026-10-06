# Phase 2: 实施指南

> **历史留档**: 本文档为 Phase 1 开发手册的历史正文。当前权威计划参考 [架构重构权威计划](refactoring/refactoring-plan.md)，Phase 0 已完成 Workbench 内部职责目录重组，Phase 1 已完成面板基础设施实施与独立验收收尾。保留本文档历史正文供参考。

**日期**: 2026-10-06  
**状态**: 开发者手册  
**依赖**: [设计文档](./phase2-panel-design.md), [迁移计划](./phase2-migration-plan.md)

---

## 目录

1. [快速开始](#1-快速开始)
2. [创建新面板](#2-创建新面板)
3. [迁移现有面板](#3-迁移现有面板)
4. [API 参考](#4-api-参考)
5. [最佳实践](#5-最佳实践)
6. [常见问题](#6-常见问题)

---

## 1. 快速开始

### 1.1 安装依赖

```bash
cd packages/your-panel
pnpm add dsh-editor-panel-base
```

### 1.2 最小化示例

```typescript
// src/client.tsx
import { createPanelClient, seatFromRenderProps } from 'dsh-editor-panel-base'
import { SIDEBAR_TOOLS_SLOT } from 'dsh-editor-seats'

export const { name, inject, apply } = createPanelClient({
  panelName: 'my-panel',
  styles: '/* CSS */',
  slot: {
    slotName: SIDEBAR_TOOLS_SLOT,
    panelId: 'my-panel',
    order: 100,
    label: 'My Panel',
  },
  commands: [],
  createRender: (rpc) => (props) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return <div>Hello from my panel!</div>
  },
})
```

---

## 2. 创建新面板

### 2.1 包结构

```bash
packages/dsh-editor-my-panel/
├── src/
│   ├── index.ts           # Cordis 服务端入口（空）
│   ├── client.tsx         # Cordis 客户端插件
│   ├── panel.tsx          # React 面板组件
│   ├── requests.ts        # 请求总线
│   ├── messages.ts        # 国际化
│   ├── styles.ts          # 样式
│   └── my-view.ts         # 业务逻辑（可选）
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── cordis.patch.yml
└── README.md
```

### 2.2 步骤 1: 创建包

```bash
mkdir -p packages/dsh-editor-my-panel/src
cd packages/dsh-editor-my-panel
```

**package.json**:
```json
{
  "name": "dsh-editor-my-panel",
  "version": "0.1.0",
  "description": "My custom panel for DSH Editor",
  "private": true,
  "type": "module",
  "main": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "import": "./lib/index.js"
    },
    "./client": {
      "default": "./lib/client.js"
    }
  },
  "scripts": {
    "build": "tsdown && node ../../scripts/wrap-client.mjs dsh-editor-my-panel",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dsh-editor-panel-base": "workspace:*"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.4"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@types/react": "18.3.31",
    "dsh-editor-seats": "workspace:*",
    "dsh-editor-workbench": "workspace:*",
    "react": "^18.2.0",
    "tsdown": "^0.22.14",
    "typescript": "^5.9.2"
  }
}
```

### 2.3 步骤 2: 创建请求总线

**src/requests.ts**:
```typescript
import { createPanelRequestBus, type BasePanelRequest } from 'dsh-editor-panel-base'

// 如果需要额外参数，扩展 BasePanelRequest
export type MyPanelRequest = BasePanelRequest & {
  mode?: 'quick' | 'full'
}

const bus = createPanelRequestBus<MyPanelRequest>()

export const requestMyPanel = (mode: 'quick' | 'full' = 'quick') => 
  bus.request({ mode })

export const pendingMyPanelRequest = () => bus.pending()
export const consumeMyPanelRequest = (req: MyPanelRequest) => bus.consume(req)
export const subscribeMyPanelRequest = (listener: (req: MyPanelRequest) => void) => 
  bus.subscribe(listener)
```

### 2.4 步骤 3: 创建国际化

**src/messages.ts**:
```typescript
import { createPanelI18n } from 'dsh-editor-panel-base'

type MessageKey = 
  | 'panel.title'
  | 'panel.close'
  | 'action.submit'
  | 'error.generic'

const zh = {
  'panel.title': '我的面板',
  'panel.close': '关闭',
  'action.submit': '提交',
  'error.generic': '操作失败',
} as const

const en: Record<MessageKey, string> = {
  'panel.title': 'My Panel',
  'panel.close': 'Close',
  'action.submit': 'Submit',
  'error.generic': 'Operation failed',
}

const i18n = createPanelI18n<MessageKey>({ zh, en })

export const setMyPanelLocale = i18n.setLocale.bind(i18n)
export const t = i18n.t.bind(i18n)
export const message = i18n.message.bind(i18n)
```

### 2.5 步骤 4: 创建样式

**src/styles.ts**:
```typescript
import { panelContainerStyles, panelAccessibilityStyles } from 'dsh-editor-panel-base'

const baseStyles = panelContainerStyles({
  panelName: 'my-panel',
  animation: true,
})

export const myPanelStyles = `
${baseStyles}

.radix-themes .my-panel {
  margin: 0 var(--space-2) var(--space-2);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.radix-themes .my-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.radix-themes .my-panel-header h2 {
  margin: 0;
  font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--s-font);
  color: var(--s-text);
}

.radix-themes .my-panel-content {
  display: grid;
  gap: var(--space-2);
}

${panelAccessibilityStyles.replace(/\.panel-base/g, '.my-panel')}
`
```

### 2.6 步骤 5: 创建面板组件

**src/panel.tsx**:
```typescript
import { useState, useEffect } from 'react'
import { usePanelRequest, usePanelRpc, type RpcCaller } from 'dsh-editor-panel-base'
import type { ShellToolSeatContext } from 'dsh-editor-seats'
import { SeatButton } from 'dsh-editor-seats/seat-button'
import { WORKBENCH_RPC_CHANNEL } from 'dsh-editor-workbench/contracts'
import { setMyPanelLocale, t } from './messages.ts'
import { 
  subscribeMyPanelRequest, 
  consumeMyPanelRequest,
  type MyPanelRequest 
} from './requests.ts'

export type MyPanelProps = ShellToolSeatContext & {
  rpc: RpcCaller
  onClose(): void
}

function MyPanel(props: MyPanelProps) {
  setMyPanelLocale(props.locale)
  const [data, setData] = useState<string>('')

  // 使用 RPC 钩子加载数据
  const { data: rpcData, loading, error } = usePanelRpc<{ result: string }>({
    rpc: props.rpc,
    channel: WORKBENCH_RPC_CHANNEL,
    endpoint: 'my.endpoint',
    payload: () => ({ sessionId: props.sessionId }),
    scope: `${props.sessionId}\u0000${props.treeRevision}`,
  })

  useEffect(() => {
    if (rpcData) {
      setData(rpcData.result)
    }
  }, [rpcData])

  return (
    <div className="my-panel">
      <header className="my-panel-header">
        <h2>{t('panel.title')}</h2>
        <SeatButton
          owner={props}
          onClick={props.onClose}
          aria-label={t('panel.close')}
        >
          ✕
        </SeatButton>
      </header>

      <div className="my-panel-content">
        {loading && <p>Loading...</p>}
        {error && <p style={{ color: 'var(--s-danger)' }}>{error}</p>}
        {data && <p>{data}</p>}
      </div>
    </div>
  )
}

export function MyPanelSeat(props: ShellToolSeatContext & { rpc: RpcCaller }) {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<MyPanelRequest | null>(null)

  // 监听请求
  usePanelRequest(
    {
      request: () => ({ nonce: Date.now() }),
      pending: () => null,
      consume: () => {},
      subscribe: subscribeMyPanelRequest,
    },
    (req) => {
      setRequest(req)
      setOpen(true)
      consumeMyPanelRequest(req)
    }
  )

  if (!open) return null

  return (
    <MyPanel
      {...props}
      onClose={() => setOpen(false)}
    />
  )
}
```

### 2.7 步骤 6: 创建客户端插件

**src/client.tsx**:
```typescript
import { createPanelClient, seatFromRenderProps } from 'dsh-editor-panel-base'
import { SIDEBAR_TOOLS_SLOT } from 'dsh-editor-seats'
import { MyPanelSeat } from './panel.tsx'
import { requestMyPanel } from './requests.ts'
import { myPanelStyles } from './styles.ts'
import { message } from './messages.ts'

export const { name, inject, apply } = createPanelClient({
  panelName: 'my-panel',
  styles: myPanelStyles,
  slot: {
    slotName: SIDEBAR_TOOLS_SLOT,
    panelId: 'my-panel',
    order: 100,
    label: '我的面板',
  },
  commands: [
    {
      id: 'my-panel-open',
      group: 'tools',
      label: {
        zh: message('zh', 'panel.title'),
        en: message('en', 'panel.title'),
      },
      when: 'always',
      run: () => requestMyPanel(),
    },
  ],
  createRender: (rpc) => (props) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return <MyPanelSeat {...seat} rpc={rpc} />
  },
})
```

### 2.8 步骤 7: 创建服务端入口

**src/index.ts**:
```typescript
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-editor-my-panel'
export const inject = [] as const

/** Client-only feature */
export function apply(_ctx: Context): void {}
```

### 2.9 步骤 8: 构建与测试

```bash
pnpm install
pnpm build
pnpm typecheck
```

### 2.10 步骤 9: 集成到应用

在应用配置中添加面板包：

```typescript
// apps/desktop/src/plugins.ts
import * as myPanel from 'dsh-editor-my-panel'
import * as myPanelClient from 'dsh-editor-my-panel/client'

export const plugins = [
  // ... 其他插件
  myPanel,
  myPanelClient,
]
```

---

## 3. 迁移现有面板

### 3.1 迁移检查清单

- [ ] 添加 `dsh-editor-panel-base` 依赖
- [ ] 替换 `rpc.ts` 为导入
- [ ] 替换 `requests.ts` 为请求总线
- [ ] 重构 `messages.ts` 使用 i18n 工厂
- [ ] 重构 `styles.ts` 使用样式工具
- [ ] 重构 `client.tsx` 使用 Cordis 适配器
- [ ] 运行类型检查
- [ ] 运行构建
- [ ] 功能测试

### 3.2 迁移示例: Memory Panel

#### Before: src/rpc.ts (58 行)

```typescript
export type RpcResult<T = unknown> = 
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } }

export function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  return Promise.resolve()
    .then(() => request() as Promise<RpcResult<T>>)
    .catch((error: unknown) => ({
      ok: false as const,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed' },
    }))
}

export class LatestRequestGate {
  private scope = ''
  private sequence = 0
  // ... 实现
}

export function errorMessage(result: RpcResult, _locale?: ShellLocale): string {
  if (result.ok) return ''
  const blob = `${result.error.code ?? ''} ${result.error.message ?? ''}`
  if (/stale|changed/i.test(blob)) return t('error.diskChanged')
  // ... 更多映射
}
```

#### After: src/rpc.ts (15 行)

```typescript
import {
  safeRpcCall,
  LatestRequestGate,
  snapshotTimeLabel,
  errorMessage as baseErrorMessage,
  type RpcResult,
  type RequestTicket,
  type ErrorMessageMapper,
} from 'dsh-editor-panel-base'
import { t } from './messages.ts'

export { safeRpcCall, LatestRequestGate, snapshotTimeLabel, type RpcResult, type RequestTicket }

export function errorMessage(result: RpcResult): string {
  return baseErrorMessage(result, {
    diskChanged: t('error.diskChanged'),
    sessionMissing: t('error.sessionMissing'),
    notFound: t('error.notFound'),
    generic: t('error.generic'),
  })
}
```

**节省**: 58 行 → 15 行 (74% 减少)

#### Before: src/requests.ts (27 行)

```typescript
export type MemoryRequest = { nonce: number }
type Listener = (request: MemoryRequest) => void
const listeners = new Set<Listener>()
let pending: MemoryRequest | null = null

export function requestMemoryOpen(): MemoryRequest {
  pending = { nonce: Date.now() }
  for (const listener of listeners) listener(pending)
  return pending
}

export function pendingMemoryRequest(): MemoryRequest | null {
  return pending
}

export function consumeMemoryRequest(request: MemoryRequest): void {
  if (pending && pending.nonce === request.nonce) pending = null
}

export function subscribeMemoryRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
```

#### After: src/requests.ts (11 行)

```typescript
import { createPanelRequestBus, type BasePanelRequest } from 'dsh-editor-panel-base'

export type MemoryRequest = BasePanelRequest

const bus = createPanelRequestBus<MemoryRequest>()

export const requestMemoryOpen = () => bus.request()
export const pendingMemoryRequest = () => bus.pending()
export const consumeMemoryRequest = (req: MemoryRequest) => bus.consume(req)
export const subscribeMemoryRequest = (listener: (req: MemoryRequest) => void) => 
  bus.subscribe(listener)
```

**节省**: 27 行 → 11 行 (59% 减少)

---

## 4. API 参考

### 4.1 RPC 层

#### `safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>>`

安全地执行 RPC 调用，捕获异常并规范化错误。

**示例**:
```typescript
const result = await safeRpcCall<MyData>(() =>
  rpc.call(WORKBENCH_RPC_CHANNEL, 'my.endpoint', { sessionId })
)

if (!result.ok) {
  console.error(result.error.message)
  return
}

const data = result.value // 类型推导为 MyData
```

#### `LatestRequestGate`

防止竞态条件的请求门控。

**方法**:
- `setScope(scope: string): void` - 设置当前作用域
- `begin(scope: string): RequestTicket` - 开始新请求
- `isCurrent(ticket: RequestTicket): boolean` - 检查票据是否有效

**示例**:
```typescript
const gate = useRef(new LatestRequestGate()).current
const scope = `${sessionId}\u0000${revision}`
gate.setScope(scope)

const load = async () => {
  const ticket = gate.begin(scope)
  const data = await fetchData()
  if (!gate.isCurrent(ticket)) return // 忽略过期响应
  setData(data)
}
```

#### `errorMessage(result: RpcResult, mapper: ErrorMessageMapper): string`

将 RPC 错误映射为用户友好消息。

**示例**:
```typescript
const mapper = {
  diskChanged: t('error.diskChanged'),
  sessionMissing: t('error.sessionMissing'),
  notFound: t('error.notFound'),
  generic: t('error.generic'),
}
const message = errorMessage(result, mapper)
```

### 4.2 请求总线

#### `createPanelRequestBus<TRequest>(): PanelRequestBus<TRequest>`

创建面板请求总线。

**类型参数**:
- `TRequest extends BasePanelRequest` - 请求类型

**返回**:
- `request(payload?)` - 触发请求
- `pending()` - 获取待处理请求
- `consume(request)` - 消费请求
- `subscribe(listener)` - 订阅请求

**示例**:
```typescript
type MyRequest = BasePanelRequest & { mode: 'quick' | 'full' }
const bus = createPanelRequestBus<MyRequest>()

export const requestPanel = (mode: 'quick' | 'full') => bus.request({ mode })
```

### 4.3 国际化

#### `createPanelI18n<TKey>(config: PanelI18nConfig<TKey>): PanelI18n<TKey>`

创建国际化实例。

**配置**:
```typescript
interface PanelI18nConfig<TKey extends string> {
  zh: Record<TKey, string>
  en: Record<TKey, string>
  defaultLocale?: 'zh' | 'en'
}
```

**返回方法**:
- `setLocale(locale)` - 设置语言
- `getLocale()` - 获取当前语言
- `t(key, params?)` - 翻译
- `message(locale, key, params?)` - 获取指定语言消息
- `intlLocale(locale?)` - 获取 Intl API 语言代码

**示例**:
```typescript
const i18n = createPanelI18n<'title' | 'close'>({
  zh: { title: '标题', close: '关闭' },
  en: { title: 'Title', close: 'Close' },
})

i18n.setLocale('zh')
console.log(i18n.t('title')) // "标题"
```

### 4.4 样式工具

#### `panelContainerStyles(config: PanelStyleConfig): string`

生成面板容器基础样式。

**配置**:
```typescript
interface PanelStyleConfig {
  panelName: string
  animation?: boolean
  animationDuration?: number
  animationEasing?: string
}
```

**示例**:
```typescript
const base = panelContainerStyles({
  panelName: 'my-panel',
  animation: true,
  animationDuration: 250,
})
```

#### `panelAccessibilityStyles: string`

通用无障碍样式（focus, forced-colors, reduced-motion）。

**使用**:
```typescript
export const styles = `
${baseStyles}
/* 面板特定样式 */
${panelAccessibilityStyles.replace(/\.panel-base/g, '.my-panel')}
`
```

### 4.5 Cordis 适配器

#### `createPanelClient(config: PanelClientConfig): { name, inject, apply }`

创建 Cordis 面板客户端插件。

**配置**:
```typescript
interface PanelClientConfig {
  panelName: string
  styles: string
  slot: {
    slotName: string
    panelId: string
    order: number
    label: string
  }
  commands: ShellCommand[]
  createRender(rpc: RpcCaller): (props: unknown) => ReactNode
}
```

**示例**: 见 [创建新面板](#2-创建新面板)

### 4.6 React 钩子

#### `usePanelRequest(bus, onRequest): void`

监听面板请求。

**示例**:
```typescript
usePanelRequest(bus, (request) => {
  console.log('Panel opened:', request)
  bus.consume(request)
  setOpen(true)
})
```

#### `usePanelRpc(config): { data, loading, error, reload }`

RPC 数据加载钩子。

**配置**:
```typescript
interface UsePanelRpcConfig<TData> {
  rpc: RpcCaller
  channel: string
  endpoint: string
  payload: () => unknown
  scope: string
  onSuccess?: (data: TData) => void
  onError?: (error: string) => void
}
```

**示例**:
```typescript
const { data, loading, error, reload } = usePanelRpc<MyData>({
  rpc: props.rpc,
  channel: WORKBENCH_RPC_CHANNEL,
  endpoint: 'my.endpoint',
  payload: () => ({ sessionId: props.sessionId }),
  scope: `${props.sessionId}\u0000${props.treeRevision}`,
})
```

---

## 5. 最佳实践

### 5.1 文件命名

- ✅ **统一命名**: 所有面板使用相同的文件名
  - `index.ts`, `client.tsx`, `panel.tsx`, `requests.ts`, `messages.ts`, `styles.ts`
- ✅ **业务逻辑分离**: 复杂逻辑放在 `{panel}-view.ts`
- ❌ **避免**: 自定义文件名（如 `my-helpers.ts`），除非确实需要

### 5.2 类型安全

- ✅ **显式类型参数**: 总是为泛型函数提供类型参数
  ```typescript
  safeRpcCall<MyData>(() => ...) // 好
  safeRpcCall(() => ...) // 类型推导可能不准确
  ```

- ✅ **导出所有类型**: 供其他包使用
  ```typescript
  export type MyPanelRequest = BasePanelRequest & { ... }
  ```

- ❌ **避免 any**: 使用 `unknown` 并进行类型守卫

### 5.3 RPC 调用

- ✅ **使用 LatestRequestGate**: 防止竞态
  ```typescript
  const gate = useRef(new LatestRequestGate()).current
  const ticket = gate.begin(scope)
  const result = await safeRpcCall(...)
  if (!gate.isCurrent(ticket)) return
  ```

- ✅ **错误处理**: 总是检查 `result.ok`
  ```typescript
  if (!result.ok) {
    setError(errorMessage(result, mapper))
    return
  }
  ```

- ✅ **Scope 设计**: 包含所有影响数据的因素
  ```typescript
  const scope = `${sessionId}\u0000${treeRevision}\u0000${contentRevision}`
  ```

### 5.4 样式编写

- ✅ **使用 tokens**: 从 `dsh-editor-seats/tokens` 引用
  ```css
  color: var(--s-text);
  background: var(--s-raised);
  ```

- ✅ **无障碍优先**: 包含 `panelAccessibilityStyles`

- ✅ **响应式**: 使用媒体查询适配小屏幕
  ```css
  @media (max-width: 720px) {
    .my-panel { padding: var(--space-2); }
  }
  ```

- ❌ **避免硬编码颜色**: 不要使用 `#ffffff` 等

### 5.5 国际化

- ✅ **完整翻译**: 所有用户可见文本都要翻译
- ✅ **参数化消息**: 使用 `{param}` 插值
  ```typescript
  zh: { 'file.count': '共 {count} 个文件' }
  t('file.count', { count: 5 }) // "共 5 个文件"
  ```

- ✅ **键命名**: 使用 `category.item` 格式
  ```typescript
  'panel.title'
  'action.submit'
  'error.generic'
  ```

### 5.6 性能优化

- ✅ **React.memo**: 对大型组件使用 memo
- ✅ **useCallback**: 稳定回调引用
- ✅ **避免不必要的重渲染**: 检查 `useEffect` 依赖

### 5.7 测试

- ✅ **单元测试**: 测试请求总线、国际化等纯函数
- ✅ **手工测试**: 测试所有用户交互路径
- ✅ **视觉回归**: 截图对比确保无变化

---

## 6. 常见问题

### 6.1 如何支持 Message Cards?

**问题**: `createPanelClient` 不支持 `MESSAGE_CARDS_SERVICE` 注册。

**解决方案 1**: 保留自定义 `apply` 函数

```typescript
import { createPanelClient } from 'dsh-editor-panel-base'
import { MESSAGE_CARDS_SERVICE } from 'dsh-editor-seats'

const { name, inject, apply: baseApply } = createPanelClient({ ... })

export { name, inject }

export function apply(ctx: Context): void {
  baseApply(ctx)
  
  // 额外注册 message cards
  const client = ctx as any
  ctx.effect(() => 
    client[MESSAGE_CARDS_SERVICE].register({
      toolName: 'my_tool',
      render: ({ result, context }) => <MyCard result={result} context={context} />,
    }),
    `${name}.message-card`
  )
}
```

**解决方案 2**: 扩展 `PanelClientConfig`（待实现）

提交 PR 扩展 `panel-base` 支持 message cards。

### 6.2 如何处理复杂的业务逻辑?

**建议**: 将业务逻辑分离到 `*-view.ts` 文件。

```typescript
// src/my-view.ts
export function processData(input: RawData): ProcessedData {
  // 复杂的数据转换逻辑
}

export function validateInput(input: string): boolean {
  // 验证逻辑
}

// src/panel.tsx
import { processData, validateInput } from './my-view.ts'

function MyPanel() {
  const processed = processData(rawData)
  const isValid = validateInput(input)
  // ...
}
```

### 6.3 如何处理多个 RPC 端点?

**使用多个 `usePanelRpc` 调用**:

```typescript
const overview = usePanelRpc<Overview>({
  rpc: props.rpc,
  channel: WORKBENCH_RPC_CHANNEL,
  endpoint: 'project.overview',
  payload: () => ({ sessionId: props.sessionId }),
  scope,
})

const history = usePanelRpc<History>({
  rpc: props.rpc,
  channel: WORKBENCH_RPC_CHANNEL,
  endpoint: 'progress.history',
  payload: () => ({ sessionId: props.sessionId, days: 30 }),
  scope,
})

if (overview.loading || history.loading) return <Loading />
if (overview.error || history.error) return <Error />

return <Display overview={overview.data} history={history.data} />
```

### 6.4 如何添加快捷键?

**在命令定义中添加 `shortcut` 字段**:

```typescript
commands: [
  {
    id: 'my-panel-open',
    group: 'tools',
    label: { zh: '打开面板', en: 'Open Panel' },
    shortcut: { key: 'm', ctrl: true, shift: true }, // Ctrl+Shift+M
    when: 'always',
    run: requestMyPanel,
  },
]
```

### 6.5 如何调试面板?

**使用浏览器开发者工具**:

1. 打开 DSH Editor
2. 按 F12 或 Ctrl+Shift+I 打开开发者工具
3. 在 Console 中查看日志
4. 在 Elements 中检查 DOM 和样式
5. 在 Network 中查看 RPC 调用

**添加调试日志**:

```typescript
console.log('[MyPanel] Loading data...', { sessionId, scope })
```

### 6.6 如何处理面板关闭?

**使用 `onClose` 回调**:

```typescript
function MyPanel(props: MyPanelProps & { onClose(): void }) {
  const handleClose = () => {
    // 清理逻辑
    cleanup()
    props.onClose()
  }

  return (
    <div className="my-panel">
      <SeatButton onClick={handleClose}>关闭</SeatButton>
    </div>
  )
}
```

### 6.7 样式不生效怎么办?

**检查清单**:

- [ ] 样式是否正确注入? 检查 `<head>` 中是否有对应的 `<style>` 标签
- [ ] 类名是否正确? 确保 `.radix-themes .my-panel` 前缀
- [ ] CSS 优先级? 使用浏览器工具检查是否被覆盖
- [ ] Token 是否正确? 确保使用 `var(--s-*)` 变量

### 6.8 TypeScript 错误: 类型不匹配

**常见原因**:

1. **泛型参数缺失**: 显式提供类型参数
   ```typescript
   safeRpcCall<MyData>(() => ...) // 而非 safeRpcCall(() => ...)
   ```

2. **导入路径错误**: 确保从正确的包导入
   ```typescript
   import { createPanelI18n } from 'dsh-editor-panel-base' // 正确
   import { createPanelI18n } from './i18n.ts' // 错误
   ```

3. **类型定义缺失**: 确保 `package.json` 中有正确的 `types` 字段

---

## 7. 进阶主题

### 7.1 自定义请求类型

如果需要传递额外参数:

```typescript
export type MyPanelRequest = BasePanelRequest & {
  targetId: string
  mode: 'view' | 'edit'
}

const bus = createPanelRequestBus<MyPanelRequest>()

export const requestMyPanel = (targetId: string, mode: 'view' | 'edit') =>
  bus.request({ targetId, mode })
```

### 7.2 共享状态

如果多个面板需要共享状态,考虑:

1. **使用 Cordis Context**: 在服务端插件中注入共享服务
2. **使用 React Context**: 在应用层提供共享 Provider
3. **使用 RPC**: 通过后端同步状态

### 7.3 性能监控

添加性能计时:

```typescript
const start = performance.now()
const result = await safeRpcCall(...)
const duration = performance.now() - start
console.log(`[MyPanel] RPC took ${duration.toFixed(2)}ms`)
```

---

## 8. 资源

- [分析报告](./phase2-panel-analysis.md): 了解设计决策
- [设计文档](./phase2-panel-design.md): 架构详解
- [迁移计划](./phase2-migration-plan.md): 迁移步骤
- [DSH 文档](https://github.com/deepseek-ai/dsh): DSH 框架文档
- [Cordis 文档](https://cordis.js.org/): Cordis 插件系统

---

## 9. 获取帮助

- **Issue Tracker**: 提交 bug 或功能请求
- **Code Review**: 请求代码审查
- **Internal Chat**: 内部开发者频道

---

## 附录: 完整示例

参见 [Phase 2 迁移计划](./phase2-migration-plan.md) 中的 Memory Panel 迁移示例。
