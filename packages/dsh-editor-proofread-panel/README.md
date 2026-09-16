# dsh-editor-proofread-panel

桌面私有、仅 Client 的中性文稿校对座位。四个 Preset 共用。Host 为空操作（`src/index.ts`）。包版本 `0.1.0`，不是桌面应用 `0.2.0`。canonical recipe `desktop` 安装（`basic` / `smart` / `full` 为兼容别名）。

## 入口

- 侧栏：`dsh-editor.sidebar.tools`（id `proofread`，`src/client.ts`）
- 命令：`proofread-document`（Ctrl+Shift+L，当前文档）、`proofread-manuscript`（全部可见 Markdown/TXT）
- Feature：`proofread-panel`（canonical recipe 已选）

## 契约

Host 走 `/dsh-editor-workbench` `proofread.scan`。顶层独立 `dsh-proofread` entry 是否 disabled 不影响本面板。范围是当前文档或全部可见 Markdown/TXT；kind 为 `punctuation` / `typo` / `sensitive` / `repeat` / `habit`，不含 `card`。作者确认用座位 `ProposalCard`；`Select` / `Dialog` 转发自座位。

## 文档

[组合指南](../../docs/plugin-composition-guide.md) · [插件架构](../../docs/plugin-architecture.md) · [变更记录](../../CHANGELOG.md)
