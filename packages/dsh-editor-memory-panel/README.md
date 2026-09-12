# dsh-editor-memory-panel

桌面私有、仅 Client 的记忆维护座位。Host 为空操作（`src/index.ts`）。包版本 `0.1.0`，不是桌面应用 `0.2.0`。

## 入口

- 侧栏：`dsh-editor.sidebar.tools`（id `memory`，`src/client.ts`）
- 命令：`memory-open`
- Chat 回执卡：`dshEditorMessageCards` 注册 `novel_memory_update`（`src/card.ts`）
- Feature：`memory-panel`（basic / smart / full 均选）

## 契约

数据在 `/dsh-editor-workbench`：`memory.list` / `memory.get` / `memory.apply` / `memory.undo`。面板转发座位上的 `Select` / `Dialog`。应用或撤销后仍保持当前展开条目（`src/panel.ts` 在 `load()` 后保留仍存在的 `openId`），刷新走座位 `onApplied` / `refresh`，不自行写作者正文。

## 文档

[插件架构](../../docs/plugin-architecture.md) · [使用者指南](../../docs/user-guide.md)
