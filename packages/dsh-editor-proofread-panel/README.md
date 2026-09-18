# dsh-editor-proofread-panel

文稿校对侧栏面板。私有包，只随桌面应用交付，默认安装；可在设置「插件」里开关「文稿校对」。

- **用途**：扫描当前稿纸或全部可见 `.md` / `.txt`，按五类列出问题——标点、错别字、敏感词、重复、口癖；支持追加作品级敏感词与忽略名单。
- **工作方式**：扫描调用 `dsh-editor-workbench` 的 `proofread.scan`，引擎来自 `dsh-proofread` 的纯函数库；因此桌面上独立的 `dsh-proofread` 插件入口保持关闭，两者互不影响。
- **数据**：名单写在作品目录 `.dsh-editor/敏感词.txt`、`敏感词-忽略.txt`。

声明见 `package.json` 的 `dshEditor`（feature `proofread-panel`）。
