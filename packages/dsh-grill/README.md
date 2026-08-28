# dsh-grill

Host-only DSH 小说协作插件。它只增加一个 `scaffold_novel` 工具和一个 additive system-prompt section；没有客户端、第二套 Chat 或 `grill-your-novel` Skill tree，也不依赖 `dsh-manuscript`。

## 使用行为

- `planning`：剧情、大纲、人物目标和场景交接，默认不写正文。
- `drafting`：按明确范围写、续写、改写或润色；Chat 输出仍是未保存草稿。
- `review`：默认只报告问题，不修改正文。
- `first-reader`：模拟首次读者，按阅读顺序报告体验。
- `scaffold_novel`：经 DSH 官方工具审批，在 live Agent session workspace 中创建小说目录和起始文件；已有路径跳过、不覆盖。

## 兼容与宿主契约

- 插件版本：`0.1.0`
- DSH：`0.1.1-rc.2`
- Node.js：22+
- host-provided peers：Cordis、`dsh-tools`
- Cordis entries：`grill-tools`、`grill-workflow`

## 安装、验证与卸载

先停止目标 Web profile，并确认 `dsh --version` 为 `0.1.1-rc.2`。在 tarball 所在目录运行：

```powershell
$packagePath = (Resolve-Path .\dsh-grill-0.1.0.tgz).Path.Replace('\', '/')
dsh plugin --profile web add "file:$packagePath"
dsh --profile web
```

重启后可用 `dsh --profile web --dump-config` 确认存在 `grill-tools` 和 `grill-workflow`。在带工作区的普通 Agent 会话中请求“调用 `scaffold_novel` 创建小说目录”，应出现官方工具审批。卸载前停止 profile：

```powershell
dsh plugin --profile web remove dsh-grill
```

卸载不会主动删除 scaffold 已创建的工作区文件。更新或回滚时先移除当前包，再安装目标版本 tarball，并核对交付方提供的 SHA-256。

模式提示未生效时先完整重启并检查 `grill-workflow`；工具被拒绝时检查 session 是否有工作区、sandbox 是否可写，并在官方审批界面授权。

源码仓库中的完整使用、开发和架构说明分别位于 `docs/user-guide.md`、`docs/development.md` 和 `docs/architecture.md`；这些仓库文件不包含在独立 tarball 中。
