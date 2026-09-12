# dsh-manuscript

面向 DSH Web 的公开稿件插件：工作区文本树、正文编辑、安全保存、浏览器草稿、字数、前后篇导航、稿内查找替换、全文搜索、剪贴板改写交接与可选补全。官方 DSH 仍是唯一 Chat / Agent 界面。

插件版本 **`0.1.0`**（不是桌面应用 `0.2.0`）。DSH `0.1.5-rc.2`。桌面把本包当核心稿件 Host，并用 `./client/editor-core`；桌面根界面是 `dsh-editor-shell`，本 Client 不占 `root`。

## 入口

- Host `manuscript`（锁定）：`/manuscript`（`src/index.ts`）
- Client：官方 `shell.overlay`（id `manuscript`，order `100`，`src/client/slots.ts`）
- 可选 `manuscript-assist`（feature `completion`，smart / full）：FIM / 选段改写

## 使用行为

- 公开 Web：默认收起的 360px「稿纸」抽屉。
- `Ctrl+S` 保存；切换、关闭、冲突和晚到响应不会静默覆盖本地 buffer。
- 「改这段」只复制请求到剪贴板，不注入官方 Chat DOM。
- FIM / 选段改写由 Host 按写作角色设置与可信 live session 解析有效 provider/model，并调用 DSH `llm.stream`；无候选时返回空。可选 `chapterContext`（≤1 200）写入用户提示中的本章工作笔记；`patch.complete` 可带 `instruction`（≤400）。
- editor-core 剪切先确认剪贴板写入再删除（`src/client/editor-core/editor-clipboard.ts`）。

## 稿纸（editor-core）

`EditorCore` 可选 props，默认与当前行为一致（关、17px / 1.9 / 宋体栈、不分段弱化）：

- `typewriter` — 打字机滚动（`src/client/editor-core/typewriter.ts`）
- `typography` — CSS 变量排版（`src/client/editor-core/typography.ts`）
- `focusParagraph` — 弱化非光标段落

editor-core 注册 Tab 采纳、Esc 取消 / 关闭查找、Ctrl / ⌘+Enter 应用提案；稿内查找基于 `@codemirror/search`（Ctrl / ⌘+F、Ctrl / ⌘+H）。跨文件搜索是 Host `search.text`，不属于 editor-core。

## Host 契约

Live `sessionId` → immutable workspace → membership 与 sandbox → DSH `ctx.fs`。创建 `createIfAbsent`，保存 `replaceIfVersion`。绝对路径、traversal、symlink、超过 2 MB 文本、stale version、未知 session、只读写入均 fail closed。`search.text` 只扫有界 Markdown/TXT，跳过隐藏、生成和链接路径。另有 `draft.list`、`usage.summary`。桌面导入 / 快照 / 归档不进入本公开 RPC。

`dsh-manuscript/host-api` 是同进程窄 authority/file 子入口，不增加公开 RPC。RPC 经 `webServer` 挂 channel（`src/rpc/channel.ts`）。该 loopback 只适用于本地单用户模型。

## 安装

在不含空格的目录放置 tarball，先停目标 Web profile，确认 `dsh --version` 为 `0.1.5-rc.2`：

```powershell
$packagePath = (Resolve-Path .\dsh-manuscript-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"
dsh --profile web
```

卸载：`dsh plugin --profile web remove dsh-manuscript`。不删除工作区文件。

仓库文档（不打进 tarball）：[使用者指南](../../docs/user-guide.md) · [开发者指南](../../docs/development.md) · [产品原则](../../docs/product-principles.md) · [界面](../../docs/ui.md) · [架构](../../docs/architecture.md) · [组合指南](../../docs/plugin-composition-guide.md)
