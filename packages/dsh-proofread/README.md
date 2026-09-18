# dsh-proofread

可独立安装的中文文本校对插件：输入一段文本，按确定性规则返回问题列表。包版本独立维护，当前 `0.1.0`；兼容 DSH `0.1.5-rc.2`。

官方 Web 入口是 `shell.overlay`（id `proofread`，`src/client.ts`）。桌面上的文稿校对由 `dsh-editor-proofread-panel` 提供（侧栏 / `Ctrl+Shift+L`），扫描走 workbench 的 `proofread.scan`；本包在桌面 profile 里只作为引擎库。

## 契约

- Host：`/proofread` → `text.check({ text, kinds? })`（`src/index.ts`、`src/contracts.ts`）
- 五种规则：`punctuation` / `typo` / `sensitive` / `repeat` / `habit`；输入 ≤2 MB UTF-8，最多 500 条；finding 为输入文本 UTF-16 下标
- `dsh-proofread/engine`：同步纯函数。桌面作品扫描由 workbench `proofread.scan` 所有（当前文档 / 全部可见 Markdown/TXT），供 `dsh-editor-proofread-panel` 调用
- Client 可用宿主传入的结构型 `Dialog`（`src/client-host-ui.ts`），不导入私有 Shell 包

在不含空格的目录放置 tarball 后执行：

```powershell
$packagePath = (Resolve-Path .\dsh-proofread-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"   # dsh-proofread-0.1.0.tgz
```

## 文档

[使用者指南](../../docs/user-guide.md) · [产品原则](../../docs/product-principles.md)
