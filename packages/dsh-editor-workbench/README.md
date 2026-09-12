# dsh-editor-workbench

桌面私有、仅 Host 的作品生命周期：有界上下文、章节概览/状态、校对扫描、进度、导入、快照、移动与归档。包版本 `0.1.0`，不是桌面应用 `0.2.0`。`dshEditor.role: core`。

浏览器安全契约：`dsh-editor-workbench/contracts`。卡片 RPC 在 `dsh-editor-cards`；本包经 `dsh-editor-cards/host-api` 的 `listCards` 做校对对照。依赖 `dsh-proofread` 引擎（`./engine` / `./defaults` / `./contracts`）；三份桌面 recipe 都保留该依赖。桌面校对 UI 已停用，但 `proofread.scan` 仍在本 channel。

## 入口

- `editor-workbench`：`/dsh-editor-workbench`（锁定）
- `editor-workbench-tools`（feature `assistant`，smart / full）：`novel_overview`、`novel_memory_update`（`src/tools.ts`）

注入：`connection`、`sessions`、`workspaceRegistry`、`fs`、`sandboxPolicy`、`webServer`。根目录只从 live session 推导，复用 `dsh-manuscript/host-api`。

## 契约

端点表在 `src/contracts/channel.ts`；分发在 `src/rpc/`（`mutation` / `sessionless` / `sessionKey`）。写入（含 `chapter.statusSet` / `progress.record`）走 `withWorkspaceWrite`。`.dsh-editor/` 侧车（`chapter-status.json`、`writing-log.json`、`敏感词.txt`、`敏感词-忽略.txt`）不进快照。替换时保留 channel 与载荷，且只保留一个 `editor-workbench`。

## 文档

[插件架构](../../docs/plugin-architecture.md) · [架构](../../docs/architecture.md) · [组合指南](../../docs/plugin-composition-guide.md)
