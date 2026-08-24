# DSH Editor 使用者指南

本指南面向安装和使用插件的作者。构建、调试和发布流程见 [开发者指南](development.md)。

## 1. 选择需要的插件

| 你的需求 | 安装选择 |
| --- | --- |
| 在 DSH 里浏览、创建、编辑和保存 Markdown 稿件 | `dsh-manuscript` |
| 在官方 Chat 中获得小说规划、起草、审查和首读协作 | `dsh-grill` |
| 同时需要稿件编辑和 Chat 协作 | 两者都安装 |

`dsh-grill` 不会替你保存 Chat 里的正文；`dsh-manuscript` 也不会改变官方 Chat。两者可以独立工作。

## 2. 安装前准备

你需要：

- Windows 上已安装且可运行的 DSH `0.1.1-rc.1`；
- 对应版本的两个 `.tgz` 交付包，通常位于项目的 `.pack` 目录；
- 安装目标 profile，本指南使用官方 Web profile `web`。

先确认命令可用并核对版本：

```powershell
Get-Command dsh
dsh --version
```

期望输出为 `0.1.1-rc.1`。如果找不到命令，请先安装或修复官方 DSH CLI；本项目不分发 DSH 宿主。如果版本不同，先不要安装，请让交付者针对该 DSH 版本重新验证。

`web` profile 在首次运行时会使用 DSH 自带模板自动初始化：

```powershell
dsh --profile web
```

看到 Web 启动后，可先按 `Ctrl+C` 停止，再继续安装插件。已经有 `web` profile 的用户无需重复初始化。

如果交付目录同时包含 `SHA256SUMS`，安装前核对包完整性：

```powershell
Get-FileHash .pack/*.tgz -Algorithm SHA256 | Format-Table Hash, Path
Get-Content .pack/SHA256SUMS
```

两边对应文件的哈希必须相同。

## 3. 安装插件

如果 `web` profile 正在前台运行，先在它的终端按 `Ctrl+C`，等待进程退出。若通过其他入口启动，请从原入口停止它。

在项目或交付目录根部运行：

```powershell
$repoPath = (Resolve-Path .).Path.Replace('\', '/')
dsh plugin --profile web add "file:$repoPath/.pack/dsh-manuscript-0.1.0.tgz"
dsh plugin --profile web add "file:$repoPath/.pack/dsh-grill-0.1.0.tgz"
```

只需要一个插件时，只执行对应命令。安装完成后重新启动 DSH：

```powershell
dsh --profile web
```

### 确认安装结果

在另一个终端运行：

```powershell
dsh --profile web --dump-config
```

期望条目：

- `dsh-manuscript`：`manuscript`
- `dsh-grill`：`grill-tools`、`grill-workflow`

## 4. 首次使用 Manuscript

1. 在官方 DSH 中选择一个本地工作区，并进入该工作区的普通会话。
2. 点击界面左上区域的 **“稿纸”** 按钮打开抽屉。
3. 从上方文件树选择文本文件；点击 **“新建”** 会在当前目录创建一个 `.md` 文件。
4. 在正文编辑器内编辑，使用 `Ctrl+S` 保存。标题栏会显示字数和“已保存 / 未保存 / 需处理”等状态。
5. **“上一篇 / 下一篇”** 在当前目录的文件之间导航。
6. 选中文字后点击 **“改这段”**，插件会把改写请求复制到剪贴板；将它粘贴到官方 Chat 中继续协作。
7. 点击 **“补全”** 或暂停输入可请求补全；出现灰色候选后按 `Tab` 采纳、按 `Esc` 放弃。

补全使用当前会话已经选择的模型。没有模型、模型不支持或没有返回候选时，补全会保持为空，不影响手工编辑和保存。

### 未保存草稿与冲突

- 切换文件或工作区前，如果有未保存内容，插件会要求你保存或明确放弃。
- 关闭稿纸时会先确认；确认关闭后，当前内容仍作为浏览器会话草稿保留，重新打开或刷新时会尝试恢复。
- 刷新页面后，未保存草稿会尝试从当前浏览器会话恢复。
- 如果磁盘版本已变化，插件会保留本地内容并显示“需处理”。先复制仍需保留的内容，再决定是否“放弃草稿并重新读取”。
- 浏览器会话草稿不是备份。清除站点数据、换浏览器或卸载前，请先保存到磁盘或另行复制。

