# dsh-manuscript

DSH Web 稿纸插件，提供文件树、正文编辑、保存、查找替换和补全。桌面也复用它的编辑器与文件能力。

## 安装

需要 Node.js ≥22、DSH `0.1.5-rc.2`。本包尚未发布到 npm，使用本仓库构建的 tarball：在仓库根运行 `pnpm build`、`pnpm pack:plugins`，产物位于 `.pack/`。

将稿纸和 ai-services 两个 tarball 放在不含空格的目录，停止目标 Web profile，先加载共享服务再加载稿纸：

```powershell
$aiPath = (Resolve-Path .\klarkxy-dsh-ai-services-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$aiPath"
$packagePath = (Resolve-Path .\dsh-manuscript-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"
dsh --profile web
```

文件名以实际打包版本为准。卸载用 `dsh plugin --profile web remove dsh-manuscript`，不会删除工作区文件。

## 使用

打开「稿纸」抽屉编辑；`Ctrl+S` 保存，`Ctrl+F` / `Ctrl+H` 查找替换，`Tab` 采纳补全、`Esc` 放弃。「改这段」复制请求到剪贴板，再到 DSH 对话中使用。

保存冲突时先保留本地草稿，再重新载入。插件仅面向本机单用户，不应将它的 RPC 暴露到网络。

## 开发

入口与导出见 [package.json](package.json)，接口见 [src/index.ts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-manuscript/src/index.ts)。桌面独有的作品管理由 workbench 提供；独立 Web 安装不提供这些功能。

行内补全与桌面选区改写通过 `@klarkxy/dsh-ai-services` 调用模型。用途为 `manuscript.completion`、`manuscript.rewrite`，默认跟随当前会话；可由模型中心统一配置。公开包依赖共享服务，不依赖私有 Editor 运行时。
