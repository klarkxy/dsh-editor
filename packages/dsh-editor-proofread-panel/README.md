# dsh-editor-proofread-panel

桌面私有、仅 Client 的作品校对座位代码。Host 为空操作（`src/index.ts`）。包版本 `0.1.0`，不是桌面应用 `0.2.0`。

**当前休眠，不是活动或默认入口。** 桌面校对 UI 已暂停：`apps/desktop/resources/compositions/{basic,smart,full}.json` 均未选 feature `proofread-panel`，三份 recipe 都不装本包。顶栏、正文菜单、命令面板与快捷键的桌面校对入口已去掉。独立公开插件 `dsh-proofread` 仍是官方 Web 的 `shell.overlay`；workbench 仍依赖其引擎做 `proofread.scan`。已有作品、校对名单与结果文件保留。

## 若被装载（非默认）

- 侧栏：`dsh-editor.sidebar.tools`（id `proofread`，`src/client.ts`）
- 命令：`proofread-document`（Ctrl+Shift+L）、`proofread-manuscript`
- 扫描：`/dsh-editor-workbench` `proofread.scan`
- 作者确认：座位 `ProposalCard`；`Select` / `Dialog` 转发自座位

不要把本包写成桌面默认校对界面。

## 文档

[组合指南](../../docs/plugin-composition-guide.md) · [插件架构](../../docs/plugin-architecture.md) · [变更记录](../../CHANGELOG.md)
