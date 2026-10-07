# DSH Editor 架构重构方案

历史留档：本文记录 2026-10-06 的阶段方案，后续简化已替代其中部分接口与拆包建议。当前边界见[架构决策](../architecture.md)与[包目录](../../packages/README.md)。

**日期**: 2026-10-07
**状态**: Phase 0 职责目录重组已完成，Phase 1 面板公共基础实施完成，本次重构独立验收通过
**分支**: `refactor/phase2-panel-base`
**基线提交**: `62a2b01`

> **说明**: 任务开始时已有未提交工作区改动，基线提交不等于初始工作区快照。

---

## 重构目标

1. **重复模式统一** - 消除面板间的重复代码
2. **职责边界明确** - 建立清晰的包职责分层
3. **保持产品信任边界** - 不改变 DSH、Workbench、Shell 的权限与审批契约

---

## 已完成阶段

### Phase 0: Workbench 内部目录重组

**状态**: 已合入主干

将 Workbench 平坦文件结构重组为职责子目录。本次补充移动漏掉的测试文件和工具入口路径。

### Phase 1: 面板公共基础

**状态**: 实施完成，本次重构独立验收通过

创建 `dsh-editor-panel-base` 包，提取三个面板的公共 RPC 请求与国际化工厂。

#### 实施范围

- **`dsh-editor-panel-base`**
  提供 RPC 请求工厂、国际化工厂，保留各面板的词典、旧函数签名和本地化格式。
  作为构建内联开发依赖，而非运行时插件。

- **三个面板** (`memory-panel`, `overview-panel`, `proofread-panel`)
  使用 `panel-base` 的公共工厂，保留各自的 `styles/`、`client.tsx` 和领域适配逻辑（如 memory 卡片）。

#### 能力所有者

| 包 | 职责 |
|---|---|
| **DSH** | 会话、模型、权限、审批、运行时状态、对话历史 |
| **Workbench** | 稿件、提案、记忆、概览、校对、快照；`index.ts` 统一 RPC 权限、写队列、错误映射；`tools` 由 `novel-kernel` 公开入口调用 |
| **Shell** | 稿纸 UI 与宿主展示适配 |
| **panel-base** | 纯公共模式，不包含领域逻辑 |
| **各面板** | UI 消费 Workbench RPC |

#### Message Cards 实现

Message Cards 是由 Editor 宿主提供的扩展注册表。

- **Seats**: 声明 `MESSAGE_CARDS_SERVICE = 'dshEditorMessageCards'` 及合同
- **Shell**: `src/client.ts` 创建服务并通过 `ctx.provide` 注册表
- **memory-panel**: `client.tsx` 注册 `card.tsx` 渲染实现
- **Workbench**: 提供数据

> **说明**: DSH 对话历史与 Workbench 稿件快照是不同概念。Shell `client/history-dialog.tsx` 消费 `SnapshotResponse`，Workbench `rpc/snapshot.ts` 对接 `lifecycle/snapshot`；`writing-log` 是写作进度统计历史，不是快照。

#### 已决策事项

取消无必要性证据的 Workbench 六包拆分和 Shell 强制拆包。当前不排定 Phase 2/3 实施，真实复用需求、独立发布需求或隔离需求出现时才重新评估。

---

## 验收入口

- [实施与验收记录](./implementation-report.md)
- [包级 README](../../packages/README.md)

---

## 回滚方案

若需回滚本次改动：

1. 备份当前所有已跟踪和未跟踪内容
2. 根据任务起点工作区记录，识别并选择性反向本次改动，保留已有的用户 RPC、package 修改，以及原有未跟踪的 base/docs 和目录迁移路径修正
3. 重新安装依赖、构建、类型检查、测试
4. 本次任务不执行回滚

---

## 相关文档

- [实施与验收记录](./implementation-report.md)
- [重构文档索引](./README.md)
