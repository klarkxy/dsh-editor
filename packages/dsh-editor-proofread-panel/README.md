# dsh-editor-proofread-panel

桌面文稿校对，默认开启。侧栏「文稿校对」、命令 `proofread-document`（Ctrl+Shift+L）扫描当前文档，命令 `proofread-manuscript` 扫描作品中全部可见 Markdown / TXT；两条命令也可从命令面板以「校对当前文档」「校对全部文档」运行。

检查标点、错别字、敏感词、重复与口癖，并给出口癖统计；不包含人物卡对照。作品级名单保存在 `.dsh-editor/敏感词.txt`，点「忽略此敏感词」会把词条写回 `.dsh-editor/敏感词-忽略.txt`。

限制：校对建议只能对 Markdown 确认后写入，TXT 需手工修改；应用建议或跳转前需先保存当前文档。

桌面使用 [dsh-proofread](../dsh-proofread/README.md) 的引擎库；普通 DSH Web 的独立校对入口由该包提供。
