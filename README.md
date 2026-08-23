# DSH Editor plugins

这是两个可独立安装的 DSH 插件，不是另一套编辑器外壳：

- `dsh-manuscript`：可折叠的稿件抽屉、工作区文件树、安全保存、本地草稿和可选 FIM。
- `dsh-grill`：一个需官方审批的小说脚手架工具，以及规划、起草、审校、首读四种写作提示模式。

两者没有互相依赖；可以只装任意一个，也可以同时安装或分别卸载。官方 DSH 继续负责 Chat、Agent、审批、模型、会话和工作区权限。

## 兼容范围

- Windows 上的 `@deepseek-ai/dsh` `0.1.1-rc.1`（其内置包可能为 `0.1.1-rc.2`）
- Node.js 22 或更高版本
- pnpm 10.14.0

这是当前已验证范围，不代表对其他 DSH 版本作兼容承诺。升级 DSH 后应重新运行完整交付验证。

验证脚本会从 `PATH` 中的 `dsh` 安装根读取真实 package 版本，并拒绝非 `0.1.1-rc.1`。如果使用 Volta、自定义 shim 或其他无法从安装根反查的布局，可显式指定 CLI：

```powershell
$env:DSH_CLI_PATH = 'C:/absolute/path/to/@deepseek-ai/dsh/lib/bin.js'
```

## 从源码生成交付包

```powershell
pnpm install --frozen-lockfile
pnpm verify:delivery
```

该命令会依次执行类型检查、49 项单元测试、构建、严格打包检查，以及全新临时 DSH 主目录中的安装矩阵。矩阵覆盖：仅 Manuscript、两者同时、卸载 Manuscript 后仅 Grill、恢复两者、卸载 Grill 后仅 Manuscript，并对四个关键状态启动真实 Web 页面。

最终产物位于 `.pack`：

- `dsh-manuscript-0.1.0.tgz`
- `dsh-grill-0.1.0.tgz`
- `SHA256SUMS`
- `release-manifest.json`

每次打包都会先安全重建 `.pack`，拒绝陈旧或多余的 tarball，核对包内文件、DSH bundle 声明和跨插件耦合，再生成 SHA-256。

## 安装

如果 `web` 正在前台运行，先在它的终端按 `Ctrl+C` 并等待进程退出；若通过其他方式启动，则用同一种方式停止它。在仓库根目录安装：

```powershell
$repoPath = (Resolve-Path .).Path.Replace('\', '/')
dsh plugin --profile web add "file:$repoPath/.pack/dsh-manuscript-0.1.0.tgz"
dsh plugin --profile web add "file:$repoPath/.pack/dsh-grill-0.1.0.tgz"
```

只需要其中一个时，仅执行对应命令。随后用 `dsh --profile web` 重新启动 DSH Web（若原来由其他入口托管，则从原入口重启）。插件的 Cordis 和 `dsh-tools` peer 由官方 DSH profile 提供；隔离安装矩阵会验证这条宿主契约，包括 Web 客户端所需的 React 运行时。

可用以下命令核对最终配置：

```powershell
dsh --profile web --dump-config
```

期望结果：Manuscript 对应 `manuscript` 条目；Grill 对应 `grill-tools` 和 `grill-workflow` 条目。完整的可重复自动检查是：

```powershell
pnpm test:e2e:matrix
```

## 卸载与回滚

先按上面的方式停止相应 DSH profile，再按需执行：

```powershell
dsh plugin --profile web remove dsh-manuscript
dsh plugin --profile web remove dsh-grill
```

卸载一个不会移除另一个。用 `dsh --profile web` 重新启动后，再用 `--dump-config` 确认对应条目已经消失。回滚时先移除当前版本，再用上面的 `file:` 安装命令安装已留存的旧版 tarball；旧包也应保留其 `SHA256SUMS`。安装前运行以下命令，并将两边显示的哈希逐项核对：

```powershell
Get-FileHash .pack/*.tgz -Algorithm SHA256 | Format-Table Hash, Path
Get-Content .pack/SHA256SUMS
```

## 验证层级

- `pnpm verify:delivery`：无需模型凭据的标准交付闸门，必须通过。
- `pnpm test:e2e:live`：使用专用 `dsh-editor-e2e` profile 和本机模型配置的凭据化验收，覆盖真实文件编辑、脚手架审批和官方 Chat。它不会操作日常 `web` profile。

架构边界和已知限制见 [codex-plan.md](./codex-plan.md)。变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 已知边界

- 只适用于 DSH 的本地单用户、loopback 信任模型；Manuscript RPC 目前没有调用者身份，不应暴露成远程多用户接口。
- DSH 当前公共 API 只有 additive overlay，没有把官方根布局重组为永久三栏的稳定接口，因此稿件区采用默认收起的抽屉。
- FIM 没有可用模型选择或模型不返回候选时会安全降级为空，不影响手工编辑和保存。
- 本仓库不自动发布、打标签或推送；这些动作需要单独授权。
