# dsh-editor-novel-kernel

桌面「小说创作」模式（`dsh-editor-novel`）。在「设置 → 插件 → 写作模式」开关，新对话创建时选择；进行中的对话不受影响。

当前模式提供只读小说知识，文件修改使用通用提案，先预览再由作者采用。[知识卡](resources/novel-knowledge/)是搭档读取的运行时材料，[出处](resources/novel-knowledge/SOURCES.md)随包保留。

## 旧会话兼容

隐藏的 `dsh-editor` preset 仅为旧会话保留采访、索引、临时草稿与自动资料维护。不要将完整旧工具挂到新写作模式；加载模式须显式声明。

退出安排：恢复测试与迁移入口已上线；下一个 minor 版本删除旧流程与 preset，保留 V1 提案和章节 frontmatter 解析供转录兼容。删除前重新验证旧会话恢复与迁移，完成后移除此段。
