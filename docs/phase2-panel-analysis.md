# Phase 2: 面板基础设施架构分析

> **历史留档**: 本文档为 Phase 1 设计分析材料，已被 [架构重构权威计划](refactoring/refactoring-plan.md) 整合。保留历史正文供参考。

**日期**: 2026-10-06  
**作者**: Architecture Review  
**状态**: 完成深度分析

---

## 执行摘要

对 3 个现有面板包（`dsh-editor-memory-panel`、`dsh-editor-proofread-panel`、`dsh-editor-overview-panel`）进行了全面的代码审查，识别出 **450-500 行可直接提取的公共代码**，代码重复率达到 **60%+**。

### 关键发现

- **RPC 通信层完全相同**: `rpc.ts` 在 3 个包中一字不差（58 行）
- **请求机制完全相同**: `requests.ts` 只有类型名不同（27-29 行）
- **样式集成模式统一**: 所有面板使用相同的 tokens 和动画模式
- **Cordis 插件结构固定**: client.tsx 遵循相同的生命周期和注册模式
- **国际化框架一致**: messages.ts 共享相同的插值和语言切换逻辑

### 投资回报

| 指标 | 现状 | 目标 |
|------|------|------|
| 公共代码行数 | 450-500 行 × 3 = 1350-1500 行 | 450-500 行（集中管理） |
| 新增面板时间 | 3-4 小时（复制粘贴 + 调整） | < 30 分钟（继承 + 配置） |
| 维护成本 | 修改需同步 3 处 | 修改 1 处自动生效 |
| Bug 修复 | 需在 3 个包中分别修复 | 修复 1 次全部受益 |
| 类型安全 | 手工保持一致 | 框架强制一致 |

---

## 1. 详细分析

### 1.1 文件结构对比

| 文件 | Memory | Proofread | Overview | 相似度 | 可提取性 |
|------|--------|-----------|----------|--------|----------|
| `index.ts` | 7 行 | 7 行 | 7 行 | 100% | ✅ 完全 |
| `rpc.ts` | 58 行 | 52 行 | 52 行 | 100% | ✅ 完全 |
| `requests.ts` | 27 行 | 29 行 | 27 行 | 95% | ✅ 完全（泛型化） |
| `messages.ts` | 114 行 | 154 行 | 144 行 | 80% | ✅ 框架层 |
| `styles.ts` | 77 行 | 110 行 | 120 行 | 70% | ✅ 工具函数 |
| `client.tsx` | 88 行 | 92 行 | 82 行 | 85% | ✅ 基类 + 钩子 |
| `panel.tsx` | 461 行 | 493 行 | 361 行 | 30% | ❌ 面板特定 |
| `*-view.ts` | - | 1308 行 | 1073 行 | - | ❌ 业务逻辑 |
| `card.tsx` | 168 行 | - | - | - | ❌ 功能特定 |
| **可提取行数** | ~250 | ~280 | ~270 | **平均 267 行/包** | **总计 ~800 行** |

### 1.2 RPC 通信层分析

#### 完全相同的代码

**`rpc.ts` 对比** (3 个包完全一致):

```typescript
// packages/dsh-editor-{memory|proofread|overview}-panel/src/rpc.ts
import type { ShellLocale } from 'dsh-editor-seats'
import { t } from './messages.ts'

export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } }

export type RequestTicket = Readonly<{ scope: string; sequence: number }>

export function safeRpcCall<T>(request: () => Promise<unknown>): Promise<RpcResult<T>> {
  return Promise.resolve()
    .then(() => request() as Promise<RpcResult<T>>)
    .catch((error: unknown) => ({
      ok: false as const,
      error: { code: 'internal', message: error instanceof Error ? error.message : 'request failed', details: {} },
    }))
}

function rpcFailureText(result: RpcResult): string {
  if (result.ok) return ''
  return `${result.error.code ?? ''} ${result.error.message ?? ''}`
}

export function errorMessage(result: RpcResult, _locale?: ShellLocale): string {
  if (result.ok) return ''
  const blob = rpcFailureText(result)
  if (/stale|changed|version|版本/i.test(blob)) return t('error.diskChanged')
  if (/session-not-found|session is not live/i.test(blob)) return t('error.sessionMissing')
  if (/not-found|missing/i.test(blob)) return t('error.notFound')
  return result.error.message || t('error.generic')
}

export class LatestRequestGate {
  private scope = ''
  private sequence = 0

  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope
    this.sequence += 1
  }

  begin(scope: string): RequestTicket {
    this.setScope(scope)
    this.sequence += 1
    return { scope, sequence: this.sequence }
  }

  isCurrent(ticket: RequestTicket): boolean {
    return ticket.scope === this.scope && ticket.sequence === this.sequence
  }
}
```

