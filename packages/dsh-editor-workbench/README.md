# dsh-editor-workbench

桌面私有、仅 Host 的作品生命周期：文档概览、校对扫描、进度、导入、快照、移动与归档。包版本 `0.1.0`，不是桌面应用 `0.2.0`。`dshEditor.role: core`。不强依赖 `dsh-editor-cards` 或 memory-panel。

浏览器安全契约：`dsh-editor-workbench/contracts`。依赖 `dsh-proofread` 引擎（`./engine` / `./defaults` / `./contracts`）；三份桌面 recipe 都保留该依赖。`project.overview` 与 `proofread.scan` 面向全部可见 `.md`/`.txt`。四个 Preset 共用的 `dsh-editor-proofread-panel` 调本 channel 的 `proofread.scan`（当前文档 / 全部文档；kind 五项不含 `card`），因此顶层 `dsh-proofread` 入口仍可 disabled。`card` 校对请求 fail closed。人物卡扩展在默认关闭的 `dsh-editor-cards`。

`project.init` 在 `newProject: true` 时至多写入根目录 `AGENTS.md`，不预建专业目录。`context.compile` 仍在 channel 上，但只有 legacy 发送路径调用。

## 入口

- `editor-workbench`：`/dsh-editor-workbench`（锁定）
- `editor-workbench-tools`（feature `assistant`）：只注册 `writing_propose`（V2：edit/split 要生成时 Host-read 的 `targetVersion`，merge 要 `targetVersion`+`sourceVersion`，renames 每项 `version`；可选 `basis` 不能代替目标基线；全部操作接受可见 `.md`/`.txt`；create 严格 create-if-absent）与 `author_observe`，外加通用 context hooks（`src/tools.ts`）。不注册任何 `novel_*`。`novel_overview` / `novel_memory_update` 由 novel-kernel 仅在 `legacy` / `full` 模式下调用 Host-only `installNovelWorkbenchTools`；`knowledge-only` 不调用。

注入：`connection`、`sessions`、`workspaceRegistry`、`fs`、`sandboxPolicy`、`webServer`、`tools`。锁定的 Host 主入口挂载不可关闭的 fail-closed tool guard，但只对四个写作 Preset 与 legacy `dsh-editor` 生效；官方 / 社区 Agent 模式不被拦截。根目录只从 live session 推导，复用 `dsh-manuscript/host-api`。

## 契约

端点表在 `src/contracts/channel.ts`；分发在 `src/rpc/`（`mutation` / `sessionless` / `sessionKey`）。写入（含 `progress.record`）走 `withWorkspaceWrite`。`.dsh-editor/` 侧车（`writing-log.json`、`敏感词.txt`、`敏感词-忽略.txt`）不进快照。替换时保留 channel 与载荷，且只保留一个 `editor-workbench`。

## 文档

[插件架构](../../docs/plugin-architecture.md) · [架构](../../docs/architecture.md) · [组合指南](../../docs/plugin-composition-guide.md)
