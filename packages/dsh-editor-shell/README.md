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

可折叠三栏；专注模式只留稿纸。左栏真实目录树：隐藏 `.` 开头项，以及 `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `COPILOT.md`（`src/auxiliary-files.ts`）。新建作品只预建 `正文/`。栏顶：全文搜索（Ctrl+Shift+F）。概览 / 人物 / 设定由对应插件经座位与命令面板打开。**桌面校对入口已停用**（无 Ctrl+Shift+L、无顶栏校对）。提交 / 历史在文件栏菜单。

跨文件搜索结果经 `acceptSearchResults` 再分组或替换（`src/client/search-panel.ts`）；辅助文件不进入命中与替换计划，磁盘文件保留。稿内查找替换仍是 Ctrl+F / Ctrl+H（`@codemirror/search`）。世界书触发词表单已移除。

稿纸剪切 / 复制 / 粘贴走原生纯文本：优先 `window.dshWindow.clipboard`（Electron preload IPC），否则 `navigator.clipboard`（`src/client/editor-clipboard.ts`）。写失败不删正文。

## 设置与其它

Host 注册 `dsh-editor-writing`。设置分类：通用 / 模型 / 写作 / 用量 / 知乎资料 / 插件（`src/client/settings.tsx`）。模型页管理 provider，并分配补全 / 改写 / 默认对话模型（`src/client/writing-model-routes.tsx`、`src/writing-settings-contract.ts`）。用量页用打包的 ECharts SVG 柱状图（`src/client/settings-usage.tsx`）。知乎无桌面启动器，嵌入设置座位。对话 ⋯：归档 / 恢复 / 删除（删除只写本机墓碑；DSH `0.1.5-rc.2` 无会话删除 API）。

`/dsh-editor-shell` 仅 `capabilities.get`。项目与小说工具分属 workbench / novel-kernel。

## 文档

[使用者指南](../../docs/user-guide.md) · [界面](../../docs/ui.md) · [架构](../../docs/architecture.md) · [插件架构](../../docs/plugin-architecture.md)
