# Phase 2: Panel Base 提取 - 迁移指南

历史留档：本文记录当时的迁移方案，`buildPanelStyles` 等无生产消费者接口后来已删除。当前接口见[面板基础包](../../packages/dsh-editor-panel-base/README.md)。

## 概述

Phase 2 创建了 `dsh-editor-panel-base` 包,提取了三个面板包的公共基础设施。

## 已完成的工作

### 1. 创建 dsh-editor-panel-base 包

**位置**: `packages/dsh-editor-panel-base/`

**提供的模块**:
- `rpc/` - RPC 通信层 (safeRpcCall, errorMessage, LatestRequestGate)
- `requests/` - 请求管理 (发布/订阅模式)
- `messages/` - 国际化系统 (类型安全的消息管理)
- `styles/` - 样式工具 (设计 token 集成、动画、无障碍)

**构建状态**: ✅ 成功 (10 个文件, 19.63 kB)

### 2. 重构 memory-panel (概念验证)

**文件**: `packages/dsh-editor-memory-panel/src/rpc.ts`

**变化**:
- 从 58 行减少到 14 行 (-76%)
- 删除了重复的 RPC 类型和函数
- 保留了面板特有的 `snapshotTimeLabel` 函数
- 添加了 `dsh-editor-panel-base` 依赖

**代码对比**:

```typescript
// 之前: 58 行本地实现
export type RpcResult<T = unknown> = ...
export function safeRpcCall<T>(...) { ... }
export function errorMessage(...) { ... }
export class LatestRequestGate { ... }
export function snapshotTimeLabel(...) { ... }

// 之后: 14 行,重用公共代码
export {
  safeRpcCall,
  errorMessage,
  LatestRequestGate,
  type RpcResult,
  type RequestTicket,
} from 'dsh-editor-panel-base/rpc'

export function snapshotTimeLabel(time: number): string {
  // 面板特有的工具函数
}
```

## 下一步: 完成 Phase 2

### 剩余任务

1. **迁移 overview-panel**
   - 重构 `rpc.ts` (52 行 → ~8 行)
   - 重构 `requests.ts` 使用泛型工厂
   - 添加 panel-base 依赖

2. **迁移 proofread-panel**
   - 重构 `rpc.ts` (52 行 → ~8 行)
   - 重构 `requests.ts` (处理 ProofreadScope 扩展)
   - 添加 panel-base 依赖

3. **样式迁移 (可选)**
   - 评估使用 `buildPanelStyles()` 辅助函数
   - 可保留当前定制样式,仅在新面板使用

4. **运行完整测试**
   ```bash
   pnpm install          # 链接 workspace 依赖
   pnpm -r build         # 构建所有包
   pnpm -r typecheck     # 类型检查
   pnpm -r test          # 运行测试
   ```

## 预期收益

### 代码减少量

| 文件 | Memory | Overview | Proofread | 总计 |
|------|--------|----------|-----------|------|
| `rpc.ts` | -44 行 | -44 行 | -44 行 | -132 行 |
| `requests.ts` | -30 行 | -30 行 | -35 行 | -95 行 |
| 总计 | -74 行 | -74 行 | -79 行 | **-227 行** |

### 维护改进

- ✅ RPC 错误处理统一维护
- ✅ 请求管理模式一致
- ✅ 新面板开发更快 (复制模板 → 使用库)
- ✅ 类型安全性提升

## 迁移步骤模板

### 对于 overview-panel 和 proofread-panel:

1. **添加依赖**
   ```json
   // package.json
   "devDependencies": {
     "dsh-editor-panel-base": "workspace:*",
     ...
   }
   ```

2. **重构 rpc.ts**
   ```typescript
   export {
     safeRpcCall,
     errorMessage,
     LatestRequestGate,
     type RpcResult,
     type RequestTicket,
   } from 'dsh-editor-panel-base/rpc'
   
   // 保留面板特有的函数 (如果有)
   ```

3. **重构 requests.ts**
   ```typescript
   import { createRequestManager, createSimpleRequest } from 'dsh-editor-panel-base/requests'
   
   export type OverviewRequest = { nonce: number }
   
   const manager = createRequestManager<OverviewRequest>()
   
   export function requestOverviewOpen(): OverviewRequest {
     return manager.request(createSimpleRequest())
   }
   
   export const pendingOverviewRequest = manager.pending
   export const consumeOverviewRequest = manager.consume
   export const subscribeOverviewRequest = manager.subscribe
   ```

4. **验证构建**
   ```bash
   cd packages/dsh-editor-{panel}-panel
   pnpm build
   ```

## 注意事项

1. **ProofreadScope 差异**: proofread-panel 的请求类型包含 `scope: ProofreadScope`,需要提供工厂函数:
   ```typescript
   export function requestProofreadOpen(scope: ProofreadScope): ProofreadRequest {
     return manager.request({ scope, nonce: Date.now() })
   }
   ```

2. **样式迁移谨慎**: 当前样式文件包含大量定制规则,不强制迁移到 `buildPanelStyles()`。新面板或大规模重构时再使用。

3. **测试覆盖**: 迁移后运行面板的所有功能测试,确保行为不变。

## Phase 2 完成标准

- [x] 创建 dsh-editor-panel-base 包
- [x] 实现 RPC 模块
- [x] 实现 requests 模块
- [x] 实现 messages 模块
- [x] 实现 styles 模块
- [x] 重构 memory-panel (概念验证)
- [ ] 重构 overview-panel
- [ ] 重构 proofread-panel
- [ ] 所有包构建成功
- [ ] 所有测试通过
- [ ] 更新 packages/README.md

## 相关文档

- [Phase 2 架构设计](./phase2-panel-base-design.md)
- [面板基础重构实施与验收记录](./implementation-report.md)
- [总体重构计划](./refactoring-plan.md)
