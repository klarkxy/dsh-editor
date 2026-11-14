# dsh-editor-novel-kernel

小说知识与资料维护工具，由桌面唯一的写作搭档 preset（`dsh-editor-writing`）装载。没有单独的小说模式：搭档按作品已有内容选用 `novel-writing` skill（随标准 preset 分发）。

设置页另有一个「小说工具」功能入口（package.json 的 `dshEditor.entries`）。该入口被宿主锁定、只显示「核心」标记，不能直接开关；内核随会话 preset 装载。

内核只注册两件工具，没有 Cordis 命令。`novel_knowledge` 读取随包知识卡；`novel_memory_update` 直接维护根 `AGENTS.md`、`人物卡/` 与 `世界书/`，写入即生效。正文与大纲的修改不在本包，由工作台的 `writing_propose` 先预览再由作者采用。[知识卡](resources/novel-knowledge/)是搭档读取的运行时材料，[出处](resources/novel-knowledge/SOURCES.md)随包保留。

## 装载

`apply` 始终挂载上述两个工具。配置可以省略；标准 preset 与既有用户配置仍可写 `mode: knowledge-only`，这个键会被接受并忽略，对象上的其它未知键也同样忽略。`legacy` 与 `full` 已删除，配置若仍写成这两个值，装载直接失败，不会退回已不存在的工具面。

`novel_knowledge` 按主题读取知识卡，每次 1–3 个主题，可选 planning、characters、drafting、dialogue、interiority、style、review、deai、chinese-flow、first-reader、canon 共 11 个主题。它只读包内材料，不读、不写作品文件。`novel_memory_update` 的写入范围限于根 `AGENTS.md`、`人物卡/` 与 `世界书/`；历史可在记忆面板查看并撤销。

包导出除 `.` 外还有 `./contracts` 子路径：`novel_knowledge` 工具名、历史提案 marker（`novel_propose` 的 V1 预览协议，供界面解析旧结果；本包不再注册该工具），以及从工作台再导出的作者记忆 marker。章节 frontmatter 的兼容解析在工作台，不在本包。

## 权限边界

内核注入 `tools`、`fs`、`sandboxPolicy`、`sessions`、`workspaceRegistry`，供 `novel_memory_update` 只在当前会话所属作品上写入。它不注入系统提示词，也不安装工具守卫。本包不注册提案、索引直写或 scratch，也不能代替 shell 或直接改稿。
