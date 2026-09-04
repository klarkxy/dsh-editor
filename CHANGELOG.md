# 变更记录

本文件只记录已经发生的版本变化；安装、升级和回滚步骤以 [使用者指南](docs/user-guide.md) 为准。

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
