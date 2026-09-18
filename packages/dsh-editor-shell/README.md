# dsh-editor-shell

桌面写作界面本身。私有核心包，只随桌面应用交付，锁定不可关闭。

- **用途**：应用的唯一根界面——首页与作品列表、三栏工作台（文件树 / 稿纸 / 写作搭档）、专注模式、命令面板、设置弹窗与主题；持有正文编辑 buffer、选区与作者确认流程。
- **工作方式**：以较低 root priority 遮蔽 DSH 官方 AppFrame（固定版本的兼容接缝）；Chat 区域投影 DSH 会话，新建对话先选择写作模式再创建。向插件开放座位与命令注册表，合同见 `dsh-editor-seats`。
- **Client 结构**：`src/client/` 按 `root` / `sidebar` / `editor` / `chat` / `dialogs` / `theme` / `components` / `shared` 划分，稿纸能力复用 `dsh-manuscript/client/editor-core`。

声明见 `package.json` 的 `dshEditor`（role `core`，entry `editor-shell` 锁定）。
