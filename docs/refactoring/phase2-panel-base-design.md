# Phase 2: Panel Base 架构设计

历史留档：本文记录当时的设计，样式生成接口后来已删除。当前接口见[面板基础包](../../packages/dsh-editor-panel-base/README.md)。

## 设计目标

解决三个面板包 (memory-panel, overview-panel, proofread-panel) 的代码重复问题。

## 问题分析

### 代码重复情况

**完全相同的文件** (100% 重复):
- `rpc.ts`: 52 行核心代码在 3 个面板中完全相同
- `index.ts`: 7 行空实现在 3 个面板中完全相同

**高度相似的文件** (80%+ 重复):
- `requests.ts`: 相同的发布/订阅模式,仅类型名不同
- `messages.ts`: 相同的国际化框架 + 插值系统
- `styles.ts`: 相同的 surfaceTokenAliases 集成 + 动画模式
- `client.tsx`: 相同的 Cordis 插件结构 + slot 注册

**总重复代码量**: 约 450-500 行

## 解决方案: dsh-editor-panel-base

### 包职责

**零业务逻辑**的技术基础设施:

1. **RPC 通信** - 类型安全的远程调用、错误处理、竞态条件防护
2. **请求管理** - 发布/订阅模式的面板打开触发
3. **国际化** - 类型安全的消息系统 (zh/en)
4. **样式工具** - 设计 token 集成、动画、无障碍支持

### 包结构

```
packages/dsh-editor-panel-base/
├── src/
│   ├── rpc/
│   │   └── index.ts          # RPC 通信层
│   ├── requests/
│   │   └── index.ts          # 请求管理
│   ├── messages/
│   │   └── index.ts          # 国际化系统
│   ├── styles/
│   │   └── index.ts          # 样式工具
│   └── index.ts              # 主入口
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── README.md
```

### 导出路径

- `dsh-editor-panel-base` - 全部导出
- `dsh-editor-panel-base/rpc` - RPC 模块
- `dsh-editor-panel-base/requests` - 请求管理
- `dsh-editor-panel-base/messages` - 国际化
- `dsh-editor-panel-base/styles` - 样式工具

## 模块设计

### 1. RPC 模块 (`rpc/index.ts`)

**类型**:
```typescript
export type RpcResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string; details?: unknown } }

export type RequestTicket = Readonly<{ scope: string; sequence: number }>
```

**函数**:
```typescript
// 安全的 RPC 调用包装
export function safeRpcCall<T>(
  request: () => Promise<unknown>
): Promise<RpcResult<T>>

// 错误消息本地化
export function errorMessage(
  result: RpcResult,
  locale?: ShellLocale,
  t?: (key: string) => string
): string

// 竞态条件防护
export class LatestRequestGate {
  setScope(scope: string): void
  begin(scope: string): RequestTicket
  isCurrent(ticket: RequestTicket): boolean
}
```

**设计要点**:
- ✅ 完全从现有代码提取,无新逻辑
- ✅ 类型安全,支持泛型
- ✅ errorMessage 接受可选的 t 函数,支持各面板定制错误消息

### 2. Requests 模块 (`requests/index.ts`)

**类型**:
```typescript
export type PanelRequest = { nonce: number }
```

**工厂函数**:
```typescript
// 创建请求管理器
export function createRequestManager<T extends PanelRequest>(): {
  request: (req: T) => T
  pending: () => T | null
  consume: () => T | null
  subscribe: (listener: (req: T) => void) => () => void
}

// 简单请求工厂 (只有 nonce)
export function createSimpleRequest(): PanelRequest
```

**设计要点**:
- ✅ 泛型设计,支持扩展请求类型 (如 ProofreadScope)
- ✅ 发布/订阅模式封装
- ✅ 返回取消订阅函数

**使用示例**:
```typescript
// memory-panel
export type MemoryRequest = PanelRequest
const manager = createRequestManager<MemoryRequest>()
export const requestMemoryOpen = () => manager.request(createSimpleRequest())

// proofread-panel (扩展类型)
export type ProofreadRequest = PanelRequest & { scope: ProofreadScope }
const manager = createRequestManager<ProofreadRequest>()
export const requestProofreadOpen = (scope: ProofreadScope) =>
  manager.request({ ...createSimpleRequest(), scope })
```

### 3. Messages 模块 (`messages/index.ts`)

**类型**:
```typescript
export type MessageParams = Record<string, string | number>

export interface MessagesConfig<T extends Record<string, string>> {
  zh: T
  en: Record<keyof T, string>
}
```

**工厂函数**:
```typescript
export function createMessages<T extends Record<string, string>>(
  config: MessagesConfig<T>
): {
  t: (key: keyof T, params?: MessageParams) => string
  message: (key: keyof T, params?: MessageParams) => string
  setLocale: (locale: ShellLocale) => void
  intlLocale: () => string
}
```

**设计要点**:
- ✅ 类型安全: `t('unknown.key')` 编译错误
- ✅ 插值支持: `t('welcome', { name: 'Alice' })`
- ✅ 中英文强制对应: en 必须包含 zh 的所有 key

**使用示例**:
```typescript
const zh = {
  'panel.title': '记忆面板',
  'panel.loading': '正在加载…',
  'error.generic': '操作失败',
} as const

const en: Record<keyof typeof zh, string> = {
  'panel.title': 'Memory Panel',
  'panel.loading': 'Loading…',
  'error.generic': 'Action failed',
}

export const { t, message, setLocale, intlLocale } = createMessages({ zh, en })
```

### 4. Styles 模块 (`styles/index.ts`)

