# dsh-manuscript

面向 DSH Web 的稿件 GUI 插件，提供工作区文本文件树、正文编辑、安全保存、浏览器会话草稿、字数、前后篇导航、剪贴板改写交接和可选补全。它不依赖 `dsh-grill`；官方 DSH 仍是唯一的 Chat 和 Agent 界面。

## 使用行为

- 通过公共 `shell.overlay` 提供默认收起的 360px“稿纸”抽屉。
- 用 `Ctrl+S` 保存；切换、关闭、冲突和晚到响应不会静默覆盖本地 buffer。
- “改这段”只复制请求到剪贴板，不注入官方 Chat DOM。
- FIM 使用 live session 已选择的 provider/model 和 DSH `llm.stream`；没有候选时安全返回空。

## Host 契约

Host 由 live `sessionId` 获取 immutable workspace，验证 registered membership 与 sandbox policy，再使用 DSH `ctx.fs`。创建采用 `createIfAbsent`，保存采用 `replaceIfVersion`。绝对路径、traversal、symlink、超过 2 MB 的文本、stale version、未知 session 和 read-only 写入都会 fail closed。

generic RPC 没有 caller principal，因此该 loopback channel 只适用于 DSH 本地单用户模型，不得暴露成远程多用户 API。

## 兼容与包形态

- 插件版本：`0.1.0`
- DSH：`0.1.1-rc.2`
- Node.js：22+
- dual-face：Host ESM 加 lazy-CJS `./client`
- host-provided peer/runtime：Cordis、DSH client runtime（含 React）

## 安装、验证与卸载

先停止目标 Web profile，并确认 `dsh --version` 为 `0.1.1-rc.2`。在 tarball 所在目录运行：

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

源码仓库中的完整使用、开发和架构说明分别位于 `docs/user-guide.md`、`docs/development.md` 和 `docs/architecture.md`；这些仓库文件不包含在独立 tarball 中。
