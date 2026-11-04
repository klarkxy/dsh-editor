# dsh-editor-novel-kernel

小说知识与资料维护工具，由桌面唯一的写作搭档 preset（`dsh-editor-writing`）以 `knowledge-only` 装载。没有单独的小说模式：搭档按作品已有内容选用 `novel-writing` skill（随标准 preset 分发）。

设置页另有一个「小说工具」功能入口（package.json 的 `dshEditor.entries`）。该入口被宿主锁定、只显示「核心」标记，不能直接开关；内核随会话 preset 装载。

当前模式提供只读小说知识与资料维护，正文与大纲的修改使用通用提案，先预览再由作者采用。[知识卡](resources/novel-knowledge/)是搭档读取的运行时材料，[出处](resources/novel-knowledge/SOURCES.md)随包保留。

## 模式契约

装载内核必须显式声明 `mode`：`knowledge-only`（挂 `novel_knowledge` 与 `novel_memory_update`）或 `legacy`（历史完整工具面）；`full` 是 `legacy` 的别名。省略配置或传入未知取值都会被拒绝。标准 preset 固定以 `knowledge-only` 装载。

`novel_knowledge` 工具按主题读取知识卡，每次 1–3 个主题，可选 planning、characters、drafting、dialogue、interiority、style、review、deai、chinese-flow、first-reader、canon 共 11 个主题。`novel_memory_update` 直接维护 `AGENTS.md`、`人物卡/` 与 `世界书/`，写入即生效，历史可在记忆面板查看并撤销。

包导出除 `.` 外还有 `./contracts` 子路径：工具名、提案 marker、scratch 目录与索引路径等常量、类型与解析函数。

## 旧会话

旧版按模式绑定的会话（含隐藏的 `dsh-editor` preset）不再部署、不迁移，也不在界面中展示；`legacy` 模式代码与 V1 提案、章节 frontmatter 解析仍保留供转录兼容。
