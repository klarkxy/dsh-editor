# dsh-editor-shell

桌面唯一根界面。不发布、不装到日常 `web` profile。包版本 `0.1.0`，不是桌面应用 `0.2.0`。只占 `root`（id `dsh-editor-shell-root`，`src/root-registration.ts`），不声明 `shell.overlay`。兼容 DSH `0.1.5-rc.2`。

作品生命周期走 `/dsh-editor-workbench`；普通稿件读写、搜索与 AI 建议走公开 `/manuscript`。Renderer 不直接访问 Node 文件系统。

## 座位

Root 子座位（`src/root-registration.ts`）：

- `dsh-editor.sidebar.tools` / `dsh-editor.center.overlays`（带 `ShellToolSeatContext`）
- `dsh-editor.settings.plugins` / `dsh-editor.settings.zhihu`
- `dsh-editor.extensions`（公开插件 dock；当前校对 / 知乎不再往这里挂）
- 服务：`dshEditorCommands`、`dshEditorMessageCards`

合同在 `dsh-editor-seats`（构建时内联；`./seats` 再导出）。座位 owner 附带共享 `Select` / `Dialog`（Radix，`src/client/ui/`、`src/client/select.tsx`）。

## 工作台

可折叠三栏；专注模式只留稿纸。左栏真实目录树：隐藏 `.` 开头项，以及 `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `COPILOT.md`（`src/auxiliary-files.ts`）。作品是普通文件夹：`project.createHome` 只建空目录，`project.init` 至多写入根目录 `AGENTS.md`，不预建 `正文/` 等专业目录。栏顶：全文搜索（Ctrl+Shift+F）。概览由 overview-panel 经座位打开。四个 Preset 共用侧栏文稿校对（`dsh-editor-proofread-panel`）：当前文档或全部可见 `.md`/`.txt`，kind 为标点 / 错别字 / 敏感词 / 重复 / 口癖，不含 `card`。人物卡 / 记忆面板默认不装。保存版本 / 历史版本在文件栏菜单。

新对话：`agentPresets.list()` → 确认后 blank `sessions.create` → `agentPresets.select` → Host 真实投影。四个当前 Preset 是 `dsh-editor-writing` / `dsh-editor-novel` / `dsh-editor-article` / `dsh-editor-technical`；历史 `dsh-editor` 不进 picker。已有对话只切换。新模式发送纯文本、走 `writing_propose` V2：edit/split 要生成时 Host-read 的 `targetVersion`，merge 要 `targetVersion`+`sourceVersion`，renames 每项 `version`；可选 `basis` 不能代替目标基线。全部操作接受可见项目相对 `.md`/`.txt`。V2 create 严格 create-if-absent。可见 `dsh-editor-novel` 以 `knowledge-only` 挂 novel-kernel（仅 `novel_knowledge`）。Client `inject` 含 `remote.agentPresets`。

跨文件搜索结果经 `acceptSearchResults` 再分组或替换（`src/client/search-panel.ts`）；辅助文件不进入命中与替换计划，磁盘文件保留。稿内查找替换仍是 Ctrl+F / Ctrl+H（`@codemirror/search`）。世界书触发词表单已移除。

稿纸剪切 / 复制 / 粘贴走原生纯文本：优先 `window.dshWindow.clipboard`（Electron preload IPC），否则 `navigator.clipboard`（`src/client/editor-clipboard.ts`）。写失败不删正文。

## 设置与其它

Host 注册 `dsh-editor-writing`。设置分类：通用 / 模型 / 写作 / 用量 / 知乎资料 / 插件 / 关于（`src/client/settings.tsx`）。模型页管理 provider，并分配补全 / 改写 / 默认对话模型（`src/client/writing-model-routes.tsx`、`src/writing-settings-contract.ts`）。用量页用打包的 ECharts SVG 柱状图（`src/client/settings-usage.tsx`）。知乎无桌面启动器，嵌入设置座位。对话 ⋯：归档 / 恢复 / 删除（删除只写本机墓碑；DSH `0.1.5-rc.2` 无会话删除 API）。

`/dsh-editor-shell` 仅 `capabilities.get`。作品与小说工具分属 workbench / novel-kernel。

## 文档

[使用者指南](../../docs/user-guide.md) · [界面](../../docs/ui.md) · [架构](../../docs/architecture.md) · [插件架构](../../docs/plugin-architecture.md)
