# dsh-editor-overview-panel

桌面私有、仅 Client 的作品概览座位。Host 为空操作（`src/index.ts`）。包版本 `0.1.0`，不是桌面应用 `0.2.0`。

## 入口

- 中栏：`dsh-editor.center.overlays`（id `overview`，`src/client.ts`）
- 命令：`overview`（Ctrl+Shift+O）
- Feature：`overview-panel`（basic / smart / full 均选）

## 契约

数据在 `/dsh-editor-workbench`：`project.overview`、`progress.history`、`chapter.statusSet`。打开时根元素带 `data-dsh-center-overlay`，由 Shell 放入稿纸格；插件不写 grid。座位 `Select` 用共享控件，缺省回退原生（`src/host-ui.ts`）。章节状态变更走 workbench RPC，刷新用座位 `refresh('overview'|'tree')`。

## 文档

[插件架构](../../docs/plugin-architecture.md) · [使用者指南](../../docs/user-guide.md)
