# dsh-manuscript

DSH Web 稿纸插件，提供文件树、正文编辑、保存、查找替换和补全。桌面也复用它的编辑器与文件能力。

## 安装

需要 Node.js ≥22、DSH `0.1.7-rc.2`。本包尚未发布到 npm，使用本仓库构建的 tarball：在仓库根运行 `pnpm build`、`pnpm pack:plugins`，产物位于 `.pack/`。

将稿纸和 ai-services 两个 tarball 放在不含空格的目录，停止目标 Web profile，先加载共享服务再加载稿纸：

```powershell
$aiPath = (Resolve-Path .\klarkxy-dsh-ai-services-0.1.3.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$aiPath"
$packagePath = (Resolve-Path .\dsh-manuscript-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"
dsh --profile web
```

文件名以实际打包版本为准。卸载用 `dsh plugin --profile web remove dsh-manuscript`，不会删除工作区文件。

## 使用

打开「稿纸」抽屉编辑；`Ctrl+S` 保存，`Ctrl+F` / `Ctrl+H` 查找替换，`Tab` 采纳补全、`Esc` 放弃。选区改写有三种入口，关系如下：独立 Web 的「改这段」只把改写请求复制到剪贴板，粘贴到 DSH 对话中使用；模型驱动的选段改写走 `patch.complete`，由桌面壳开启编辑器内的「修改选段」按钮；桌面壳额外提供预设指令改写（感官展开、缩短、去说明、对话节奏，也可自定义指令），同样经 `patch.complete` 调用模型。

保存冲突时先保留本地草稿，再重新载入。插件仅面向本机单用户，不应将它的 RPC 暴露到网络。

## 开发

入口与导出见 [package.json](package.json)，接口见 [src/index.ts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-manuscript/src/index.ts)。桌面独有的作品管理由 workbench 提供；独立 Web 安装不提供这些功能。

子路径导出：`./host-api`（Host 侧文件读写辅助）、`./assist`（补全与改写服务）、`./client/editor-core`（编辑器组件与改写预设）。

Host RPC 挂在 `/manuscript` 通道，端点包括：`tree.list`、`file.read` / `file.create` / `file.write`、`draft.get` / `draft.list` / `draft.put` / `draft.delete`、`search.text`、`proposal.prepare` / `proposal.apply`、`fim.complete`、`patch.complete`、`capabilities.get`、`usage.summary`。除 `capabilities.get` 与 `usage.summary` 外都需要有效会话；写入类端点在工作区写锁下执行。

行内补全与选段改写通过 `@klarkxy/dsh-ai-services` 调用模型。用途为 `manuscript.completion`、`manuscript.rewrite`，分别默认使用快速档和对话档；幻想档仅在用户显式选择时使用；可由模型中心统一配置。未安装或停用模型中心时使用默认对话模型，保留手动指定的模型或会话选择。公开包依赖共享服务，不依赖私有 Editor 运行时。

桌面旧写作模型设置只导入一次，迁移标记与缺失的用途默认值一同保存；补全和改写共用取消、限额与用量回执。生成结果仍是候选，需作者采纳才改变正文。
