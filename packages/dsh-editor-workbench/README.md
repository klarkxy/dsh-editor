# dsh-editor-workbench

桌面作品管理 Host，核心包，不可关闭。负责作品操作、提案确认、快照与回滚，并为辅助面板提供数据。

## RPC 端点

Host 在 `/dsh-editor-workbench` 通道（`WORKBENCH_RPC_CHANNEL`，仅本机回环）暴露 39 个端点，按域分组（src/contracts/channel.ts）：

- 作品与进度：`project.inspect` / `createHome` / `init` / `prepareIndex` / `overview`，`progress.record` / `history`
- 目录与条目：`structure.groupCreate`、`directory.create`，`entry.copy` / `move` / `delete` / `rename`
- 文件：`file.rename` / `moveManuscript` / `readBinary`（带版本校验或二进制读取）
- 上下文与规则：`context.compile`，`rules.get` / `open`
- 记忆：`memory.list` / `get` / `apply` / `undo`
- 导入：`project.importProbe` / `importApply` / `importCleanup`
- 快照与回滚：`snapshot.list` / `create` / `rollback` / `restoreProbe` / `restoreApply` / `restoreCleanup`
- 归档：`archive.list` / `apply` / `restore`
- 提案：`proposal.prepare` / `apply`（支持 create、章节计划/小结、拆分、合并、批量改名与写作 V2 提案）
- 校对：`proofread.scan`

错误统一映射为 `WorkbenchRpcError`（src/index.ts），保留可操作的失败原因。

## 写作工具（editor-workbench-tools）

独立 entry「写作工具」（跟随「助手」功能开关），注册 `writing_propose`（写作提案）与 `author_observe`（作者侧写观察）两个通用写作工具，并按权限边界禁用继承自宿主的编码工具：`write` / `edit` / `pwsh` / `bash` / `shell` / `str_replace` / `NotebookEdit`（src/tools.ts）。小说专有的 `novel_*` 工具由 novel-kernel 经 `installNovelWorkbenchTools` 另行挂载。

## Fusion host

`apply` 提供 `fusionWriting` 服务（src/index.ts、src/fusion-host.ts），作为 dsh-fusion 的写作 Host：采用候选前重新解析会话身份、工作区与沙箱访问，校验目标文件版本、原始读取基线和未保存的作者草稿；版本漂移、访问变化或存在未保存草稿都会拒绝写入，候选文本只按字节采用、不重新生成。

## 子路径导出

- `./contracts`：RPC 通道名、端点与提案负载类型（浏览器侧面板共用）。
- `./tools`：写作工具 entry 的注册与继承工具禁用逻辑。

操作见[使用指南](../../docs/user-guide.md#管理作品)。接口见 [src/contracts.ts](src/contracts.ts)，写入权限复用 [dsh-manuscript](../dsh-manuscript/README.md)；新增写作工具也须遵守[作者确认边界](../../docs/product-principles.md#作者决定内容)。
