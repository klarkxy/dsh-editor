# dsh-manuscript

DSH Web 稿纸插件，提供文件树、正文编辑、保存、查找替换和补全。桌面也复用它的编辑器与文件能力。

## 安装

需要 Node.js ≥22、DSH `0.2.0-rc.2`。本包尚未发布到 npm，使用本仓库构建的 tarball：在仓库根运行 `pnpm build`、`pnpm pack:plugins`，产物位于 `.pack/`。

将稿纸 tarball 放在不含空格的目录，停止目标 Web profile 后加载稿纸；不再需要共享 AI 服务：

```powershell
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

子路径导出：`./host-api`（Host 侧文件读写辅助）、`./assist`（补全与改写服务）、`./client/editor-core`（编辑器组件、改写预设与离场保存守卫 `saveOpenEditor`）。离场守卫在保存后重新核对文档身份、冲突、组字与最新缓冲区；保存期间继续输入时保留当前文档。

编辑器按会话、文件路径、工作区、草稿类型与 `externalRevision` 识别读取代际。普通重渲染或替换等价的 RPC / 草稿适配器不会重新读取文档；宿主需要明确重新读取时递增 `externalRevision`。独立宿主的会话草稿仍读取已有的 `dsh-editor:draft:` 存储键，并兼容早期未写入 `cwd` 的记录。

Host RPC 挂在 `/manuscript` 通道，端点包括：`tree.list`、`file.read` / `file.create` / `file.write`、`draft.get` / `draft.list` / `draft.put` / `draft.delete`、`search.text`、`proposal.prepare` / `proposal.apply` / `proposal.receipt`、`fim.complete`、`patch.complete`、`capabilities.get`、`usage.summary`。除 `capabilities.get` 与 `usage.summary` 外都需要有效会话；写入类端点在工作区写锁下执行。

行内补全与选段改写通过官方 `@deepseek-ai/dsh-llm` 直接调用模型。宿主可通过现有写作偏好指定 `completionModel` 与 `rewriteModel`；独立调用也可明确传入提供方、模型与思考强度。未指定时使用当前会话的选择，再使用宿主原生默认模型。共享库 `@klarkxy/dsh-plugin-kit` 提供原生路由辅助，不需要加载额外模型中心或共享 AI 服务，也不依赖私有应用运行时。

补全和改写在本插件内按供应商共用写作并发额度，并保持固定的输入、输出与超时上限。写作调用只尝试一次；取消、停用及同一会话的新请求会作废旧候选，不返回失败或超时的半段输出。

用量通过原有 `llm/stream` 统计进入 `usage.summary`。达到补全 240 字符或改写 1200 字符的上限时停止生成；如果供应商尚未返回用量，该次调用可能没有统计记录，不估算缺失的 token。生成结果仍是候选，需作者采纳才改变正文。

聊天中的 edit 提案使用稳定的 DSH 工具结果行 ID 保存审批回执。回执由成功写入后的 Host 保存到 DSH storageDomain，按工作区、会话、结果行及完整提案内容隔离；重开后显示真实的已应用或已撤回结果，不根据当前文本猜测历史写入。重复应用同一回执会被拒绝，目标版本和依据版本校验保持不变。回执保存失败会报告稿件已写入的部分成功情况。

回执不保存旧稿正文。当前界面中的 edit 撤回仍按写入版本核对；重开后的历史卡片不提供依赖内存快照的撤回按钮。没有结果行 ID 的独立提案卡，以及 workbench 的其他提案类型，仍按原有版本核对流程工作。
