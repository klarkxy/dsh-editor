# 变更记录

本文件只记录已经发生的版本变化；安装、升级和回滚步骤以 [使用者指南](docs/user-guide.md) 为准。

## 0.1.5 - 2026-09-05

### 多窗口与写入安全

- 新增 `withWorkspaceWrite`：`file.create / file.write / proposal.apply` 等写端点按工作区串行排队，多窗口并发写不再互相覆盖。
- 草稿按窗口 `ownerId` 隔离，携带 `revision` 比对：删除草稿必须带上已观察到的 revision，不会误删其他窗口的草稿；新增 `draft.list`，编辑器底部可列出并显式采纳“其他窗口的备份”。
- 保存冲突期间禁止 Ctrl+S 绕过；保存飞行中新键入的内容按规则保留为新草稿。
- 拆章/合章/快照回滚等多文件操作中途失败时抛出 `OperationRecovery`（已落盘路径、恢复文件位置、安全快照 ID），界面提示作者核对；回滚“移出文件”改为归档，不再直接删除正文。
- 非 Windows 平台新增 rename→硬链接→清理的 no-replace 原子移动， staging 失败可恢复。
- 文件树重命名/移动/删除命中当前打开的文稿时同步路径状态；剪切未保存内容会先阻止。

### 编辑器

- 修复 AI 修改建议写入时 `String.replace` 把 `$&`、`$$` 当作元字符解释导致内容错乱的问题。

### 打包与发布

- release 工作流拆为 `pack` 与 `publish` 两个 job，两个平台 runner 不再抢着创建 Release；打包前执行 typecheck、单测与桌面 e2e 门禁。
- 桌面 e2e 不再继承 `ELECTRON_RUN_AS_NODE`（VS Code 终端会注入该变量导致 Electron 秒退）；Electron dist 缺失时自动补跑 postinstall 下载；启动失败时输出可执行文件诊断。
- 修复 macOS 上 proposal-ops 测试断言：`.dsh-editor` 被文件堵死时 POSIX 报 `ENOTDIR`，不再按 Windows 的 `ENOENT` 断言。
- `e2e/desktop.mjs` 新增多窗口草稿隔离与整进程重启后的冲突恢复验证。

## 0.1.4 - 2026-09-05

### 写作搭档

- 修复打开“新对话”设置表单时长消息溢出搭档栏、叠压在头部与按钮上的问题：`.conversation-setup` 此前没有任何样式，作为普通 grid 项插入会把对话历史顶出受约束的中间行；现改为绝对定位覆盖层铺满搭档栏，并补齐表单样式。

## 0.1.3 - 2026-09-05

### 打包与发布

- 去除运行时物化的平台硬编码：`win32-x64` 之外支持 `darwin-x64` / `darwin-arm64`，node 可执行名与 manifest 平台字段按当前平台生成。
- Windows 新增 NSIS 安装版（`DSH Editor-Setup-<版本>-win-x64.exe`，安装向导可选目录，含卸载器），便携版保留。
- macOS（Apple Silicon）新增未签名 dmg 与 zip 产物；首次打开需在访达右键应用选择“打开”。
- 新增 `.github/workflows/release.yml`：推送 `v*` tag 或手动 dispatch 时，Windows 与 macOS runner 各自构建并把产物上传到对应 GitHub Release。
- `verify-desktop-package.mjs` 按平台校验并记录全部产物的 SHA-256（修复此前硬编码旧产物文件名导致哈希误报的问题）。

## 0.1.2 - 2026-09-04

### 桌面应用

- 新增“关于 DSH Editor”对话框：顶栏“关于”入口，显示当前版本，可从 GitHub Releases 检查新版本、查看发布说明并引导下载（便携版需手动替换 EXE）；检查请求由主进程发起，`openExternal` 白名单新增 `github.com`（限 `/klarkxy/dsh-editor/` 路径）。

### 文件树

- 新建文件/文件夹入口从侧栏顶部移到右键菜单：任意文件或文件夹行右键可新建（文件行建在其所在目录、文件夹行建在其内部），树空白区右键建在根目录；文件夹行尾的悬停 `＋` 快捷按钮保留。
- 右键菜单新增复制、剪切、粘贴、重命名、删除：内部剪贴板支持反复粘贴（剪切粘贴一次后清空）；复制遇同名自动改名（`名称 2`），移动/重命名遇同名报错；删除前确认框说明不可撤销（除非已提交到历史）。
- workbench 新增 `entry.copy` / `entry.move` / `entry.delete` / `entry.rename` 四个 RPC 端点，文件与目录通用；统一拒绝绝对路径、`..`、`.dsh-editor/` 私有目录与目录移入自身。

## 0.1.1 - 2026-09-04

### 仓库工具

- 新增 `pnpm upgrade:dsh`（`scripts/upgrade-dsh.mjs`）：从 GitHub `deepseek-ai/deepseek-harness` releases 解析最新 DSH 版本，经 npm 完整性校验后统一改写全仓库 pin、重生成 lockfile 并更新全局安装的 DSH CLI；支持 `--to`、`--channel`、`--dry-run`、`--skip-install`、`--skip-global`。
- 经该功能核查，DSH `0.1.2-rc.1` 删除了 `@deepseek-ai/dsh-client-runtime`，属于破坏性客户端架构重构；本次不迁移，DSH 维持 `0.1.1-rc.2`。

## 0.1.0 - 2026-08-24

首个可交付候选，包含两个相互独立的 DSH 插件。

### dsh-manuscript

- 新增默认收起的稿纸抽屉、通用工作区文件树和正文编辑器。
- 新增 live-session 工作区校验、DSH sandbox、路径和 symlink 拒绝、大小限制，以及原子 create/save。
- 新增可恢复草稿、dirty/conflict/error 状态、切换保护、晚到响应拒绝、字数、剪贴板交接和可选 FIM。

### dsh-grill

- 新增通过 DSH 官方审批流执行的幂等 `scaffold_novel` 工具。
- 新增 planning、drafting、review 和 first-reader 四种提示模式。
- v1 边界移除了 proposal store、scanner、外部 Web 工具、复制的 Skill 资产和全部 Manuscript 耦合。

### 交付

- 新增插件单装、共存和双向卸载的隔离矩阵。
- 新增 tarball 精确内容检查、SHA-256、兼容元数据，以及统一交付闸门。