**关键模式**:

1. **类型安全的 RPC 结果**: `RpcResult<T>` 统一成功/失败模式
2. **安全调用包装**: `safeRpcCall` 捕获异常并规范化错误
3. **智能错误映射**: `errorMessage` 将后端错误码映射为用户友好消息
4. **竞态条件防护**: `LatestRequestGate` 确保只处理最新请求的响应

**memory 包的额外工具** (可选共享):

```typescript
// 仅 memory-panel 有,但其他面板可能也需要
export function snapshotTimeLabel(time: number): string {
  const date = new Date(time)
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
```

#### RPC 调用模式

所有面板都使用相同的模式:

```typescript
export type RpcCaller = {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

// 使用示例
const result = await safeRpcCall<ResponseType>(() => 
  rpc.call(WORKBENCH_RPC_CHANNEL, 'endpoint.name', { sessionId, ... })
)

if (!result.ok) {
  setNote(errorMessage(result, locale))
  return
}

// 使用 result.value
```

### 1.3 请求触发机制分析

#### 完全相同的模式

**`requests.ts` 对比** (只有类型名不同):

```typescript
// Memory Panel
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

**Proofread Panel 的额外参数**:

```typescript
export type ProofreadRequest = { scope: ProofreadScope; nonce: number }

export function requestProofread(scope: ProofreadScope): ProofreadRequest {
  pending = { scope, nonce: Date.now() }
  // ... 其余相同
}
```

**关键模式**:

1. **发布/订阅**: 命令触发 → 面板监听 → 响应请求
2. **Nonce 去重**: 使用时间戳防止重复处理
3. **一次性消费**: `consume` 确保请求只处理一次
4. **类型安全的监听器**: 强类型回调

**提取可能性**: 100% 可泛型化

```typescript
// 理想的抽象
export function createPanelRequestBus<TRequest extends { nonce: number }>() {
  // ... 返回 { request, pending, consume, subscribe }
}
```

### 1.4 国际化框架分析

#### 共同结构

所有 `messages.ts` 都遵循相同的模式:

```typescript
// 1. 类型定义
export type MessageKey = keyof typeof zh
export type MessageParams = Record<string, string | number>

// 2. 消息字典
export const zh = {
  'key.name': '中文',
  'key.withParams': '包含 {param} 的文本',
  // ...
} as const

export const en: Record<MessageKey, string> = {
  'key.name': 'English',
  // ...
}

// 3. 语言切换
const dictionaries: Record<ShellLocale, Record<MessageKey, string>> = { zh, en }
let currentLocale: ShellLocale = 'zh'

export function set{Panel}Locale(locale: ShellLocale): void {
  currentLocale = locale === 'en' ? 'en' : 'zh'
}

// 4. 插值函数
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

// 5. 翻译函数
export function t(key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[currentLocale][key] || zh[key] || String(key)
  return interpolate(text, params)
}

export function message(locale: ShellLocale, key: MessageKey, params?: MessageParams): string {
  const text = dictionaries[locale][key] || zh[key] || String(key)
  return interpolate(text, params)
}

