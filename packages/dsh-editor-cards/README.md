# dsh-editor-cards

人物卡与世界书扩展。私有包，只随桌面应用交付，默认不安装；作者在设置「插件」里打开「人物与世界书」后启用。

- **用途**：把作品目录里的 `人物卡/`、`世界书/` Markdown 呈现为带结构的卡片列表，支持 frontmatter 字段编辑、按名字/别名/触发词的引用导航，以及从侧栏新建卡片。
- **入口**：Host RPC `/dsh-editor-cards`（`src/index.ts`）；Client 通过 shell 的侧栏与中栏座位接入。
- **数据**：卡片文件始终是作品目录里的普通 Markdown，本包只读写字段与列表。

声明见 `package.json` 的 `dshEditor`（feature `cards`）。