当前只支持文本文件，单个文件上限 2 MB；绝对路径、路径穿越、符号链接和只读写入会被拒绝。

## 5. 首次使用 Grill

`dsh-grill` 没有独立页面。它在官方 Chat 中根据你的请求选择协作模式：

| 模式 | 适合的请求 | 默认行为 |
| --- | --- | --- |
| `planning` | 构思剧情、大纲、人物目标、场景交接 | 先理清事实和缺口，不默认写正文 |
| `drafting` | 写、续写、润色或重写指定范围 | 在 Chat 中交付草稿，不写入磁盘 |
| `review` | 审查成稿、找问题 | 按影响排序报告，默认不改正文 |
| `first-reader` | 模拟首次读者体验 | 按阅读顺序报告感受，不当编辑 |

你可以直接用中文说明目标，也可以明确说“用 planning 模式”之类的要求。

### 创建小说目录

在已经选择工作区的普通 Agent 会话中，可以说：

> 在当前工作区调用 `scaffold_novel` 创建小说目录。

DSH 会显示官方工具审批。确认后，工具会创建 `正文`、`大纲`、`人物卡`、`世界书` 等目录和少量起始 Markdown 文件。已存在的路径会跳过，不会覆盖原文件；只读工作区会拒绝执行。

## 6. 更新、回滚与卸载

执行这些操作前：

1. 用 `Ctrl+S` 保存稿件，另行复制仍需保留的浏览器草稿；
2. 停止正在运行的目标 profile；
3. 保留当前 tarball 和对应 `SHA256SUMS`，作为回滚点。

卸载命令：

```powershell
dsh plugin --profile web remove dsh-manuscript
dsh plugin --profile web remove dsh-grill
```

卸载一个不会卸载另一个，也不会主动删除工作区里的正文或 `scaffold_novel` 已创建的文件。重新启动 DSH 后，用 `--dump-config` 确认对应条目消失。

升级或回滚时，先移除当前包，再使用第 3 节的 `file:` 命令安装目标版本 tarball，随后重启并核对配置。

## 7. 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 看不到“稿纸”按钮 | 确认 `--dump-config` 中存在 `manuscript`，然后完整重启 Web profile。 |
| 稿纸显示“没有工作区” | 在官方 DSH 中选择工作区并进入该工作区的普通会话。 |
| 保存显示冲突或“需处理” | 本地草稿仍在。先复制需要保留的内容，再重新读取磁盘版本；不要把“放弃草稿”当成合并操作。 |
| 补全没有任何内容 | 确认当前会话已选择模型；补全是可选能力，失败不会影响编辑和保存。 |
| Grill 没有体现四种模式 | 确认配置中存在 `grill-workflow`，重启 profile，并在官方 Chat 中明确说明 planning、drafting、review 或 first-reader 目标。 |
| `scaffold_novel` 被拒绝 | 确认当前是带工作区的普通 Agent 会话、sandbox 不是 read-only，并在官方审批界面授权。 |
| 安装命令提示包不存在 | 确认 `.pack` 内文件名和版本与命令完全一致，并使用绝对 `file:` 路径。 |
| DSH 版本不匹配 | 不要强行安装。请使用已验证的 DSH `0.1.1-rc.1`，或让开发者完成升级验证。 |

## 8. 已知限制

- 仅支持 DSH 本地单用户使用；不要把 Manuscript RPC 暴露为远程多用户接口。
- 稿纸使用 DSH 公共 overlay 槽位，是 360px 可关闭抽屉，不是永久三栏布局。
- Manuscript 不提供重命名、删除、移动、目录创建、文件监听、索引或 Git 操作。
- Grill 不会自动把 Chat 输出写入正文，也不包含扫描器、联网生成或隐藏提案系统。

更详细的技术边界见 [架构与边界](architecture.md)。