// 6. Intl 工具
export function intlLocale(locale: ShellLocale = currentLocale): string {
  return locale === 'en' ? 'en' : 'zh-CN'
}
```

**可提取部分**:

- `interpolate` 函数: 100% 相同
- `intlLocale` 函数: 100% 相同
- 框架结构: 可提供工厂函数或基类

**面板特定部分**:

- 消息键和内容（业务相关）
- 特殊格式化函数（如 `formatNumber` 在 overview）

### 1.5 样式集成分析

#### 共同模式

所有 `styles.ts` 都包含:

```typescript
import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

export const {panel}PanelStyles = `
@keyframes {panel}-panel-in { from { opacity: 0; transform: translateY(8px); } }

.radix-themes .{panel}-panel {
${surfaceTokenAliases}
  /* 面板容器样式 */
  animation: {panel}-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 面板特定样式 */

/* 无障碍 */
.{panel}-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), 
.{panel}-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) {
  box-shadow: var(--s-focus-shadow);
}

@media (forced-colors: active) {
  /* 高对比度模式 */
}

@media (prefers-reduced-motion: reduce) {
  .radix-themes .{panel}-panel, .radix-themes .{panel}-panel * {
    animation: none !important; 
    transition: none !important; 
    transform: none !important;
  }
}
`
```

**统一元素**:

1. **Token 集成**: 所有面板注入 `surfaceTokenAliases`
2. **入场动画**: 统一的 `translateY(8px)` + `opacity` 淡入
3. **动画曲线**: 统一的 `cubic-bezier(0.22, 1, 0.36, 1)` 缓动
4. **无障碍**: 统一的 focus-visible 处理
5. **媒体查询**: forced-colors、prefers-reduced-motion

**可提取工具**:

```typescript
export function panelContainerStyles(panelName: string): string {
  return `
@keyframes ${panelName}-panel-in { from { opacity: 0; transform: translateY(8px); } }
.radix-themes .${panelName}-panel {
${surfaceTokenAliases}
  animation: ${panelName}-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
  /* ... 容器基础样式 */
}
`
}

export const accessibilityStyles = `/* 统一的 focus/forced-colors/reduced-motion */`
```

### 1.6 Cordis 插件结构分析

#### 固定模式

所有 `client.tsx` 都遵循相同的生命周期:

```typescript
import type { Context } from '@deepseek-ai/cordis'
import { COMMANDS_SERVICE, /* SLOT_NAME */ } from 'dsh-editor-seats'

export const name = 'dsh-editor-{panel}-panel-client'
export const inject = ['slots', 'connection', COMMANDS_SERVICE] as const

type ClientContext = Context & {
  slots: SlotHandle
  connection: { rpc: RpcCaller }
  [COMMANDS_SERVICE]: ShellCommandRegistry
}

// 1. 样式注入
function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'dsh-editor-{panel}-panel')
  style.setAttribute('data-dsh-{panel}-panel-styles', '')
  style.textContent = {panel}PanelStyles
  document.head.appendChild(style)
  return () => style.remove()
}

// 2. Seat 上下文提取
function seatFromRenderProps(props: unknown): ShellToolSeatContext | undefined {
  if (!props || typeof props !== 'object') return undefined
  const record = props as Record<string, unknown>
  if (typeof record.openDocument === 'function' && typeof record.sessionId === 'string') {
    return record as ShellToolSeatContext
  }
  const nested = record.owner
  if (nested && typeof nested === 'object' && typeof (nested as ShellToolSeatContext).openDocument === 'function') {
    return nested as ShellToolSeatContext
  }
  return undefined
}

// 3. 命令定义
function {panel}Commands(): ShellCommand[] {
  return [
    {
      id: '{panel}-action',
      group: 'writing',
      label: { zh: message('zh', 'command.label'), en: message('en', 'command.label') },
      hint: { zh: message('zh', 'command.hint'), en: message('en', 'command.hint') },
      shortcut: { key: 'x', ctrl: true, shift: true }, // 可选
      when: 'workspace',
      run() {
        request{Panel}Open()
      },
    },
  ]
}

