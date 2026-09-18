# dsh-editor-writing-presets

第一方写作模式 preset 包。私有包，只随桌面应用交付，默认安装；两种模式可在设置「插件 → 写作模式」里开关。

- **用途**：提供「文章与自媒体」（`dsh-editor-article`）与「技术文档」（`dsh-editor-technical`）两个对话模式的 preset 目录（`presets/`），经 profile 物化部署为可选的写作搭档模式。
- **工作方式**：与核心「通用写作」一样发送纯文本、走 `writing_propose` 提案确认；开关立即部署或删除对应 preset，进行中的对话不受影响。

声明见 `package.json` 的 `dshEditor`（features `writing-presets`）。
