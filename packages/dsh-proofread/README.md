# dsh-proofread

按确定性规则检查中文文本的标点、错别字、敏感词、重复与口癖。可独立用于 DSH Web；桌面通过文稿校对面板复用引擎。

## 安装

需要 Node.js ≥22、DSH `0.1.7-alpha.1`。本包尚未发布到 npm；在仓库根运行 `pnpm build`、`pnpm pack:plugins`，从 `.pack/` 取得 tarball。

将包放在不含空格的目录，停止目标 Web profile，再在该目录执行：

```powershell
$packagePath = (Resolve-Path .\dsh-proofread-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"
dsh --profile web
```

文件名以实际打包版本为准。重启后打开「校对」，输入文本检查。

开发接口见 [src/contracts.ts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-proofread/src/contracts.ts)；桌面整部作品的扫描与名单设置见[文稿校对面板](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-editor-proofread-panel/README.md)。
