# dsh-editor-cards

桌面私有包：人物卡与世界书。不发布；包版本 `0.1.0`，不是桌面应用 `0.2.0`。卡片文件仍在作品目录。

## 入口

- Host `editor-cards`：`/dsh-editor-cards`（`src/index.ts`）
- Client：命令展开文件树目录；钉住栏仍读卡片字段（`src/client.ts`）
- 命令：`cards-character`（Ctrl+Shift+C）、`cards-worldbook`（Ctrl+Shift+W）展开 `人物卡/` / `世界书/`
- Feature：`cards`（canonical basic / smart / full 均不选；默认关闭，可由兼容/自定义组合显式启用）

## 契约

RPC：`cards.list` / `cards.references` / `cards.metaSet` / `cards.create`（`src/contracts.ts`）。写入走 `dsh-manuscript/host-api` 的 `withWorkspaceWrite`。进程内 `./host-api` 供 workbench 校对扫描读卡片索引。座位上的 `Select` / `Dialog` 用 Shell 共享控件，缺省回退原生控件（`src/client/host-ui.ts`、`src/client/dialog.ts`）。

## 文档

[组合指南](../../docs/plugin-composition-guide.md) · [插件架构](../../docs/plugin-architecture.md) · [使用者指南](../../docs/user-guide.md)
