# dsh-zhihu

独立知乎资料插件。普通 RPC 与可选 Tool 入口分开。插件版本 **`0.1.0`**（不是桌面应用 `0.2.0`）。DSH `0.1.5-rc.2`。凭据：DSH `ZHIHU_ACCESS_TOKEN`。禁用 `zhihu-tools` 不影响普通 RPC。

## 入口

- Host `zhihu`（feature `zhihu`）：`/zhihu`（`src/index.ts`）
- 官方 Web：`shell.overlay`（id `zhihu`，搜索 / 设置 / 用量 / 知识库）
- 桌面：`dsh-editor.settings.zhihu` 嵌入设置「知乎资料」（配置 / 用量 / 知识库 / 连接测试）。**无桌面启动器**，不注册 `dsh-editor.extensions`（`src/client.ts`）
- `zhihu-tools`（feature `zhihu-tools`，`dshEditor.inserts`）：仅 full 组合；工具名未改

桌面 full 仍启用 `zhihu` + `zhihu-tools`。basic / smart 不选这两项。

## 契约

`/zhihu`：`search`、`global.search`、`hot.list`、`ask`、`knowledge.search`、`knowledge.bases`、`knowledge.upload`、`usage.summary`。工具：`zhihu_search`、`zhihu_global_search`、`zhihu_hot_list`、`zhihu_ask`、`zhihu_knowledge_search`（`src/tools.ts`）。UI 与 Tool 共用计量 `dsh_editor_zhihu_usage`。Client 用结构型 `Select` / `Dialog`，不导入私有 Shell 包（`src/client-host-ui.ts`）。

在不含空格的目录放置 tarball 后执行：

```powershell
$packagePath = (Resolve-Path .\dsh-zhihu-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"   # dsh-zhihu-0.1.0.tgz
```

## 文档

[组合指南](../../docs/plugin-composition-guide.md) · [插件架构](../../docs/plugin-architecture.md) · [使用者指南](../../docs/user-guide.md)
