# dsh-editor-novel-kernel

桌面「小说创作」模式（`dsh-editor-novel`）。在「设置 → 插件 → 写作模式」开关，新对话创建时选择；进行中的对话不受影响。

设置页另有一个「小说工具」功能入口（package.json 的 `dshEditor.entries`）。该入口被宿主锁定、只显示「核心」标记，不能直接开关——内核随会话 preset 装载，开启小说创作模式的实际操作是「写作模式」分组里的「小说创作」preset 开关（`presets.setEnabled`），立即生效且只影响新对话。

当前模式提供只读小说知识，文件修改使用通用提案，先预览再由作者采用。[知识卡](resources/novel-knowledge/)是搭档读取的运行时材料，[出处](resources/novel-knowledge/SOURCES.md)随包保留。

## 模式契约

装载内核必须显式声明 `mode`：`knowledge-only`（只读面，仅挂 `novel_knowledge`）或 `legacy`（历史完整工具面）；`full` 是 `legacy` 的别名。省略配置或传入未知取值都会被拒绝。`dsh-editor-novel` preset 固定以 `knowledge-only` 装载。

`novel_knowledge` 工具按主题读取知识卡，每次 1–3 个主题，可选 planning、characters、drafting、dialogue、interiority、style、review、deai、chinese-flow、first-reader、canon 共 11 个主题。

preset 目录附带两个 skills：`novel-writing`（规划、正文与 canon，目录约定正文/大纲/人物卡/世界书）与 `prose-revision`（已有文稿的局部语言修订）。

包导出除 `.` 外还有 `./contracts` 子路径：工具名、提案 marker、scratch 目录与索引路径等常量、类型与解析函数。

## 旧会话兼容

隐藏的 `dsh-editor` preset 仅为旧会话保留采访、索引、临时草稿与自动资料维护。不要将完整旧工具挂到新写作模式；加载模式须显式声明。

退出安排：恢复测试与迁移入口已上线；下一个 minor 版本删除旧流程与 preset，保留 V1 提案和章节 frontmatter 解析供转录兼容。删除前重新验证旧会话恢复与迁移，完成后移除此段。
