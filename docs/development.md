# DSH Editor 开发者指南

本指南面向维护者和贡献者。安装与日常使用见 [使用者指南](user-guide.md)，设计约束见 [架构与边界](architecture.md)。

## 1. 开发前提

- Windows
- Node.js 22+
- pnpm 10.14.0
- `@deepseek-ai/dsh` `0.1.1-rc.1`
- Playwright 可用的 Chromium（只在 E2E 中需要）

```powershell
node --version
pnpm --version
dsh --version
pnpm install --frozen-lockfile
```

验证脚本从 `PATH` 中的 `dsh` 安装根读取真实 package 版本，并拒绝其他版本。Volta、自定义 shim 或无法反查安装根的环境可以显式指定：

```powershell
$env:DSH_CLI_PATH = 'C:/absolute/path/to/@deepseek-ai/dsh/lib/bin.js'
```

显式路径无效时会直接失败，不会静默退回另一份 DSH。首次运行 E2E 若 Playwright 报告缺少浏览器，可执行：

```powershell
pnpm exec playwright install chromium
```

## 2. 仓库结构与所有权

```text
packages/dsh-manuscript/  GUI 插件：Host RPC、文件/FIM 适配、Web 稿纸客户端
packages/dsh-grill/       Host-only 插件：scaffold_novel 与四模式系统提示
scripts/                  开发启动、客户端包装、DSH 定位、打包与产物验证
e2e/                      隔离安装矩阵与凭据化真实流程
docs/                     使用、开发和架构文档
.pack/                    生成的交付包、校验和与来源清单（Git 忽略）
e2e/out/                  E2E 报告、日志、截图和临时工作区（Git 忽略）
```

官方 DSH 始终拥有 Chat、Agent、工具调度、审批、模型、会话和工作区权限。两个插件不得互相 import、调用 RPC、共享文件协议或依赖彼此状态。

### `dsh-manuscript`

- Host ESM 入口：`packages/dsh-manuscript/src/index.ts`
- 客户端入口：`packages/dsh-manuscript/src/client/index.ts`
- RPC 路径：`/manuscript`
- 构建：Host 输出 ESM；客户端输出 CJS，再由 `scripts/wrap-client.mjs` 包装给 DSH 模块加载器
- Cordis entry：`manuscript`

浏览器传入用于选择 live session 的 `sessionId`、工作区相对路径，以及具体操作数据（如 `text`、`version`、FIM `prefix/suffix`）。工作区 authority 和模型路由不能来自浏览器：Host 必须从 session 的 immutable `header.cwd` 与 request header 解析，再通过 DSH `ctx.fs` 完成版本化读写。所有操作数据仍需 Host 校验；不要重新引入浏览器提供的 `cwd`、Node 直写或 provider 凭据读取。

### `dsh-grill`

- 工具入口：`packages/dsh-grill/src/tools.ts`
- 提示入口：`packages/dsh-grill/src/workflow.ts`
- 唯一工具：`scaffold_novel`
- Cordis entries：`grill-tools`、`grill-workflow`

工具必须使用调用 Agent 的 session workspace、sandbox 和官方 pre-execute 审批；已存在路径只能跳过。四模式提示只指导官方 Chat，不得写稿或依赖 Manuscript。

## 3. 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm typecheck` | 两个包的 TypeScript 类型检查 |
| `pnpm test` | 运行全部 Vitest 单元测试 |
| `pnpm build` | 构建两个插件 |
| `pnpm pack:plugins` | 重建 `.pack`、打两个包、检查内容并生成 SHA-256/来源清单 |
| `pnpm test:e2e:matrix` | 构建、打包并运行凭据无关的安装/卸载矩阵 |
| `pnpm test:e2e:live` | 在专用持久 profile 中运行需要模型凭据的完整真实流程 |
| `pnpm verify:delivery` | 标准交付闸门：typecheck、unit、build、pack、matrix |

包级定向检查：

```powershell
pnpm --filter dsh-manuscript typecheck
pnpm --filter dsh-manuscript test
pnpm --filter dsh-grill typecheck
pnpm --filter dsh-grill test
```

当前没有单独的 lint 或 CI 工作流；提交前至少运行相关包测试、根级 typecheck 和 `git diff --check`。交付前必须运行完整 `pnpm verify:delivery`。

## 4. 隔离的本地开发

`pnpm dev` 会先构建，再把两个包以 `link:` 安装进目标 DSH profile，启动两个 watcher 和 DSH Web。它默认使用 `web`，因此不要在未设置隔离 `DSH_HOME` 时随手运行，否则会修改日常 profile。

推荐使用临时开发 home：

```powershell
$env:DSH_HOME = Join-Path $env:TEMP 'dsh-editor-dev-home'
$env:DSH_PROFILE = 'web'
pnpm dev -- --port 8788
```

客户端构建后刷新浏览器即可。Host、工具或 Cordis patch 变更如果未被热加载，停止并重启命令。结束时脚本会停止 watcher 和 DSH；临时 `DSH_HOME` 可在确认路径后自行清理。

## 5. 测试层级

### 单元测试

重点覆盖：

- session/workspace authority、路径穿越、symlink、只读、原子 create/save 和 stale version；
- dirty/draft/conflict 状态、切换保护、保存竞态、晚到 read/FIM 丢弃；
- `scaffold_novel` 审批、幂等、containment 和不覆盖；
- 四模式 prompt 与“只注册一个工具”的 v1 边界。

### 安装矩阵：标准、无凭据

```powershell
pnpm test:e2e:matrix
```

该脚本：

