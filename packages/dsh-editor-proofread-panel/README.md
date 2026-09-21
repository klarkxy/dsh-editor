# dsh-editor-proofread-panel

桌面文稿校对，默认开启。侧栏「校对」、`Ctrl+Shift+L` 或命令面板可扫描当前文档，也可扫描作品中全部可见 Markdown / TXT。

检查标点、错别字、敏感词、重复与口癖，不包含人物卡对照。作品级名单保存在 `.dsh-editor/敏感词.txt`，忽略名单在 `.dsh-editor/敏感词-忽略.txt`。

桌面使用 [dsh-proofread](../dsh-proofread/README.md) 的引擎库；普通 DSH Web 的独立校对入口由该包提供。
