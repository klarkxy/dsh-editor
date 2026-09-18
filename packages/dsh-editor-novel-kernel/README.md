# dsh-editor-novel-kernel

小说创作工具包，并提供「小说创作」对话模式（preset `dsh-editor-novel`）。私有包，只随桌面应用交付。

- **用途**：按挂载模式提供两级能力——
  - `knowledge-only`（可见的 `dsh-editor-novel` 显式使用）：只注册只读知识检索 `novel_knowledge`，正文修改仍走 workbench 的通用 `writing_propose` 提案。
  - `legacy` / `full`（仅隐藏的 legacy 会话 `dsh-editor`）：完整小说工具面，含 V1 `novel_propose` 提案、索引直写、scratch 草稿、overview / memory 工具、工具守卫与系统提示段。
- **挂载规则**：`mode` 为必填；省略时拒绝加载（fail closed），避免误挂完整表面。
- **运行时材料**：`resources/novel-knowledge/` 是搭档在对话中读取的小说知识卡，出处记录随包保留。

声明见 `package.json` 的 `dshEditor`（feature `assistant`，preset 目录 `presets/dsh-editor-novel`）。
