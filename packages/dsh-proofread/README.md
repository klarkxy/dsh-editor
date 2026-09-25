# dsh-proofread

按确定性规则检查中文文本的标点、错别字、敏感词、重复与口癖。可独立用于 DSH Web。

## 安装

需要 Node.js ≥22、DSH `0.1.7-rc.2`。本包尚未发布到 npm；在仓库根运行 `pnpm build`、`pnpm pack:plugins`，从 `.pack/` 取得 tarball。

将包放在不含空格的目录，停止目标 Web profile，再在该目录执行：

```powershell
$packagePath = (Resolve-Path .\dsh-proofread-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"
dsh --profile web
```

文件名以实际打包版本为准。重启后打开「校对」，输入文本检查。

## 使用

- 独立 DSH Web 由本包在 `shell.overlay` 座位注册的「校对」dock 启动器打开面板；桌面端的「文稿校对」侧栏由 dsh-editor-proofread-panel 提供，共用本包引擎。
- 粘贴文本后按 `Ctrl+Enter` 开始校对；每条结果给出说明与建议，可「定位原稿」或「忽略」本轮提示。
- 「口癖统计」汇总高频口癖词的出现次数；结果超过 500 条时截断并提示已达上限。
- 修改输入文本后，旧结果置灰并提示「文本已修改，以下结果对应旧版本，请重新校对」。
- 单次文本上限 2 MB，超出请分段校对。

## 引擎库

引擎不依赖 DSH 会话或模型，可直接作为库使用。`package.json` 导出 `./engine`（`proofreadText`）与 `./defaults`（内置错字表 `BUNDLED_TYPOS`、敏感词表 `BUNDLED_SENSITIVE_TEXT`、口癖词表 `HABIT_TERMS` 等）：

```ts
import { proofreadText } from 'dsh-proofread/engine'

const { findings, habitStats, truncated } = proofreadText(text, { kinds: ['punctuation', 'typo'] })
```

`kinds` 可选 `punctuation`、`typo`、`sensitive`、`repeat`、`habit`，缺省全部启用；可通过选项覆盖错字表、敏感词表与允许名单、口癖词表与阈值。结果按路径与位置排序，超出 `maxFindings` 时截断并置 `truncated`。

## 开发

- `pnpm build`：构建 lib。
- `pnpm typecheck`：类型检查。
- `pnpm test`：运行 vitest。

RPC 形状与限额常量见 [src/contracts.ts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-proofread/src/contracts.ts)。
