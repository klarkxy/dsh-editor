# dsh-editor-memory-panel

记忆维护侧栏。私有包，只随桌面应用交付，默认不安装；作者在设置「插件」里打开「写作记忆」后启用。

- **用途**：查看写作搭档提出的维护记录——`AGENTS.md`、人物卡、世界书的新增与修订——并逐条应用或撤销。
- **入口**：纯 Client 包，通过 shell 的侧栏座位接入（`src/client/`）。
- **数据**：所有查看与写操作都调用 `dsh-editor-workbench` 的 RPC，由 workbench 按作品工作区权限执行。

声明见 `package.json` 的 `dshEditor`（feature `memory-panel`）。
