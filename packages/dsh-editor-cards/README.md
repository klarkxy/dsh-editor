# dsh-editor-cards

桌面可选的人物卡与世界书面板。默认关闭，在「设置 → 插件 → 人物卡与世界书」开启。

人物卡一人一份，世界书一词条一份，保存在作品的 `人物卡/`、`世界书/` Markdown 中。

## 功能

- 侧栏「卡片」入口列出两类卡片，可按姓名、别名、触发词或标签筛选，按名称、修改时间等排序。
- 「新建人物卡」「新建世界书条目」对话框把卡片写入对应目录；新建世界书默认写入 `enabled: true`、`priority: 0`、`triggers: [文件名]`，即默认参与自动注入。
- 点击卡片打开中央详情浮层编辑字段；详情内可「钉在旁边」对照阅读。不开启面板也可在文件树直接编辑，或右键「钉在旁边」。
- 引用搜索：人物卡按姓名加别名、世界书按 triggers，仅扫描 `正文/` 下的 Markdown / TXT，上限 200 条，超出时提示已达上限；命中条目可跳回正文，跳转前需先保存当前文档。

## 命令

- `cards-character`（Ctrl+Shift+C）：在文件树中展开「人物卡」目录。
- `cards-worldbook`（Ctrl+Shift+W）：在文件树中展开「世界书」目录。

## 字段与自动注入

世界书的 `triggers`、`enabled`、`priority` 控制项目上下文组装时的自动注入：`enabled: false` 的卡片跳过；用户请求、当前文档路径与已保存正文命中任一 trigger 才纳入；多条命中按 `priority` 从高到低排序，超出单条与总量上限时截断（组装逻辑见 dsh-editor-workbench 的 `src/contracts/context.ts`）。

字段定义见 [dsh-editor-workspace-kit 的 frontmatter 模块](../dsh-editor-workspace-kit/src/frontmatter.ts)；本包 [src/contracts.ts](src/contracts.ts) 只做类型重导出，并定义面板与 Host 之间的 RPC 形状。