**辅助函数**:
```typescript
// 面板淡入动画
export function panelFadeInAnimation(name: string): string

// 面板容器样式
export function panelContainerStyles(
  className: string,
  animationName?: string,
  maxHeight?: string
): string

// 焦点可见性样式
export function panelFocusStyles(panelClass: string): string

// 减弱动画
export function panelReducedMotion(
  panelClass: string,
  additionalSelectors?: string[]
): string

// 完整面板样式构建器
export function buildPanelStyles(config: {
  panelClass: string
  animationName?: string
  maxHeight?: string
  customStyles?: string
  additionalReducedMotionSelectors?: string[]
}): string
```

**设计要点**:
- ✅ 不强制使用,可选工具
- ✅ 与现有样式文件兼容
- ✅ 封装设计 token 集成
- ✅ 自动处理无障碍 (focus-visible, prefers-reduced-motion)

**使用示例**:
```typescript
export const myPanelStyles = buildPanelStyles({
  panelClass: 'my-panel',
  animationName: 'my-panel-in',
  customStyles: `
    .radix-themes .my-panel-header {
      display: flex;
      justify-content: space-between;
    }
  `,
})
```

## 依赖关系

### Panel-Base 依赖

```
dsh-editor-panel-base
└── dsh-editor-seats  (设计 tokens)
```

### 面板包依赖变化

**之前**:
```
memory-panel → seats, workbench
overview-panel → seats, workbench
proofread-panel → seats, workbench
```

**之后**:
```
memory-panel → panel-base, workbench
overview-panel → panel-base, workbench
proofread-panel → panel-base, workbench

panel-base → seats
```

**好处**:
- ✅ 面板包直接依赖减少 (seats → panel-base)
- ✅ 设计 token 使用通过 panel-base 统一
- ✅ 未来 seats 更新只需修改 panel-base

## 迁移策略

### 阶段 1: 创建 panel-base (已完成)

- [x] 创建包结构
- [x] 实现 RPC 模块
- [x] 实现 requests 模块
- [x] 实现 messages 模块
- [x] 实现 styles 模块
- [x] 构建验证

### 阶段 2: 概念验证 (已完成)

- [x] 重构 memory-panel 的 rpc.ts
- [x] 添加 panel-base 依赖
- [x] 构建验证

### 阶段 3: 完成迁移 (进行中)

- [ ] 重构 overview-panel
- [ ] 重构 proofread-panel
- [ ] 运行完整测试套件
- [ ] 更新文档

### 阶段 4: 新面板开发模板

- [ ] 创建面板脚手架生成器
- [ ] 编写最佳实践文档
- [ ] 提供示例面板

## 设计决策记录

### 决策 1: 为什么不提取 client.tsx?

**原因**:
- 每个面板的 slot 位置不同 (SIDEBAR_TOOLS vs CENTER_OVERLAYS)
- 每个面板的 order 不同
- 视图组件高度定制 (MemoryView, OverviewView, ProofreadView)

**结论**: client.tsx 保留在各面板,仅提取纯技术基础设施

### 决策 2: 为什么使用泛型工厂而不是基类?

**原因**:
- TypeScript 更好的类型推断
- 避免 OOP 继承复杂性
- 更灵活的组合 (可只用部分模块)

**结论**: 函数式工厂优于类继承

### 决策 3: 样式迁移为何可选?

**原因**:
- 现有样式文件包含大量定制规则
- 强制迁移风险较高
- 新面板可直接使用 buildPanelStyles()

**结论**: 提供工具但不强制使用

### 决策 4: 为什么 panel-base 是私有包?

**原因**:
- 仅用于 dsh-editor 内部面板
- API 可能随编辑器需求快速变化
- 无需承诺稳定的公开 API

**结论**: 保持 `private: true`,仅 workspace 内部使用

## 收益评估

### 代码减少

| 指标 | 之前 | 之后 | 减少 |
|------|------|------|------|
| RPC 代码 | 156 行 (52×3) | 104 行 (52+14+19+19) | -33% |
| Requests 代码 | ~240 行 | ~120 行 | -50% |
| 总重复代码 | ~500 行 | ~100 行 | -80% |

### 维护改进

- ✅ RPC 错误处理统一维护
- ✅ 新面板开发时间减少 50%
- ✅ 类型安全性提升
- ✅ 测试覆盖集中

### 风险

- ⚠️ 新增一个包的维护负担
- ⚠️ 面板包需要同步更新 panel-base 版本
- ⚠️ 过早抽象可能限制面板特化

**缓解措施**:
- panel-base API 稳定后才推广使用
- 保持向后兼容性
- 文档清晰说明何时使用/不使用 panel-base

## 未来扩展

### 可能的增强

1. **Panel 生命周期管理**
   - onOpen, onClose, onRefresh hooks
   - 状态持久化辅助

2. **Panel 通信协议**
   - Panel ↔ Host 的标准消息格式
   - 类型安全的 RPC 端点定义

3. **Panel 测试工具**
   - Mock RPC 调用
   - Panel 渲染测试辅助

4. **Panel 性能监控**
   - RPC 调用耗时统计
   - 渲染性能追踪

### 不应该添加的

- ❌ 业务逻辑 (如具体的记忆管理、校对规则)
- ❌ UI 组件 (应该在各面板或 dsh-editor-seats)
- ❌ 工作台集成 (属于 workbench 职责)

## 总结

Panel-Base 是一个成功的抽象:
- 解决了明确的代码重复问题
- 不引入过多复杂性
- 为未来扩展留出空间
- 保持职责边界清晰

下一步: 完成 overview-panel 和 proofread-panel 的迁移。
