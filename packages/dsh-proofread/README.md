# dsh-proofread

可独立安装的中文文本校对插件。不读文件、不建会话、不调用模型。插件版本 **`0.1.0`**（不是桌面应用 `0.2.0`）。DSH `0.1.5-rc.2`。

官方 Web 入口仍是 `shell.overlay`（id `proofread`，`src/client.ts`）。不注册 `dsh-editor.extensions`。桌面校对 UI 已暂停：本 Client 在桌面 profile 无 overlay 座位，不会出现启动器。三份桌面 recipe 仍因 workbench 依赖闭包装上本包，作为引擎库。

## 契约

- Host：`/proofread` → `text.check({ text, kinds? })`（`src/index.ts`、`src/contracts.ts`）
- 五种规则：`punctuation` / `sensitive` / `repeat` / `typo` / `habit`；输入 ≤2 MB UTF-8，最多 500 条；finding 为输入文本 UTF-16 下标
- `dsh-proofread/engine`：同步纯函数；作品扫描与人物卡对照由 workbench `proofread.scan` 所有
- Client 可用宿主传入的结构型 `Dialog`（`src/client-host-ui.ts`），不导入私有 Shell 包

在不含空格的目录放置 tarball 后执行：

```powershell
$packagePath = (Resolve-Path .\dsh-proofread-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"   # dsh-proofread-0.1.0.tgz
```

## 文档

[组合指南](../../docs/plugin-composition-guide.md) · [插件架构](../../docs/plugin-architecture.md) · [使用者指南](../../docs/user-guide.md)
