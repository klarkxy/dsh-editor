# dsh-editor-plugins

桌面私有插件管理。核心入口锁定，不可关闭或卸载。包版本 `0.1.0`，不是桌面应用 `0.2.0`。`dshEditor.role: core`。

## 入口

- Host：`/dsh-editor-plugins`（`src/index.ts`）
- Client：`dsh-editor.settings.plugins`，设置弹窗「插件」分类（`src/client.ts`）
- 市场：GitHub `topic:dsh-plugin`（`src/github.ts`）

## 契约

可选插件按作者用途分组（写作辅助 / 校对 / 作品概览 / 人物与世界书 / 写作记忆 / 知乎资料），一组开关一次调用 `entries.setEnabled`（`src/client-groups.ts`、`src/client.ts`）。单条 `entry.setEnabled` 仍可用，内部同样走批量路径。

持久化失败时补偿恢复原状态（`src/index.ts` 的 `persistPluginState`；`src/persist.ts` 提供原子替换与错误类型）。覆盖用户自定义 `cordis` patch 前先做所有权预检：读不到或不是本管理器生成的 patch 则拒绝变更，保留配置与已装文件（`src/overlay.ts` `isOwnedManagedPatch`）。市场安装前 `marketplace.inspect` 静态检查（缺产物、抢 `root`、入口无法解析、DSH 主版本不兼容则 `blocked`）。分类与锁定读各包 `dshEditor` 与物化 `dsh-editor-catalog.json`。

## 文档

[插件架构](../../docs/plugin-architecture.md) · [组合指南](../../docs/plugin-composition-guide.md) · [使用者指南](../../docs/user-guide.md)
