# dsh-editor-cards

桌面可选的人物卡与世界书文件导航命令。默认关闭，在「设置 → 插件 → 人物卡与世界书」开启。

人物卡一人一份，世界书一词条一份，保存在作品的 `人物卡/`、`世界书/` Markdown 中。通过文件树创建、打开和编辑，使用稿纸保存；也可右键「钉在旁边」对照阅读。

## 命令与入口

- `cards-character`（Ctrl+Shift+C）：在文件树中展开并定位「人物卡」目录。
- `cards-worldbook`（Ctrl+Shift+W）：在文件树中展开并定位「世界书」目录。

`./client` 向宿主命令注册表添加这两个工作区命令；根入口保留 Cordis 插件发现，不注册 RPC。该包不提供单独的列表、详情、创建或字段编辑面板，也不提供 `./host-api` 或 `./contracts` 导出。

## 字段与自动注入

世界书的 `triggers`、`enabled`、`priority` 控制项目上下文组装时的自动注入：`enabled: false` 的卡片跳过；用户请求、当前文档路径与已保存正文命中任一 trigger 才纳入；多条命中按 `priority` 从高到低排序，超出单条与总量上限时截断。组装逻辑见 [工作台 context 模块](../dsh-editor-workbench/src/contracts/context.ts)。

字段定义与兼容读取由 [workspace-kit frontmatter 模块](../dsh-editor-workspace-kit/src/frontmatter.ts) 维护。现有卡片文件与元数据保持原有格式，启停本包只影响导航命令。

## 权限边界

本包只调用宿主的文件树展开与定位接口，不读写文件。文件操作、版本冲突保护和权限判断由稿纸与工作台提供。
