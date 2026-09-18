# dsh-editor-workbench

作品工作台 Host。私有核心包，只随桌面应用交付，锁定不可关闭。

- **用途**：私有 RPC `/dsh-editor-workbench` 承载作品生命周期——作品结构、文档概览、校对扫描、写作进度、外部作品导入、文本快照与回滚、安全重命名、跨目录移动与可恢复归档；同时提供各面板（概览、校对、记忆）消费的数据端点。
- **写作工具**：可选入口 `dsh-editor-workbench/tools` 注册通用提案 `writing_propose` 与作者观察 `author_observe`，四个写作模式 preset 显式挂载；提案只返回 marker，写入一律等作者确认。
- **工作方式**：复用 `dsh-manuscript/host-api` 的 live-session 工作区权威；所有写操作带版本基线，目标变化即拒绝（STALE）；同一作品的写入串行执行。

声明见 `package.json` 的 `dshEditor`（role `core`，`editor-workbench` 锁定，`editor-workbench-tools` 为 feature `assistant`）。
