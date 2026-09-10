# DSH Editor 插件架构与接口

本文是修改、替换或新建 DSH Editor 插件的权威手册。通用产品边界见 [architecture.md](architecture.md)，产品原则见 [product-principles.md](product-principles.md)，开发和验收命令见 [development.md](development.md)。

当前兼容基线固定为 DSH `0.1.1-rc.2`。私有 `root` 接口尤其不是上游公共承诺；升级 DSH 前必须重新验证本文列出的全部桌面能力。

## 交互架构图

| 图 | 说明 | 打开 |
| --- | --- | --- |
| 插件拓扑 | 公开 Web 与桌面私有包、loopback RPC、DSH 权威 | [dsh-editor-plugins.html](https://klarkxy.github.io/dsh-editor/dsh-editor-plugins.html) |
| 确认写入 | 预览提案不写文件；作者确认后才 `proposal.apply` | [author-confirm-write.html](https://klarkxy.github.io/dsh-editor/author-confirm-write.html) |
| 桌面运行时 | 进程、profile 与写作主路径 | [dsh-editor-runtime.html](https://klarkxy.github.io/dsh-editor/dsh-editor-runtime.html) |
| 组合边界 | 普通业务、小说助手、公开插件三个视角 | [plugin-composition-boundaries.html](https://klarkxy.github.io/dsh-editor/plugin-composition-boundaries.html) |

规范源文件在 [diagrams/](diagrams/) 下的同名 `.json`；交互图由 `.github/workflows/pages.yml` 发布到 GitHub Pages。

## 运行拓扑与所有权

当前支持 basic/smart/full 三份桌面组合及四个独立公开包。安装、最小插件范本和无 Web/Agent 实验见[组合指南](plugin-composition-guide.md)。下图展示默认 full；kernel、assist 和知乎按组合选择。

一个 Electron 进程只启动一个 loopback DSH Host。所有插件共享 DSH 的 session、workspace、model、tools、approval 和 connection 权威，不创建第二套状态。

```text
Electron bootstrap（不可插件化：窗口、内置运行时、profile 部署、子进程监督）
└─ profiles/dsh-editor
   ├─ @deepseek-ai/dsh-base
   ├─ @deepseek-ai/dsh-web-app
   ├─ dsh-manuscript
   │  ├─ Host: /manuscript、draft storage、稿件安全读写；FIM/计量由可选 assist 服务承接
   │  └─ Client: shell.overlay（公开 Web 插件）
   ├─ dsh-editor-workbench
   │  └─ Host: /dsh-editor-workbench、项目/概览/状态/校对/卡片/进度/导入/快照/归档/context；可选 tools entry 提供 novel_overview
   ├─ dsh-editor-novel-kernel
   │  └─ Host: novel_* 工具、guard、system prompt、知识卡、`/novel-kernel` 旧知乎入口转发
   ├─ dsh-proofread：纯引擎、/proofread、插件自有 UI
   ├─ dsh-zhihu：/zhihu、凭据/计量、插件自有 UI；Tool entry 可选
   └─ dsh-editor-shell
      ├─ Host: 注册 `dsh-editor-writing` 设置 schema
      └─ Client: 唯一 root GUI、各写作面板、DshChatPort、编辑状态、作者确认

普通 profiles/web（按需分别安装）
├─ dsh-manuscript
├─ dsh-grill
├─ dsh-proofread
└─ dsh-zhihu
```

写作会话不挂载官方 `standard` 编码 preset：桌面应用在每次部署 profile 时，把模板里的 `agent-presets/dsh-editor/`（persona、`tool-fs`、`tool-fs-search`、`tool-ask-user`、compaction realm）原子部署到 `<dshHome>/.agent-presets/`，并由 profile 的 `cordis.patch.yml` 将 `agent-presets.default` 指向它。preset 目录遵循与 profile 相同的 owner marker 规则，未标记的同名目录拒绝覆盖。

依赖方向固定如下；禁止跨包导入另一个包的 `src`：

```text
dsh-editor-shell/client
├─ dsh-editor-workbench/contracts（构建时内联）
├─ dsh-editor-novel-kernel/contracts（构建时内联）
└─ dsh-manuscript/client/editor-core（共享稿纸核心：editor / state / completion-preference / styles）

dsh-editor-workbench/host
├─ dsh-manuscript/host-api
└─ dsh-proofread/engine、defaults、contracts（纯库）

dsh-editor-novel-kernel/host
└─ Cordis + DSH tools
```

## 插件与入口目录

| 包 / Cordis entry | 接口与职责 | 稳定级别 | 交付范围 |
| --- | --- | --- | --- |
| `dsh-manuscript` / `manuscript` | `/manuscript`、`shell.overlay`、draft/FIM/patch/proposal | public | 公开 tarball；Web 与桌面 |
| `dsh-proofread` / `proofread` | `/proofread`、纯引擎与双 slot UI | public | 独立 tarball；写作组合的引擎依赖 |
| `dsh-zhihu` / `zhihu` | `/zhihu`、独立 UI/凭据/用量 | public | 独立 tarball；full 启用 Tool |
| `dsh-manuscript/assist` / `manuscript-assist` | 可选 FIM/patch/LLM 计量服务 | public optional entry | smart/full；旧 Web 默认保留 |
| `dsh-editor-workbench/tools` / `editor-workbench-tools` | 可选 novel_overview | private optional entry | smart/full |
| `dsh-grill/tools` / `grill-tools` | `scaffold_novel` Tool 与 guard | public | 公开 tarball；Web |
| `dsh-grill/workflow` / `grill-workflow` | `grill:workflow` prompt | public | 公开 tarball；Web |
| `dsh-editor-workbench` / `editor-workbench` | 私有工作区生命周期、概览/状态、校对、卡片、进度 RPC | private host-only | 桌面 profile 必需 |
| `dsh-editor-novel-kernel` / `editor-novel-kernel` | 私有小说工具、guard、prompt、知识卡、`/novel-kernel` | private host-only | smart/full 必需；basic 不装 |
| `dsh-editor-shell` / `editor-shell` | 唯一 `root` client 与写作设置 schema | fixed-version private | 桌面 profile 必需 |

各包 `cordis.patch.yml` 中的 entry id：

| 包 | entry id | name |
| --- | --- | --- |
| `dsh-manuscript` | `manuscript` | `dsh-manuscript` |
| `dsh-manuscript` | `manuscript-assist` | `dsh-manuscript/assist` |
| `dsh-proofread` | `proofread` | `dsh-proofread` |
| `dsh-zhihu` | `zhihu` | `dsh-zhihu` |
| full 组合显式加入 | `zhihu-tools` | `dsh-zhihu/tools` |
| `dsh-editor-workbench` | `editor-workbench-tools` | `dsh-editor-workbench/tools` |
| `dsh-grill` | `grill-tools` | `dsh-grill/tools` |
| `dsh-grill` | `grill-workflow` | `dsh-grill/workflow` |
| `dsh-editor-workbench` | `editor-workbench` | `dsh-editor-workbench` |
| `dsh-editor-novel-kernel` | `editor-novel-kernel` | `dsh-editor-novel-kernel` |
| `dsh-editor-shell` | `editor-shell` | `dsh-editor-shell` |

`dsh-editor-workbench/contracts` 与 `dsh-editor-novel-kernel/contracts` 是 browser-safe 内部兼容面：只能包含常量、类型、解析器和纯函数，不能导入 Node、Cordis Host 或文件系统。Shell 的 client 构建必须内联它们，浏览器产物不得在运行时解析私有 Host 包。

`dsh-manuscript/host-api` 是公开但狭窄的 Host 子入口，只提供 live-session workspace authority、受约束文件/路径原语与标准 Host 错误映射。它不是任意文件系统 SDK，也不包含桌面 workbench endpoint。

## Host、Client、inject 与生命周期

- Host 入口导出 `name`、`inject`、`apply(ctx)`；只声明实际使用的 service。
- Cordis entry 由包内 `cordis.patch.yml` 插入，entry id 和 prompt section name 必须全局唯一。
- 所有 `handle`、`guard`、事件订阅或资源必须通过 `ctx.effect` 或等价 disposer 清理。
- Client 只能使用 DSH 注入的 runtime、connection 和 slots；Renderer 不得访问 Node、凭据、绝对路径或进程。
- 普通附加界面使用 `shell.overlay` 等 additive slot。`root` 只能有一个所有者；替换 Shell 时必须先移除 `editor-shell`，不能并存两个 root。
- DshChatPort 只投影官方 `SessionFace`、`ConversationSnapshot`、send/cancel、model/permission、approval/questions。插件不得复制 Chat、启动第二次 connection 或自行执行 Tool。

当前 inject 清单（必须与源码保持一致）：

| 包 | `name` | `inject` |
| --- | --- | --- |
| `dsh-manuscript` Host | `dsh-manuscript` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `storageDomain` |
| `dsh-editor-workbench` | `dsh-editor-workbench` | `connection`, `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy` |
| `dsh-editor-novel-kernel` | `dsh-editor-novel-kernel` | `tools`, `systemPrompt`, `fs`, `connection`, `sandboxPolicy` |
| `dsh-editor-shell` Host | `dsh-editor-shell` | `settings`, `connection` |
| `dsh-editor-shell` Client | `dsh-editor-shell-client` | `slots`, `sessions`, `workspaces`, `connection`, `settingsScope`, `settingsSchema`, `remote` |
| `dsh-proofread` Host | `dsh-proofread` | `connection` |
| `dsh-proofread` Client | `dsh-proofread-client` | `slots`, `connection` |
| `dsh-zhihu` Host | `dsh-zhihu` | `connection`, `credentials`, `storageDomain` |
| `dsh-zhihu/tools` | `dsh-zhihu-tools` | `zhihu`, `tools` |
| `dsh-manuscript/assist` | `dsh-manuscript-assist` | `llm`, `storageDomain` |
| `dsh-editor-workbench/tools` | `dsh-editor-workbench-tools` | `sessions`, `workspaceRegistry`, `fs`, `sandboxPolicy`, `tools` |
| `dsh-grill/tools` | `dsh-grill-tools` | `tools` |
| `dsh-grill/workflow` | `dsh-grill-workflow` | `systemPrompt` |

Shell 以 `root` slot id `dsh-editor-shell-root`、priority `-100`、label `DSH 编辑器` 注册。manuscript client 只注册 `shell.overlay`（id `manuscript`，order `100`，label `稿纸`），禁止占用 `root` 或 `conversation.view`。

Shell 另声明 `dsh-editor.extensions`（list/root）并渲染贡献；proofread 与 zhihu 在此及官方 `shell.overlay` 贡献同一个自有 Client。它们不接收 ShellContext，只使用自己的输入和 Connection；输入修订、取消、焦点和样式由插件生命周期维护。详见[挂载合同](plugin-composition-guide.md#最小插件开发范本)。

Shell client 构建会捆绑 `docx` 与 `jszip`，仅供导出对话框在 Renderer 内生成 DOCX/EPUB。manuscript editor-core 构建会捆绑 `@codemirror/search`，仅供稿内查找替换。两者都不进入 Host RPC。

## RPC 通用契约

`/manuscript`、`/dsh-editor-workbench`、`/novel-kernel`、`/proofread`、`/zhihu` 与 `/dsh-editor-shell` 都只以 `{ authority: 'loopback' }` 注册。loopback 限制网络暴露，但不是调用者身份；每个文件请求仍必须携带 live `sessionId` 并由 Host 重建 authority（`usage.summary` / `zhihu.usage` / `project.inspect` / `project.createHome` / 知乎知识库 RPC 例外，见下表）。

```ts
type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: unknown } }
```

Host 处理文件请求的固定顺序：

1. `sessions.get(sessionId)` 取得 live session。
2. 只读取 immutable `session.header.cwd`，忽略 Renderer 伪造的 cwd。
3. `workspaceRegistry.resolveByPath(cwd)` 取得 registered workspace，并确认 session 仍属于它。
4. 解析 sandbox policy 和 canonical root。
5. 拒绝 absolute、device、traversal、symlink/junction 与越界 target。
6. 创建使用 create-if-absent；覆盖使用 version/hash/token/no-clobber 门禁。
7. 将同一 `AbortSignal` 传到底层调用。

标准错误码包括 `bad-request`、`cancelled`、`session-not-found`、`workspace-attach-failed`、`workspace-not-found`、`workspace-invalid-path`、`directory-unreadable`、`directory-exists`、`internal`。UI 映射固定的可操作文案，不直接显示异常堆栈或未约束的 reason。

## `/manuscript`：公开稿件接口

Channel：`/manuscript`。除特别注明外，请求都包含 `sessionId`，路径均为 workspace-relative。第三列以「读」或「写」标明；`file.create` / `file.write` / `proposal.apply` 进入 `withWorkspaceWrite`。

| Endpoint | 请求字段 | 读/写 · 成功值 / 语义 |
| --- | --- | --- |
| `tree.list` | `sessionId`, `path` | 读 · `{ entries }`，有界目录项 |
| `file.read` | `sessionId`, `path` | 读 · `{ text, version }`，文本上限 2 MB |
| `file.create` | `sessionId`, `path`, `text` | 写 · create-if-absent |
| `file.write` | `sessionId`, `path`, `text`, `version` | 写 · replace-if-version |
| `draft.get` | `sessionId`, `path` | 读 · `{ draft }`，来自 DSH storage domain |
| `draft.list` | `sessionId`，可选窗口过滤 | 读 · `{ drafts }`，含其他窗口的 legacy 备份 |
| `draft.put` | `sessionId`, `path`, `text`, `baseText`, `baseVersion` | 写 · 只保存草稿（storage domain），不改正文 |
| `draft.delete` | `sessionId`, `path` | 写 · 删除对应草稿（须带匹配 revision） |
| `search.text` | `sessionId`, `query`, `scope: project\|manuscript` | 读 · 有界字面量搜索；不接受正则 |
| `proposal.prepare` | `sessionId`, `kind`, `path`, `summary`；edit 加 `oldText`, `newText`；create 加 `text` | 读 · 只读预检和作者确认信息 |
| `proposal.apply` | prepare 的全部字段；edit 另加 `expectedVersion` | 写 · 作者确认后按版本门禁创建或修改；edit 的 `oldText` 为空表示填充仍为空白的目标文件，create 也可覆盖仍为空白的目标文件 |
| `fim.complete` | `sessionId`, `prefix`, `suffix`，可选 `authorPreferences`，可选 `chapterContext`（≤1 200，去控制字符） | 读 · `{ text, route: 'dsh-llm' }`，只返回候选 |
| `patch.complete` | `sessionId`, `path`, `selectedText`, `before`, `after`，可选 `authorPreferences`，可选 `chapterContext`（≤1 200），可选 `instruction`（≤400，改写要求） | 读 · `{ text, route: 'dsh-llm' }`，只返回候选 |
| `usage.summary` | 可选 `days` | 读 · 本机用量快照；不要求 `sessionId` |
| `zhihu.usage` | 可选 `days` | 读 · 知乎检索计量；不要求 `sessionId` |

不得把导入、快照、归档或任意 Node FS 能力加入这个公开 channel。稿纸 editor-core 另捆绑 `@codemirror/search`，只服务稿内查找替换，不增加 Host 端点。

## `/dsh-editor-workbench`：私有桌面接口

Channel：`/dsh-editor-workbench`（常量 `WORKBENCH_RPC_CHANNEL`）。类型面在 `dsh-editor-workbench/contracts`。第三列以「读」或「写」标明。进入 `withWorkspaceWrite` 的写入端点：`project.init`、`project.prepareIndex`、`project.importApply`、`project.importCleanup`、`snapshot.create`、`snapshot.rollback`、`snapshot.restoreApply`、`snapshot.restoreCleanup`、`structure.groupCreate`、`directory.create`、`file.rename`、`file.moveManuscript`、`archive.apply`、`archive.restore`、`proposal.apply`、`entry.copy`、`entry.move`、`entry.delete`、`entry.rename`、`chapter.statusSet`、`progress.record`、`cards.metaSet`、`cards.create`。`project.createHome` 在作品目录外建文件夹，不入该队列。

| Endpoint | 请求字段 | 读/写 · 成功值 / 语义 |
| --- | --- | --- |
| `project.inspect` | `workspacePath` | 读 · `{ hasVisibleEntries, textFiles, indexReady }`；用已注册路径，不要求 `sessionId` |
| `project.createHome` | `title` | 写 · `{ path }`，在「文档/dsh-editor」下独占创建同名空文件夹；不接受调用方传入的父路径 |
| `project.init` | `sessionId`, `newProject` | 写 · `{ created, skipped }`，只建立空的 `正文` 目录，不写入 Markdown 模板；大纲/人物卡/世界书在实际创建后出现 |
| `project.prepareIndex` | `sessionId` | 写 · 索引准备回执 |
| `project.overview` | `sessionId` | 读 · 章节/大纲摘要（章节含 `status`、可选 `meta: { beats, hasState }`）、总字数、`totals.byStatus` 分布、最近 1 项 `recent` 与最近 5 项 `recentChapters`、有界扫描警告 |
| `proofread.scan` | `sessionId`, `scope`（`document` / `manuscript`），`document` 时必填 `path`，可选 `kinds` | 读 · 确定性校对：`punctuation` / `typo` / `sensitive` / `repeat` / `habit` / `card`（默认含 `card`）。返回 `findings`（最多 500，`truncated`）、`scannedFiles`、`skipped`、`habitStats`（口癖千分比前 30）。`document` 只扫一篇作者内容 `.md`/`.txt`；`manuscript` 按自然序扫 `正文/`。`card` 对照人物卡/世界书：代词性别不一致（`card-gender`）、专名近形误写（`card-nearmiss`，词表 >400 则跳过近形检查并计入 `skipped`）。默认词库在 `resources/proofread/`，作品可追加 `.dsh-editor/敏感词.txt`、忽略 `.dsh-editor/敏感词-忽略.txt` |
| `cards.list` | `sessionId`, `kind`（`character` / `worldbook` / `all`） | 读 · 结构化卡片列表：`characters`、`worldbook`，每张含 `path`、`title`、`frontmatter`、`summary`（frontmatter.summary 或正文首段 ≤ 120 字）、`version`、`modifiedAt`。自然序，跳过隐藏/生成目录，最多 2000 文件，带 `scannedFiles` / `skipped` / `truncated` |
| `cards.metaSet` | `sessionId`, `path`, `version`, `fields` | 写 · 只改 YAML frontmatter，正文按字节保留，未知键原样保留；版本冲突走 `bad-request`。成功 `{ path, version }` |
| `cards.references` | `sessionId`, `path` | 读 · 引用导航：人物卡用 `name`+`aliases`，世界书用 `triggers`（否则文件名）。在 `正文/**/*.{md,txt}` 做字面量检索，最多 200 条 `hits`（`path`/`line`/`column`/`start`/`end`/`excerpt`），带 `terms`、`scannedFiles`、`truncated` |
| `cards.create` | `sessionId`, `kind`, `title`，可选 `fields` | 写 · 在 `人物卡/<title>.md` 或 `世界书/<title>.md` 新建卡片（frontmatter + `# <title>`）。文件名规则与 `entry.*` 相同；重名或非法名拒绝 |
| `chapter.statusSet` | `sessionId`, `path`, `status` | 写 · `{ path, status }`，把 `正文/` 下章节设为 `draft` / `revising` / `final`；默认草稿，损坏状态文件 fail-open |
| `progress.record` | `sessionId`, `totalChars` | 写 · 按本地日期写入/覆盖当天 `.dsh-editor/writing-log.json` 条目（最多 400 天，原子写）；防抖由调用方负责（shell 保存后 5 秒） |
| `progress.history` | `sessionId`，可选 `days`（默认 30） | 读 · 窗口内每日 `{ date, chars, delta }` 与按周汇总 `{ weekStart, chars, delta }` |
| `structure.groupCreate` | `sessionId`, `path` | 写 · 只在 `正文` 下建立一级卷/部目录 |
| `directory.create` | `sessionId`, `path` | 写 · 在任意已存在的父目录下建一个可见目录（通用，无 正文 特化） |
| `context.compile` | `sessionId`, `userRequest`，可选 `activePath`, `authorPreferences`, `authorMemory` | 读 · `{ serialized, receipt }`，有界 V2 context 信封 |
| `project.importProbe` | `targetSessionId`，可选 `sourceSessionId` | 读 · token、统计、预览或恢复状态；不写入 |
| `project.importApply` | `targetSessionId`, `sourceSessionId`, `probeToken` | 写 · 重新 probe 后执行 no-clobber 导入 |
| `project.importCleanup` | `targetSessionId`, `receiptId` | 写 · 只清理 manifest/hash 证明归属的中断写入 |
| `snapshot.list` | `sessionId` | 读 · 快照列表；不包含未保存 buffer；`.dsh-editor/*` 不在 payload 内 |
| `snapshot.create` | `sessionId`，可选 `label` | 写 · 原子发布后的 snapshot view；简易提交流程的 label 即当前时间 |
| `snapshot.rollback` | `sessionId`, `snapshotId` | 写 · 原地回滚：覆盖/删除回到快照状态，先自动创建安全快照（可再回滚撤销）；非文本文件不动 |
| `snapshot.restoreProbe` | `targetSessionId`，可选 `sourceSessionId`, `snapshotId` | 读 · 只恢复到新空 workspace 的 token/状态（跨作品恢复，与原地回滚不同） |
| `snapshot.restoreApply` | `targetSessionId`, `sourceSessionId`, `snapshotId`, `token` | 写 · no-clobber 恢复统计 |
| `snapshot.restoreCleanup` | `targetSessionId`, `receiptId` | 写 · hash-protected 中断清理 |
| `file.rename` | `sessionId`, `path`, `newName`, `expectedVersion` | 写 · 同目录、保留扩展名后的新路径 |
| `file.moveManuscript` | `sessionId`, `path`, `targetDirectory`, `expectedVersion` | 写 · 仅在 `正文` 树内 no-replace 移动 |
| `file.readBinary` | `sessionId`, `path` | 读 · `{ base64, mime }`；仅 jpg/jpeg/png/gif/webp/avif/svg，上限 20 MB |
| `archive.list` | `sessionId` | 读 · 可恢复 archive view 与损坏项计数 |
| `archive.apply` | `sessionId`, `path` + `expectedVersion`，或 `archiveId` | 写 · 新归档或继续中断归档；界面只允许单个可见 Markdown/TXT |
| `archive.restore` | `sessionId`, `archiveId`，可选 `expectedVersion` | 写 · no-replace 恢复后的 archive view |
| `proposal.prepare` | `sessionId`, `proposal` | 读 · 仅 `split` / `merge` / `renames`；`edit` / `create` 走 `/manuscript` |
| `proposal.apply` | `sessionId`, `proposal`, 可选 `expectedVersions` | 写 · 拆章、合章（来源进归档）或批量重命名 |
| `entry.copy` | `sessionId`, `path`, `targetDir` | 写 · 文件或目录复制，同名自动改名 |
| `entry.move` | `sessionId`, `path`, `targetDir` | 写 · 文件或目录移动，同名拒绝 |
| `entry.delete` | `sessionId`, `path` | 写 · 永久删除文件或目录（与可恢复归档不同，确认后不可从归档恢复） |
| `entry.rename` | `sessionId`, `path`, `name` | 写 · 文件或目录就地改名 |

这些 endpoint、字段、V1/V2 envelope、token、receipt、manifest、hash 与重新验证语义是兼容接口。物理换包不构成协议升级。

章节状态存在 `.dsh-editor/chapter-status.json`（`{ version: 1, statuses }`，键为规范化相对路径，缺省与 `draft` 不落盘）。写作字数日志存在 `.dsh-editor/writing-log.json`（`[{ date, chars, delta? }]`，本地日期、按日去重）。两份文件缺失或损坏时 Host fail-open 到默认值，孤立键不影响概览。`chapter.statusSet` 只接受 `正文/` 下已存在的 Markdown/TXT。`progress.record` 必须便宜且原子，防抖由调用方负责。`proofread.scan` 合并包内默认敏感词与 `.dsh-editor/敏感词.txt`，并用 `.dsh-editor/敏感词-忽略.txt` 做允许表；列表缺失或损坏时 fail-open 到默认词库。人物卡 / 世界书 frontmatter 是容错 YAML：人物卡可选 `name` / `aliases` / `role` / `gender` / `age` / `faction` / `tags` / `status` / `relations` / `summary`；世界书可有 `category` / `tags` / `summary`，旧文件的 `triggers` / `enabled` / `priority` 按键原样保留但不再驱动自动注入。未知键在 `cards.metaSet` 中按原文保留，损坏字段 fail-open 到缺省值。

章节 Markdown（`正文/**/*.md`）可选 YAML frontmatter：`beats`（字符串列表，最多 12 条、每条 ≤ 120 字）与 `state`（可选 `now` / `where` / `knows` / `ended` / `open`，各为标量，合计 ≤ 300 字）。未知键与注释按原文保留；TXT 章节不使用 frontmatter。无 frontmatter 解析为 `{}`，损坏或未闭合解析为缺省。`project.overview` 的字数 / 标题 / 摘要 / 空章按去掉 frontmatter 的正文计算，并带可选 `ChapterSummary.meta`。

`.dsh-editor/*` 隐藏元数据一律不进入快照 payload。重命名、正文跨卷移动、归档和恢复响应可以带 `metadataWarning`，表示正文操作已经成功但附带的元数据未同步，调用方不得据此回滚正文。

Context 信封常量：

- `schema`: `dsh-editor.project-context`
- 历史版本 `1` / `2`（每轮注入固定来源与世界书全文），当前版本 `3`
- V3 只含 `user_request` 与可选 `active_path`：固定资料与世界书不再自动注入，作品背景由项目根 `AGENTS.md`（system 区常驻）与按需 `glob`/`grep`/`read` 提供。旧会话恢复时，仍在模型上下文里的 V1/V2 信封会被有日志地替换回原用户请求。
- V2 可选 `chapter_context: { path, beats?, previous?: { path, state } }`：当前章 `beats` 与上一章非空 `state`；皆无则省略。回执带 `chapterContext?: { path, beats, previousPath? }`。

## Novel Kernel 契约

- 工具名：`novel_knowledge`、`novel_propose`、`author_observe`、`novel_index_write`（另有只读的 `novel_overview`——由 workbench-tools 注册，以及 `novel_scratch_write`/`novel_scratch_read`/`novel_scratch_list` 临时工作区三件套）。项目内查找改用原生 `glob`/`grep`/`read`；旧的 `novel_search`/`project_knowledge` 不再向新会话注册。
- `novel_memory_update`（workbench 注册）在协作中维护根 `AGENTS.md`、`世界书/**/*.md`、`人物卡/**/*.md`：来源逐字引用与文件版本由 Host 校验；明确的创建/追加自动落盘，修订、推断与冲突形成待确认记录，全部写入 `.dsh-editor/history/memory/`，重启后可查看与撤销（新建文件的撤销走归档）。
- `novel_knowledge` 只接受唯一的 `topics` 数组，去重后 1–3 个固定主题；每张知识卡最多 6000 字符。它只返回建议，不提供项目事实或授权。
- `novel_propose` 每次形成一个 Markdown `edit` / `create` / `split` / `merge` / `renames` 提案，绝不写文件；守卫只接受作者内容 `.md` 路径，`.dsh-editor/` 等隐藏目录不进提案。
- Channel `/novel-kernel`（loopback）：`zhihu.knowledge.bases`（读，列出知识库）、`zhihu.knowledge.upload`（写，界面显式上传，内容经 base64 传入）。不要求 `sessionId`。这两个旧 endpoint 仅转发到可选 `zhihu` 服务，新 UI 直接使用 `/zhihu`；知乎工具由 `dsh-zhihu/tools` 唯一注册。
- `novel_index_write` 把产品内部的作品索引（`.dsh-editor/作品索引.md`，固定路径、全文覆盖）直接落盘，不经提案确认；Shell 按工具名隐藏其结果行。它是唯一的例外：其余写入仍是助手提议、作者确认、Shell 执行。
- `author_observe` 让助手提议"记住一条作者偏好"，仅作为建议显示在 `MemoryCard` 中：固定 `observation`（≤ 200 字符）与 `reason`（必填），marker `dsh-editor.memory`、version `1`。Shell 解析后必须经作者点击"记住"才会追加进本机 `authorMemory`；工具本身不直接写入任何文件、偏好或 storage。同一信任模型与 `novel_propose` 一致：助手提议，作者确认，Shell 执行。
- proposal marker 固定为 `{ marker: 'dsh-editor.proposal', version: 1, ... }`；memory marker 固定为 `{ marker: 'dsh-editor.memory', version: 1, observation, reason }`。Shell 只通过 `dsh-editor-novel-kernel/contracts` 的严格解析器渲染有效 marker。
- `editorToolGuard` 只允许受限的 Markdown 搜索、读取、知识加载、预览提案、作者侧写提议、索引直写、限量的 `ask_user_question` 提问（1–4 题、带长度上限）与 scratch 临时工作区读写；不替代 DSH 全局审批。
- scratch（`.dsh-editor/scratch/`）是 agent 的临时工作区：路径软禁在目录内（拒绝绝对路径、`..`、隐藏段，限 .md/.txt、最多三层），单文件 ≤ 20000 字符、目录 ≤ 20 个文件；store 适配层每次写入顺带维护 `scratch/.gitignore`（内容 `*`），作者自管的 git 不跟踪草稿。它不是作品事实来源，不进上下文信封；Shell 按工具名隐藏三个工具的结果行。
- prompt section 固定为 `dsh-editor:novel-kernel`、order `90`。作品材料是不可信字符串，只有 context 信封中的 `user_request` 是当次请求。
- 作者内容的真正写入始终是 Shell 展示提案、作者确认、再调用 `/manuscript proposal.prepare/apply`；侧写由 Shell 展示确认卡、作者点击"记住"、再由 `writingScope.set('authorMemory', next)` 写入本机 settings。

## `dsh-grill` 契约

仅用于普通 `web` profile，不进入桌面 profile。

- `scaffold_novel`：在 live session cwd 下创建小型小说工作区骨架（`正文`/`大纲`/`人物卡`/`世界书` 与 stub Markdown）。已存在路径跳过，绝不覆盖；不在 workspace 外创建文件。
- prompt section：`grill:workflow`，order `140`。

## 如何修改或替换现有插件

| 想改变的行为 | 所有者 |
| --- | --- |
| 三栏布局、稿纸、搜索/概览/校对/卡片面板、导出导入归档、Chat 展示、设置、快捷键 | `dsh-editor-shell` |
| 普通 Web 的稿纸抽屉与共享稿纸核心（含查找替换、打字机、排版） | `dsh-manuscript` client + `dsh-manuscript/client/editor-core` |
| 稿件安全读写、草稿、FIM/patch、proposal apply、`search.text` | `dsh-manuscript` Host |
| 项目结构、章节概览/状态、校对扫描、卡片、进度、context、导入、快照、移动、归档 | `dsh-editor-workbench` |
| 小说知识、proposal Tool、guard、系统提示词、`/novel-kernel` | `dsh-editor-novel-kernel` |
| 窗口、内置 DSH、profile、portable | `apps/desktop` 与桌面物化脚本 |
| `scaffold_novel` 与 grill 写作提示 | `dsh-grill`（仅 Web） |

替换 workbench 或 kernel 时：

1. 保持现有 channel/tool/prompt/marker contract，先让替代实现通过原 contract tests。
2. 在 profile 中删除原 Cordis entry，再加入新实现；同一能力只能注册一次。
3. 保持一个 Host、一个 connection、一个 root，以及同一 live-session workspace authority。
4. 同步开发、runtime、package verification 与 E2E 清单。
5. 按完整 profile 原子部署和回滚，不依赖热切换保留 Host 状态。

## 新建 Host-only 插件

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-writing-plugin'
export const inject = ['tools', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  // 注册 tool / prompt；通过 ctx.effect 返回 disposer。
}
```

建立步骤：

1. 说明独立用户价值，选择 public 或 desktop-private；没有独立启停价值的代码留在原包内。
2. 参考 `dsh-grill` 或 novel-kernel 复制最小包形态，不复制 Chat、session 或 workspace 权威。
3. 建立唯一 Cordis entry id/name，只声明实际 inject。
4. 文件能力依赖 live session 和 `dsh-manuscript/host-api`；不接收 Renderer 提供的 cwd/provider/model。
5. 增加 package-local unit/contract tests，再接入对应 profile、复制、校验和 E2E。
6. 公开包加入 `pack:plugins` 与 fresh-home 安装矩阵；私有包只加入桌面 profile，不进入公开 tarball。

## 新建 overlay 插件

dual-face Web 插件参考 `dsh-manuscript`：Host 为 ESM，client 通过 `wrap-client.mjs` 生成 DSH lazy CJS 包装，manifest 声明 `dsh.client.platform: "web"`、inject 与 `./client` export。

Client 只能注册 additive slot，例如 `shell.overlay`；不得使用 `root` 或 `conversation.view`。若需求确实是替换整个产品根界面，应派生并替换 `dsh-editor-shell`，而不是同时安装第二个 root。

## 兼容、卸载、失败与数据保留

- 两个私有 Host 插件是桌面 profile 必需组件，不提供运行时安装/禁用 UI。缺包属于无效交付，由物化和包内容验证阻止。隔离负向 smoke 已确认：在 DSH `0.1.1-rc.2` 中移除任一包时，Host 在发布 loopback URL 前以退出码 `1` 失败，并在错误中指出缺失包；`pnpm test:e2e:missing-private` 固化该行为。
- workbench/kernel 运行失败沿用现有 RPC/tool fail-closed 路径；不增加备用执行面、重试守护或健康检查 RPC。
- 卸载插件不删除 workspace 文件、home credentials、settings、sessions 或 storages。
- `dsh-manuscript` 卸载前应保存正文并处理需保留草稿；插件不会主动清除 DSH storage domain。
- Kernel 卸载不删除知识卡之外的任何数据；proposal 从未直接写正文。
- 私有 profile 按整套精确版本原子替换。回滚也替换整套 profile，不混用不同版本的 contracts 与 Host。
- `root` seam 只兼容精确 DSH `0.1.1-rc.2`。

## 限额、取消与幂等性

- 稿件文本和单份 draft 上限 2,000,000 bytes；创建 create-if-absent，保存 replace-if-version。
- `patch.complete` 的 selectedText 最多 12,000 字符，before/after 各 4,000，候选最多 1,200。
- project context 固定来源单份 4,000、合计 12,000；动态世界书另有 6,000 总预算。
- `AbortSignal` 必须贯穿 RPC、文件和模型调用；超时不能被当作“必定未执行”。
- 导入、恢复、移动、归档必须先重新 read/probe，再继续、清理或重试。

## 集成清单与验收

新增或删除私有包时必须同步：

- `apps/desktop/resources/profile/package.json`
- `scripts/prepare-desktop-dev.mjs`
- `scripts/prepare-desktop-runtime.mjs`
- `scripts/verify-desktop-package.mjs`
- `scripts/dev.mjs`
- 包内 `cordis.patch.yml`、manifest、build、tests

最低验收：

| 变化 | 必须通过 |
| --- | --- |
| Host-only Tool/prompt | package unit、typecheck、build、真实 Tool/prompt smoke |
| 公开 dual-face 插件 | 上述检查 + `pack:plugins` + `test:e2e:matrix` |
| 私有 workbench/kernel | contract tests + `verify:desktop` + desktop package verification + portable E2E |
| root shell 或 DSH client contract | `verify:desktop` + desktop package + portable E2E |
| DSH 版本变化 | 全部检查，并重新审计 root、SessionFace、RPC、bundle/profile 和 portable runtime |

静态门禁还必须证明：无跨包 `src` 导入；依赖图无环；Shell client 无 Node 和私有包裸依赖；公开 manuscript tarball 不含私有包名、workbench channel、小说工具或知识卡。