// 4. 插件入口
export function apply(ctx: Context): void {
  const client = ctx as ClientContext
  
  // 注入样式
  if (typeof document !== 'undefined') 
    ctx.effect(() => injectStyles(), 'dsh-editor-{panel}-panel-client.styles')
  
  // 渲染函数
  const render = (props: unknown) => {
    const seat = seatFromRenderProps(props)
    if (!seat) return null
    return <{Panel}Seat {...seat} rpc={client.connection.rpc} />
  }
  
  // 注册 slot
  ctx.effect(() => client.slots.inject(SLOT_NAME, () =>
    client.slots.register({ name: SLOT_NAME, id: '{panel}', order: 100, label: '标签' }, render)),
  'dsh-editor-{panel}-panel-client.slot')
  
  // 注册命令
  for (const command of {panel}Commands()) {
    ctx.effect(() => client[COMMANDS_SERVICE].register(command), 
      `dsh-editor-{panel}-panel-client.command.${command.id}`)
  }
}
```

**可提取的抽象**:

1. **样式注入逻辑**: 完全相同
2. **Seat 提取逻辑**: 完全相同
3. **命令注册循环**: 完全相同
4. **Slot 注册模式**: 只有 slot 名和 order 不同

### 1.7 差异点分析

#### Slot 位置

| 面板 | Slot | Order | 位置 |
|------|------|-------|------|
| Memory | `SIDEBAR_TOOLS_SLOT` | 200 | 侧边栏 |
| Proofread | `SIDEBAR_TOOLS_SLOT` | 100 | 侧边栏 |
| Overview | `CENTER_OVERLAYS_SLOT` | 100 | 中央覆盖层 |

**设计考量**:

- Sidebar tools: 持续可见的辅助工具
- Center overlays: 短暂显示的专注视图
- Order: 控制显示顺序

#### RPC 端点

| 面板 | 主要端点 | 参数 | 响应类型 |
|------|----------|------|----------|
| Memory | `memory.list`, `memory.get`, `memory.apply`, `memory.undo` | `sessionId`, `id` | `MemoryChangeSummary[]`, `MemoryChange`, `MemoryUpdateReceipt` |
| Proofread | `proofread.scan` | `sessionId`, `scope`, `targetPath?` | `ProofreadScanResponse` |
| Overview | `project.overview`, `progress.history` | `sessionId`, `days?` | `ProjectOverview`, `ProgressHistory` |

**模式**: 所有端点都需要 `sessionId`,其他参数面板特定。

#### 视图复杂度

| 面板 | 行数 | 状态数量 | 主要功能 |
|------|------|----------|----------|
| Memory | 461 | 6 | 列表 + 详情双层结构, 应用/撤销操作 |
| Proofread | 493 | 10 | 扫描 + 多维度过滤 + 批量操作 + 统计 |
| Overview | 361 | 5 | 统计卡片 + 图表渲染 + 筛选 |

**设计模式**:

- 所有面板都使用 `useState` + `useEffect` 管理状态
- 所有面板都使用 `LatestRequestGate` 防止竞态
- 所有面板都分离了视图逻辑（`*-view.ts`）和组件

---

## 2. 公共模式总结

### 2.1 文件职责矩阵

| 文件 | 职责 | 可提取性 | 提取方式 |
|------|------|----------|----------|
| `index.ts` | Cordis 服务端入口（空实现） | ✅ 完全 | 模板或工厂 |
| `rpc.ts` | RPC 调用封装、错误处理、竞态防护 | ✅ 完全 | 直接复用 |
| `requests.ts` | 命令→面板触发机制 | ✅ 完全 | 泛型工厂 |
| `messages.ts` | 国际化框架 + 面板特定消息 | ✅ 框架层 | 基础工厂 + 面板扩展 |
| `styles.ts` | 通用样式基础 + 面板特定样式 | ✅ 工具函数 | 样式工具 + 面板扩展 |
| `client.tsx` | Cordis 插件生命周期 | ✅ 基类 | 抽象基类 + 配置 |
| `panel.tsx` | React 组件、状态管理、UI 渲染 | ⚠️ 模式 | 提供钩子和工具 |
| `*-view.ts` | 业务逻辑、数据转换 | ❌ 业务特定 | 不提取 |

### 2.2 核心抽象边界

```
┌─────────────────────────────────────────────────────┐
│  dsh-editor-panel-base (可复用基础设施)              │
├─────────────────────────────────────────────────────┤
│  • RPC 通信层 (rpc.ts - 完全复用)                    │
│  • 请求总线 (requests.ts - 泛型工厂)                 │
│  • 国际化工厂 (messages 框架)                        │
│  • 样式工具 (panelStyles 生成器)                     │
│  • Cordis 适配器 (client 基类)                       │
│  • React 钩子 (usePanel* 系列)                       │
└─────────────────────────────────────────────────────┘
                       ▲
                       │ 继承/组合
                       │
