# dsh-editor-seats

浏览器安全的座位合同库。私有包，由 shell 与各插件在构建时内联。

- **用途**：定义 shell 向插件开放的座位（侧栏面板、中栏 overlay、设置分区）、命令注册表、消息卡注册表与快捷键合同，以及独立渲染时的 Radix 变量兜底（`tokens`）。
- **使用方**：`dsh-editor-shell` 实现座位宿主；cards、memory-panel、overview-panel、proofread-panel 等插件按这里的合同接入。
- **形式**：纯类型与常量库，构建时内联进使用方，运行时没有独立的插件入口。

类型合同见 `src/index.ts`。
