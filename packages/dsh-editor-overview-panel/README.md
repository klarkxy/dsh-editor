# dsh-editor-overview-panel

作品概览面板。私有包，只随桌面应用交付，默认安装；可在设置「插件」里开关「作品概览」。

- **用途**：以中栏 overlay 展示作品概览——章节数与总字数、各章字数分布、近 30 天与 12 周写作曲线、最近编辑。
- **入口**：纯 Client 包，通过 shell 的中栏 overlay 座位接入（`src/client/`）。
- **数据**：数据全部来自 `dsh-editor-workbench` 的 `project.overview` 与 `progress.history` RPC。

声明见 `package.json` 的 `dshEditor`（feature `overview-panel`）。