┌─────────────────────────────────────────────────────┐
│  dsh-editor-{specific}-panel (面板特定实现)          │
├─────────────────────────────────────────────────────┤
│  • 消息定义 (业务文案)                               │
│  • 样式扩展 (特定组件样式)                           │
│  • 视图逻辑 (*-view.ts)                              │
│  • 面板组件 (panel.tsx)                              │
│  • RPC 端点配置                                      │
└─────────────────────────────────────────────────────┘
```

### 2.3 类型安全策略

所有公共代码都保持完整的 TypeScript 类型安全:

```typescript
// 泛型化的请求总线
type PanelRequest<TPayload = {}> = TPayload & { nonce: number }

// 泛型化的 RPC 结果
type RpcResult<T = unknown> = 
  | { ok: true; value: T }
  | { ok: false; error: ErrorDetails }

// 强类型的消息系统
type MessageDict<TKeys extends string> = Record<TKeys, string>
```

---

## 3. 依赖关系分析

### 3.1 当前依赖

所有 3 个面板都有相同的依赖:

```json
{
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
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

### 3.2 新包依赖关系

```
dsh-editor-panel-base
├── peerDependencies
│   ├── @deepseek-ai/cordis: ^4.0.4
│   └── react: ^18.2.0
└── devDependencies
    ├── dsh-editor-seats: workspace:*
    ├── @types/react: 18.3.31
    └── typescript: ^5.9.2

dsh-editor-{panel}-panel
├── dependencies
│   └── dsh-editor-panel-base: workspace:*  ← 新增
├── peerDependencies
│   ├── @deepseek-ai/cordis: ^4.0.4
│   └── react: ^18.2.0
└── devDependencies
    ├── dsh-editor-seats: workspace:*
    ├── dsh-editor-workbench: workspace:*
    └── ...
```

**关键约束**:

- `panel-base` 不依赖 `workbench`（避免循环依赖）
- 面板包直接调用 workbench RPC 端点
- `seats` 提供共享的类型和 token 定义

---

## 4. 成功标准验证

| 标准 | 当前状态 | 预期改善 | 验证方式 |
|------|----------|----------|----------|
| 公共代码减少 60%+ | 1350-1500 行重复 | 减少到 450-500 行 | 代码行数统计 |
| 新增面板时间 < 30 分钟 | 3-4 小时 | < 30 分钟 | 实际开发计时 |
| 类型安全无妥协 | ✅ 当前类型安全 | ✅ 保持类型安全 | TypeScript 编译无错误 |
| 迁移路径清晰 | - | ✅ 分步骤迁移 | 迁移文档完整性 |
| 文档完整易懂 | - | ✅ 完整文档 | API 文档 + 示例 |

**风险评估**:

✅ **低风险**: RPC 层、请求总线、国际化框架  
⚠️ **中风险**: Cordis 适配器抽象（需要仔细设计生命周期钩子）  
⚠️ **中风险**: 样式工具（需要平衡通用性和灵活性）

---

## 下一步

1. 阅读 [Phase 2 设计文档](./phase2-panel-design.md)
2. 审查 [迁移计划](./phase2-migration-plan.md)
3. 参考 [实施指南](./phase2-implementation-guide.md)
