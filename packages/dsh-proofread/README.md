# dsh-proofread

可独立安装的中文文本校对插件。不读文件、不建会话、不调用模型。包版本 `0.1.0`，不是桌面应用 `0.2.0`。兼容 DSH `0.1.5-rc.2`。

官方 Web 入口仍是 `shell.overlay`（id `proofread`，`src/client.ts`）。不注册 `dsh-editor.extensions`。桌面文稿校对 UI 由 `dsh-editor-proofread-panel` 提供（canonical recipe `desktop` 安装，侧栏 / `Ctrl+Shift+L`）；本 Client 在桌面 profile 无 overlay 座位，不出现独立启动器。顶层本包 entry 是否 disabled 不影响该面板。桌面组合仍因 workbench 依赖闭包装上本包，作为引擎库。

## 契约

- Host：`/proofread` → `text.check({ text, kinds? })`（`src/index.ts`、`src/contracts.ts`）
- 五种规则：`punctuation` / `typo` / `sensitive` / `repeat` / `habit`，不含 `card`；输入 ≤2 MB UTF-8，最多 500 条；finding 为输入文本 UTF-16 下标
- `dsh-proofread/engine`：同步纯函数。桌面作品扫描由 workbench `proofread.scan` 所有（当前文档 / 全部可见 Markdown/TXT），供 `dsh-editor-proofread-panel` 调用
- Client 可用宿主传入的结构型 `Dialog`（`src/client-host-ui.ts`），不导入私有 Shell 包

在不含空格的目录放置 tarball 后执行：

```powershell
$packagePath = (Resolve-Path .\dsh-proofread-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"   # dsh-proofread-0.1.0.tgz
```

## 文档

[组合指南](../../docs/plugin-composition-guide.md) · [插件架构](../../docs/plugin-architecture.md) · [使用者指南](../../docs/user-guide.md)
