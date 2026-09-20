# dsh-zhihu

独立知乎资料插件。普通 RPC 与可选 Tool 入口分开，可单独使用。包版本独立维护，当前 `0.1.0`；兼容 DSH `0.1.5-rc.2`。凭据：DSH `ZHIHU_ACCESS_TOKEN`。

## 入口

- Host `zhihu`（feature `zhihu`）：`/zhihu`（`src/index.ts`）
- 官方 Web：`shell.overlay`（id `zhihu`，搜索 / 设置 / 用量 / 知识库）
- 桌面：`dsh-editor.settings.zhihu` 嵌入设置「知乎资料」（配置 / 用量 / 知识库 / 连接测试），桌面上只有这一个入口（`src/client.ts`）
- `zhihu-tools`（feature `zhihu-tools`，`dshEditor.inserts`）：桌面组合自动加入；工具名未改

桌面 canonical recipe `desktop` 启用 `zhihu` + `zhihu-tools`；`basic` / `smart` / `full` 别名解析同一集合。

## 契约

`/zhihu`：`search`、`global.search`、`hot.list`、`ask`、`knowledge.search`、`knowledge.bases`、`knowledge.upload`、`usage.summary`。工具：`zhihu_search`、`zhihu_global_search`、`zhihu_hot_list`、`zhihu_ask`、`zhihu_knowledge_search`（`src/tools.ts`）。UI 与 Tool 共用计量 `dsh_editor_zhihu_usage`。Client 用结构型 `Select` / `Dialog`，不导入私有 Shell 包（`src/client-host-ui.ts`）。

若当前 profile 已经提供 `webSearchManager`（安装了 `dsh-web-search-manager`），Host 还会把知乎全网搜索注册为网络搜索后端（id `zhihu-global`），与「知乎资料」共用 `ZHIHU_ACCESS_TOKEN`。未安装管理插件时不注册，也不额外增加依赖。模型侧仍走官方 `web_search`；专用 `zhihu_global_search` 工具不受影响。

在不含空格的目录放置 tarball 后执行：

```powershell
$packagePath = (Resolve-Path .\dsh-zhihu-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"   # dsh-zhihu-0.1.0.tgz
```

## 文档

[使用者指南](../../docs/user-guide.md) · [产品原则](../../docs/product-principles.md)
