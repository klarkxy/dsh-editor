# dsh-manuscript

面向 DSH Web 的稿件 GUI 插件，提供工作区文本文件树、正文编辑、安全保存、浏览器会话草稿、字数、前后篇导航、稿内查找替换、全文搜索、剪贴板改写交接和可选补全。官方 DSH 仍是唯一的 Chat 和 Agent 界面。

## 使用行为

- 通过公共 `shell.overlay` 提供默认收起的 360px“稿纸”抽屉。
- 用 `Ctrl+S` 保存；切换、关闭、冲突和晚到响应不会静默覆盖本地 buffer。
- “改这段”只复制请求到剪贴板，不注入官方 Chat DOM。
- FIM / 选段改写使用 live session 已选择的 provider/model 和 DSH `llm.stream`；没有候选时安全返回空。可选 `chapterContext`（≤1 200）写入用户提示中的本章工作笔记；`patch.complete` 另可带 `instruction`（≤400）作为改写要求。

## 稿纸写作体验（editor-core）

`EditorCore` 增加三个可选 props，默认与当前行为一致（关、17px / 1.9 / 宋体栈、不分段弱化）：

- `typewriter?: boolean` — 打字机滚动。键入或移动光标时，把当前行保持在视口垂直中线（比例 0.5）。只在 `docChanged` / `selectionSet` 时重定位，不监听 `scroll`，滚轮滚动不会被拽回去。运行时通过 CodeMirror `Compartment` 开关。
- `typography?: { fontSize?: number; lineHeight?: number; fontFamily?: 'serif' | 'sans' | 'mono' | string; paragraphSpacing?: number; maxWidth?: number }` — 写到稿纸根节点的 CSS 变量：`--paper-font-size`、`--paper-line-height`、`--paper-font-family`、`--paper-paragraph-spacing`、`--paper-max-width`。纸/墨主题继续管颜色。`fontSize` 限制在 14–28px，`lineHeight` 1.4–2.4，`paragraphSpacing` 0–1.5em；`maxWidth` ≤120 视为 `ch`，更大视为 `px`。具名字体栈见 `FONT_STACKS`。
- `focusParagraph?: boolean` — 弱化非光标段落（行装饰 class `cm-paper-dim`，透明度 `--paper-dim-opacity`，默认 0.35）。同样可 Compartment 运行时开关。

这两个扩展不注册 Tab / Esc / Ctrl+Enter / Ctrl+F 键位，补全、选段建议和查找栏优先级不变。纯函数在 `src/client/editor-core/typography.ts` 与 `typewriter.ts`。

## 稿内查找替换

`EditorCore` 用 `@codemirror/search` 提供中文查找栏（不显示默认英文面板）：

- `Ctrl+F` 打开查找，`Ctrl+H` 打开查找并替换；F3 / Shift+F3（或 Ctrl+G）跳到下一处 / 上一处；Esc 在查找栏聚焦时先关栏，再轮到放弃补全。
- 替换是普通 CodeMirror 事务（`userEvent: input.replace*`），走与键入相同的 `setText` 路径，自动保存和版本冲突检查不变。
- `EditorCoreHandle.revealRange(start, end)` 按**完整文件**偏移选中范围（含被投影隐藏的世界书 frontmatter），越界会钳到可见稿纸并滚入视口。

跨文件全文搜索仍是 Host 的 `search.text`，不属于 editor-core。

## Host 契约

Host 由 live `sessionId` 获取 immutable workspace，验证 registered membership 与 sandbox policy，再使用 DSH `ctx.fs`。创建采用 `createIfAbsent`，保存采用 `replaceIfVersion`。绝对路径、traversal、symlink、超过 2 MB 的文本、stale version、未知 session 和 read-only 写入都会 fail closed。

全文搜索只扫描有界的 Markdown/TXT 字面文本并跳过隐藏、生成和链接路径。公开 channel 另有 `draft.list`、`usage.summary`。桌面产品的项目导入、作品快照、安全重命名与可恢复归档属于桌面私有 Host，不进入本公开插件的 RPC 或 tarball。

`dsh-manuscript/host-api` 是给同进程 Host 插件复用的窄 authority/file 子入口；它不增加公开 RPC，也不允许绕过 live session、sandbox、路径与版本门禁。

generic RPC 没有 caller principal，因此该 loopback channel 只适用于 DSH 本地单用户模型，不得暴露成远程多用户 API。

## 兼容与包形态

- 插件版本：`0.1.0`
- DSH：`0.1.5-rc.2`
- Node.js：22+
- dual-face：Host ESM 加 lazy-CJS `./client`
- host-provided peer/runtime：Cordis、DSH client connection / remotes（含 React）

## 安装、验证与卸载

先停止目标 Web profile，并确认 `dsh --version` 为 `0.1.5-rc.2`。在 tarball 所在目录运行：

```powershell
$packagePath = (Resolve-Path .\dsh-manuscript-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"
dsh --profile web
```

重启后应出现默认收起的“稿纸”按钮。也可用 `dsh --profile web --dump-config` 确认存在 `manuscript`。卸载前先用 `Ctrl+S` 保存稿件并复制仍需保留的浏览器草稿，然后停止 profile：

```powershell
dsh plugin --profile web remove dsh-manuscript
```

卸载不会主动删除工作区文件。更新或回滚时先移除当前包，再安装目标版本 tarball；同时保留并核对交付方提供的 SHA-256。

看不到稿纸时先完整重启并检查 config；显示“没有工作区”时，在官方 DSH 中选择工作区并进入普通会话；补全为空是允许的降级，不影响编辑和保存。

源码仓库中的完整使用、开发、产品原则、界面和架构说明分别位于 `docs/user-guide.md`、`docs/development.md`、`docs/product-principles.md`、`docs/ui.md` 和 `docs/architecture.md`；这些仓库文件不包含在独立 tarball 中。