- 创建全新的临时 `DSH_HOME`，使用真实 `web` 模板；
- 安装当前 `.pack` tarball；
- 验证 Manuscript-only、Both、移除 Manuscript 后 Grill-only、恢复 Both、移除 Grill 后 Manuscript-only；
- 在四个关键状态启动 Web，处理首次声明/稍后配置，检查页面错误和稿纸出现/消失；
- 写入 `e2e/out/plugin-matrix`，随后安全清理临时 home。

可用 `E2E_MATRIX_PORT` 修改起始端口；默认使用 8790–8793。

### 真实流程：可选、需要凭据

```powershell
pnpm test:e2e:live
```

它使用持久的 `dsh-editor-e2e` profile，而不是日常 `web`，读取本机模型配置，并可从未提交的 `.env` 读取 `NEW_API_API_KEY`；兼容旧变量 `API_KEY`。它会真实安装两个包、启动 DSH、调用 Chat/工具并写入 `e2e/out/live-xianxia`。默认端口为 8788，可用 `E2E_PORT` 修改。

当前脚本会尝试选择 UI 中名为 `deepseek-v4-flash` 的模型；模型目录或显示名变化时，先更新并审查 live E2E 的选择逻辑，不要把“找不到模型”误判成插件回归。

不要提交 `.env`、凭据、E2E 工作区或页面转储。该测试依赖可用模型与当前 UI，属于发布前的增强验收，不替代标准无凭据闸门。

## 6. 打包与产物契约

```powershell
pnpm build
pnpm pack:plugins
```

`pack:plugins` 会：

1. 仅重建仓库根部的 `.pack`；
2. 打包恰好两个当前版本 tarball；
3. 核对允许的文件清单、package identity 和 `dsh.bundle.patch`；
4. 扫描已构建代码，拒绝跨插件耦合和已移除的 proposal 协议；
5. 生成 `.pack/SHA256SUMS` 与 `.pack/release-manifest.json`。

`release-manifest.json` 记录 Git revision 和 `dirty`。只有从目标提交的干净工作区重建并得到 `dirty: false` 的包，才具备可发布来源；`.pack` 本身不进入 Git。

## 7. 交付与发布清单

本仓库把“产物可交付”和“已经发布”严格分开。任何 commit、push、tag、registry publish 或 release 都需要相应授权。

1. 确认版本和变更范围，更新两个包 manifest、包内 README 与 `CHANGELOG.md`。
2. `pnpm install --frozen-lockfile`。
3. 确保 `git status --short` 干净。
4. 运行 `pnpm verify:delivery`。
5. 检查 `e2e/out/plugin-matrix/report.json`：5 states、5 transitions、`issues: []`，DSH 版本正确。
6. 检查 `.pack/release-manifest.json`：revision 为目标提交，`dirty: false`。
7. 重新计算 tarball SHA-256，并与 `.pack/SHA256SUMS` 对照。
8. 如果模型环境可用，再运行 `pnpm test:e2e:live` 并审查报告。
9. 按明确授权决定是否提交、推送、打标签或发布；不要从脚本隐式执行这些动作。

## 8. 升级 DSH

DSH host contract 不是宽泛的 semver 承诺。升级时至少检查：

1. `scripts/dsh-cli.mjs` 中的 `EXPECTED_DSH_VERSION`；
2. `scripts/verify-artifacts.mjs` 中的 release compatibility；
3. `dsh-grill` 的 `@deepseek-ai/dsh-tools` peer/dev dependency 与 lockfile；
4. 两个 `cordis.patch.yml` 的 entry 是否仍能组合；
5. Manuscript 的 RPC、session、workspace、sandbox、`ctx.fs`、`llm.stream` 和 client slot 契约；
6. Grill 的 `defineTool`、pre-execute approval 和 `systemPrompt.section` 契约；
7. 用户指南、包内 README 与架构文档中的兼容说明。

升级依赖后完整运行 unit、typecheck、matrix 和 live E2E。没有这些证据，不要扩大兼容范围。

## 9. 调试索引

| 问题 | 首先查看 |
| --- | --- |
| 找不到或拒绝 DSH CLI | `DSH_CLI_PATH`、`scripts/dsh-cli.mjs`、实际 package version |
| 客户端没有出现 | 包内 `dsh.client`、`exports['./client']`、`cordis.patch.yml`、浏览器 page errors |
| Host/RPC 失败 | 当前 live session、workspace membership、sandbox mode、`ctx.fs` 返回错误 |
| 保存冲突 | opaque version、`replaceIfVersion`、本地 draft 状态和 E2E 页面转储 |
| Grill 工具未出现 | `grill-tools` entry、`dsh-tools` host peer、profile dump config |
| 模式提示未生效 | `grill-workflow` entry、`systemPrompt.section` 组装和 prompt tests |
| 矩阵失败 | `e2e/out/plugin-matrix/report.json`、对应 stdout/stderr、failure HTML/PNG |
| live E2E 失败 | `e2e/out/live-xianxia/report.json`、页面转储、模型/凭据与端口占用 |

## 10. 文档权威边界

- 安装、使用、升级、回滚、卸载：`docs/user-guide.md`
- 开发命令、测试、打包、发布：`docs/development.md`
- 架构、不变量、非目标和风险：`docs/architecture.md`
- 单包能力、exports、peer 和宿主契约：各 package README
- 已发生的版本变化：`CHANGELOG.md`

修改命令、版本、profile、副作用、包名、entry ID 或交付流程时，同一提交内更新对应权威文档。不要把 CHANGELOG 变成第二份操作手册。
