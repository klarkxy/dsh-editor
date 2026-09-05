# DSH Editor 架构与边界

本文描述桌面运行时、所有权边界和安全约束。插件分级、RPC/Tool/slot 接口以及修改、替换和新建插件流程见 [plugin-architecture.md](plugin-architecture.md)。开发和验收命令见 [development.md](development.md)。

当前兼容基线固定为 DSH `0.1.1-rc.2`。

## 交互架构图

在浏览器中打开下列独立 HTML（含明暗主题、路径追踪和导出）：

| 图 | 说明 | 打开 |
| --- | --- | --- |
| 桌面运行时 | Electron、唯一 DSH Host、桌面 profile 插件与作品目录 | [dsh-editor-runtime.html](diagrams/dsh-editor-runtime.html) |
| 插件拓扑 | 公开 Web 插件与桌面私有包的分级、依赖和 loopback RPC | [dsh-editor-plugins.html](diagrams/dsh-editor-plugins.html) |
| 确认写入 | 从 `context.compile` 到作者确认后 `proposal.apply` | [author-confirm-write.html](diagrams/author-confirm-write.html) |

规范源文件在 [diagrams/](diagrams/) 下的同名 `.json`。图中的产品名、channel、tool 与代码标识保持原样。

## 产品结构

DSH Editor V1 是 Windows x64 的 GUI-first 桌面应用，不是另一套 Agent runtime。

```text
Electron（受控多窗口、资源校验、子进程生命周期）
└─ 内置 Node 24.16.0
   └─ 内置 DSH 0.1.1-rc.2，127.0.0.1:随机端口
      └─ 专用 profiles/dsh-editor
         ├─ DSH base / web runtime / connection / renderer
         ├─ dsh-manuscript：公开稿件 Host RPC、稿纸 overlay 与共享 editor-core
         ├─ dsh-editor-workbench：私有项目生命周期、context、导入、快照与归档
         ├─ dsh-editor-novel-kernel：私有小说 Tool、guard、prompt 与知识卡
         └─ dsh-editor-shell：私有根界面
            ├─ 三栏：左文件树（4 组 + 组内新建）、中稿纸编辑器（ghost FIM + 选段改写 + ‹ › 章节导航）、右 DshChatPort
            └─ shell client 拆分为 src/client/{root,sidebar,editor,chat,dialogs,theme,components,shared}，并复用 dsh-manuscript/client/editor-core
```

普通 DSH `web` profile 仍可独立安装 `dsh-manuscript` 和 `dsh-grill`。桌面 profile 另外加载 workbench、novel-kernel 与 shell；shell 以较低 root priority 遮蔽官方 AppFrame，但不修改 DSH 包内部实现。DSH `0.1.1-rc.2` 的公开 root 声明明确告诫普通插件不要注册这里；本项目把它作为仅限固定版本、专用 profile 的兼容接缝，而不是稳定的上游扩展 API。升级 DSH 前必须取得受支持的 shell replacement seam 或重新完成全部桌面验收。

## 所有权边界

- **DSH**：Agent 循环、sessions/history、stream、tools、approvals、questions、models/providers、permissions、workspace registry（含显示名与最近入口）、sandbox、文件 API 与持久化。
- **Electron**：受控多窗口、共享后端、安全策略、内置资源版本/存在性检查、DSH 子进程启动和只针对该进程树的关闭清理。入口在 `apps/desktop/src/main.ts`，子进程监督在 `apps/desktop/src/supervisor.ts`。
- **`dsh-editor-shell` Renderer**：编辑 buffer、选区、可折叠/调宽三栏和专注视图状态；新建、重命名、放弃草稿和离开保护均使用应用内、锁定焦点的对话框，不依赖浏览器 `prompt/confirm`；普通稿件能力走公开 `/manuscript`，桌面项目生命周期走私有 `/dsh-editor-workbench`；栏宽只存本机界面偏好，不进入作品或 Host；不读取凭据、绝对路径或 Node 文件系统。`client.ts` 不再是单体：4 千多行单文件已拆为 `src/client/{root,sidebar,editor,chat,dialogs,theme,components,shared}`，并以 `Editor` 包装 `dsh-manuscript/client/editor-core`（`editor.tsx` + `editor-state.ts` + `completion-preference.ts` + `styles.ts`），稿纸逻辑与公开 manuscript overlay 共用。
- **`dsh-editor-shell` Host**：仅保留加载唯一 root client 所需的最小 Cordis 入口；Renderer 继续拥有界面、编辑 buffer 与作者确认流程。
- **`dsh-editor-workbench` Host**：loopback-only 项目结构、章节概览与状态、context、导入、快照、安全重命名、移动和可恢复归档；通过 `dsh-manuscript/host-api` 复用同一 live-session workspace authority。
- **`dsh-editor-novel-kernel` Host**：只读小说知识与检索、预览式 `novel_propose`、工具 guard 与 system prompt；固定路径索引直写及 loopback 知乎知识库管理 RPC 也由此包提供，正文仍只经作者确认后写入。
- **`dsh-manuscript` Host**：公开 `/manuscript` loopback RPC、live-session workspace authority、路径约束、版本化保存、全文搜索、DSH_HOME 草稿、FIM 与 `patch.complete`；公开产物不含 Node 文件系统能力。
- **`dsh-grill`**：保持为普通 DSH 可独立安装的公共插件，不进入桌面 profile 或桌面运行依赖。

没有 BFF、第二份 Chat 历史、provider registry、数据库、模式状态、工作流引擎、索引服务、云同步或后台守护进程。Chat Renderer 不执行工具或直接调用模型。打开已有作品时，产品只向当前 DSH 会话提交一次受限初始化任务：Agent 把工作区内容视为不可信数据，不改正文，唯一目标写入为 `.dsh-editor/作品索引.md`；实际工具权限、审批和沙箱仍由 DSH 权威控制。

外部作品导入只经过私有 `/dsh-editor-workbench`：两端必须是已解析、已注册且附着 live session 的工作区，Renderer 不传递 cwd 或绝对文件路径。Probe 只读取源、检查空目标并产生绑定两端 canonical root key 与文件版本/哈希的 token；Apply 会完整重 probe 后才以 `.dsh-editor-import.json` 的 `copying` 清单开始 no-clobber 写入 `正文/`。TXT 保持文本内容而改为 `.md`，隐藏路径、链接和非文本均跳过；完整项目不支持撤销。中断仅能在重新选择同一源后续传，或在每个清单拥有文件的哈希仍匹配时显式清理。Node 目录操作仅在 Host 已解析的根内逐组件拒绝 symlink/junction 后使用，文件内容和清单仍经版本化稿件文件原语读写。

整部作品文本快照保存在源工作区 `.dsh-editor/snapshots/<uuid>/`：先在同级 `.creating-<uuid>` 写入逐文件文本 payload 和校验 manifest，再同父目录 rename 发布。快照不包含未保存编辑 buffer。隐藏路径一律排除，`.dsh-editor/*` 不进入 payload。跨作品恢复只能经私有通道的 `snapshot.restore*` 到新的空目标；`.dsh-editor-restore.json` 绑定源根、目标根、快照、token 与清单，支持显式续传或在哈希未变时安全清理。原地回滚走 `snapshot.rollback`：先把当前状态自动存为一次安全快照，再按同一观察基线恢复文本文件，将快照之外的文本文件移入可恢复归档，非文本文件不参与。回滚前或期间发生并发修改会停止并返回安全快照标识及可能受影响的路径，不能把部分完成视为零写入。

文件整理仍由 live session 建立工作区 authority，并只在私有通道开放。`structure.groupCreate` 只允许在 `正文` 下建立一个可见的一级卷/部目录，拒绝隐藏名、设备名、嵌套路径、链接、已占用目标和只读工作区；目录本身就是结构来源，不新增 `structure.json`。`directory.create` 是通用的单层建目录：任意已存在父目录下创建一个可见目录，复用同一套名称、链接、占用与只读校验，供目录树在任何位置新建文件夹。卷内章节继续通过公开 `file.create` 的既有父目录检查与 `createIfAbsent` 写入。`file.moveManuscript` 只允许已保存的可见 Markdown/TXT 在 `正文` 目录树内部跨目录移动，保留文件名和类型，并复用与归档相同的 expectedVersion、内容哈希、逐组件 no-follow、目标 absent 与 no-replace 原子移动检查。`file.rename` 仅允许同目录、保留扩展名的 Markdown/TXT 改名；`archive.*` 把文档移动到 `.dsh-editor/archive/<timestamp>-<uuid>/`，用 root-bound、hash-protected manifest 记录 `moving/archived/restoring/restored`。Windows 文稿移动使用经过运行时验证的 `System.IO.File.Move(source,target)` no-replace 原语；非 Windows 普通文件先原子移动至同目录临时文件，再以 hard-link 排他创建目标并移除临时链接；不会删除外部编辑器在原路径新建的文件，失败时无覆盖恢复或保留临时文件并报告恢复路径。Windows 实现经固定 PowerShell 脚本、最小环境和 15 秒超时调用；目标存在、源版本变化、链接路径或完整性异常均 fail closed，不回退到 copy-delete 或普通覆盖式 rename。损坏归档会计数并展示，但不会被宣传为可恢复项。

私有 Host 按需扫描 `正文` 和 `大纲` 的可见 Markdown/TXT，在 2,000 文件、100 MB 总量与单文件 2 MB 上限内生成标题、摘要、去空白字数、空章和修改时间。重命名、移动、归档和恢复在正文操作成功后同步迁移附带元数据，迁移失败只返回 `metadataWarning`，不反向回滚作者已经成功完成的文件操作。

`search.text` 仅做有界、字面量、大小写不敏感的 Markdown/TXT 扫描，拒绝正则与控制字符，跳过隐藏、生成和链接路径，并限制文件数、总字节和结果数。Renderer 只接收路径、行列、片段、偏移和版本；定位前再次比较版本。章节导航由递归工作区列表中完整的 `正文/**/*.{md,txt}` 自然排序产生，不依赖用户是否展开文件树。

概览和卡片视图消费同一份 `project.overview` 响应，不复制章节或大纲数据。导出预检一次读取 Markdown/TXT 章节后同时形成自然顺序、空章警告、字数和最终 Blob；本版本未挂导出 UI，Host 仍按相同语义保留这条只读路径以便未来重新挂回。`search.text` 与人物卡/世界书的引用导航在 Renderer 没有入口，Host 不增加新的引用 RPC、关系索引或向量库。

## Desktop profile 与数据

开发模式使用 `.dev/desktop-home`。便携版遵循显式 `DSH_HOME`，未设置时使用独立的 `~/.dsh-editor`；应用只原子部署 `profiles/dsh-editor` 和带 owner marker 的 `runtime/dsh-editor-runtime`，遇到无应用标记的同名目录会拒绝覆盖。

profile 模板带 `.dsh-editor-owner.json`。若同名目录没有应用标记，启动会拒绝覆盖并在窗口显示诊断与重试。每次部署先写同级 stage，原子替换已标记 profile；home 级 credentials、settings、sessions、storages 和真实 workspace 不会被复制或删除。

桌面资源固定包含 Node `24.16.0`、DSH `0.1.1-rc.2`、manuscript、workbench、novel-kernel、shell 及 profile。准备脚本核对版本、依赖闭包和整棵资源 SHA-256；便携版首次启动从 NSIS TEMP 原子物化并复核持久运行时缓存，再从该缓存启动 DSH。应用不依赖系统 Node、pnpm 或全局 dsh。

`apps/desktop/resources/profile/package.json` 声明的 bundles 为：

```text
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
dsh-manuscript
dsh-editor-workbench
dsh-editor-novel-kernel
dsh-editor-shell
```

`dsh-grill` 不在此列。

## DshChatPort

`DshChatPort` 只消费 DSH 发布的 `SessionFace`、`ConversationSnapshot` 与 connection/runtime API，并保持一个事件消费者。它暴露：

- 会话打开/新建、历史分页；
- user/assistant/tool/notice/unknown 行与 partial stream；
- send、cancel、loadOlder；
- 模型与 permission preset 读取/切换；
- 工具审批 allow-once/reject；
- 批量用户问题回答；
- connection 状态与重连提示。

每次非空发送先按固定顺序读取最多五份 Markdown：`项目总览.md`、`大纲/总纲.md`、`人物卡/人物索引.md`、`世界书/设定总汇.md`、可选的 `.dsh-editor/作品索引.md`。每份最多纳入 4,000 字符，总计最多 12,000 字符。Host 随后在 live session 绑定的 canonical workspace authority 内，以 no-follow/provider-confined 文件 API 扫描可见的 `世界书/**/*.md`（排除固定 `设定总汇.md`）：最多 64 个候选、64 个目录、8 层、单文件 64 KiB、总扫描 512 KiB。严格 frontmatter 提供 `triggers`、`enabled`、`priority`；无 frontmatter 的旧文件以相对文件名触发。匹配仅使用原始请求、当前已保存文档的相对路径和最多 8,000 字符已保存内容，不读取 Renderer 未保存草稿。动态项按优先级和稳定路径排序，单份最多 3,000 字符、合计最多 6,000 字符，绝不挤占固定五份的 12,000 字符预算。

Renderer 另维护最多 1,200 字符的本机跨作品作者约定，并在 V2 JSON 信封的可选 `author_preferences` 字段中与 `user_request`、`project_context` 分离。Host 会重新规范化并限制长度；canonical parser 同样验证边界，V1 历史不接受伪造的新增字段。对话回执只暴露字符数，不回显原文。FIM 与选段修改经各自 RPC 的同名有界字段带入 system guidance，仍由 Host 选择 live-session provider/model；该字段不属于作品 canon、不扩大文件权限，也不改变 stale/abort 规则。

Renderer 同时维护最多 2,000 字符的本机作者侧写 `author_memory`，与作者约定同源信任边界但语义独立：助手只能通过 `author_observe` 工具（marker `dsh-editor.memory`，单条 observation ≤ 200 字、含 reason）在对话里提议"记住一条偏好"，未经作者在 `MemoryCard` 显式确认前绝不能当作已记忆。`author_memory` 同样以 V2 JSON 信封的可选字段随 `context.compile` 自动注入；Host 重新规范化、限制 2,000 字、拒绝伪造字段、验证后与原文一致；V1 历史不接收该字段。对话回执只暴露字符数，不回显原文。FIM 与选段修改的 RPC 不带 `authorMemory`——作品内一次性偏好由用户输入或命令直接执行，留在请求上下文里而不进持久侧写；侧写本身不进入作品 canon、不扩大文件权限，也不改变 stale/abort 规则。

固定与动态读取结果、扫描计数和原始请求以 V2 JSON 信封一次提交给同一 DSH session；解析器仍严格接受历史 V1。文件文本是不可信数据，单文件缺失、格式无效、超限或读取失败只进入有界回执；整个 Host 编译失败则不调用 `session.prompt`。Renderer 仅显示原请求和不含原文的回执，DSH 历史保留完整信封。`novel_knowledge` 不属于该回执，深层或最新事实仍由 Agent 通过 `glob`、`grep`、`read` 验证。

普通世界书的触发词、`enabled` 与 `priority` 只写在 Markdown 文件开头的 frontmatter 中；本版本没有专门的可视化触发设置面板，编辑方式改为手工修改文件头。Host 仍按相同 frontmatter 解析，损坏 / 停用 / 超出扫描限制的文件不会进入提示，文件正文不会被界面覆盖，缺 frontmatter 的旧文件继续以文件名作为触发词。

未知节点或工具显示通用降级卡。Renderer 不持久化对话副本；刷新后仍以 DSH snapshot 为准。`novel_knowledge` 的运行中调用对用户隐藏；`novel_propose` 的结果只在通过 `dsh-editor-novel-kernel/contracts` 严格解析后渲染为作者确认卡。

## Host RPC

公开 `/manuscript` 与私有 `/dsh-editor-workbench` 都携带 `sessionId` 和工作区相对路径。Host 忽略浏览器提供的 cwd/provider/model，并复用同一条 authority 链：

1. 取得 live session；
2. 读取 immutable `session.header.cwd`；
3. 解析 registered workspace 与 membership；
4. 取得 session sandbox policy；
5. 拒绝 absolute/device/traversal/symlink；
6. 通过 DSH `ctx.fs` list/read/create/replaceIfVersion；
7. 保存冲突时保留 Renderer buffer。

文本上限 2 MB。创建使用 `createIfAbsent`，保存使用 `replaceIfVersion`。binary、非普通文件、父目录不存在、stale version、read-only、未知 session 和 workspace mismatch 都 fail closed。

`patch.complete` 输入 session、文件、选区和有界前后文；Host 从 live session request header 选择 provider/model，再使用 DSH `llm.stream`。返回只是一条短建议。Renderer 以文档 revision、选区起止与选区文本组成 ticket；请求过期、abort 或选区改变时丢弃响应。“用这句”只改 buffer，仍需显式保存。

补全偏好只保存在 Renderer 的本机界面存储中，默认 `manual`。`pause` 模式以每次真实键入 revision 为一次性触发票据，只对 `正文` Markdown/TXT 生效；稿纸失焦、非折叠选区、短前文、冲突、已有建议或正在执行其他建议时不发请求。停顿 1.5 秒后仍满足条件才复用同一 `fim.complete`，失败不会在无新键入时自行重试，响应仍走既有 revision/path/abort 校验并需要作者确认。

FIM 同样由 Host 选模型。候选只改 buffer，支持 loading、Tab 接受、Esc 放弃和最多三条候选切换；追加候选复用同一文档 revision 与插入点，新请求失败或返回重复内容时保留已有候选。空白章不会自动生成正文。

完整 endpoint 目录见 [plugin-architecture.md](plugin-architecture.md)。

## Electron 安全与进程边界

BrowserWindow 使用 `nodeIntegration: false`、`contextIsolation: true`、renderer sandbox、`webSecurity: true`，拒绝所有权限、新窗口和非本次 loopback origin 导航。CSP 限定 self、data/blob 图片、同源及 loopback WebSocket；DSH `0.1.1-rc.2` 的客户端模块加载器需要 `unsafe-eval`，这是已验证的固定版本例外，窗口仍不加载外部 origin。

Supervisor 只接受 `dsh web: http://127.0.0.1:<port>` 形式的就绪行。正常关闭先发优雅终止，超时后仅对记录的子进程 PID 使用 Windows process-tree fallback。启动超时、版本错误和意外退出都进入应用内诊断页；关闭验收必须证明端口已释放。

## 公开 Web 插件边界

`dsh-manuscript` 在普通 `web` profile 中继续使用 `shell.overlay` 抽屉，不占官方 root；其公开 tarball 只含 provider-confined 稿件能力，不含 Node 文件系统或桌面生命周期端点。`dsh-grill` 继续只注册工具和提示。两者仍可单独安装、共存和任意顺序卸载；桌面 shell 与 `/dsh-editor-workbench` 不进入公开 tarball。

## 非目标与后置

- 安装器、自动更新、代码签名、发布；
- 句内卡片、`/`/`@` 面板、审阅 gutter、附件和完整官方高级管理界面；
- watch、独立索引服务、Git UI；通用文件树现已支持可见目录整理和显式确认后的永久删除，删除与可恢复归档属于不同操作。
- 章节状态（草稿/修订中/已定稿曾落地后移除）、卡片拖放、手写卡片摘要、章节—大纲绑定、关系图、向量检索、DOCX/EPUB；
- Android、远程多用户、云同步；
- 未经授权的 commit、push、tag 或 release。

## 验证闸门

- 全 workspace typecheck、unit 与 build；
- Chat adapter、patch stale/abort/bounds、profile collision/atomic deploy、supervisor timeout/exit/cleanup；
- 公开插件打包及 fresh-home 安装/卸载矩阵；
- Playwright Electron 当前源码窗口：DSH Editor 标题、私有 `.shell`、默认三栏写作身份、1280×720 外窗和关闭端口释放；
- portable EXE：固定资源版本/哈希、启动、核心旅程、关闭与无遗留进程。

历史报告不能替代当前源码证据。兼容版本只声明 `0.1.1-rc.2`；升级必须重新验证公开会话契约、root priority、CSP、profile patch、RPC 和真实 EXE。

## 多窗口写入与草稿恢复

同一 Host 的稿件保存、提案应用和作品文件变更按 canonical workspace root 串行执行；不同作品可独立执行。队列只包围顶层 RPC，内部文件原语不重复入队，磁盘版本与哈希检查仍负责识别外部编辑器的修改。

持久草稿以作品、文件和窗口 ownerId 区分，窗口标识保存在 sessionStorage。草稿 get/put 返回 revision，清理必须携带匹配的 revision；保存或放弃不能删除另一个窗口的记录。旧版草稿保持为可枚举的 legacy 备份。重启生成新窗口标识后，作者可显式选择旧备份恢复到当前编辑 buffer，原备份继续保留。

拆章先验证目标父目录并保存后半稿，再按版本更新原稿。合章先写入目标再归档来源。后一阶段失败时返回 partial、appliedPaths 和 history 恢复路径，界面明确显示部分完成，不自动重试或声称未写入。文本提案按字面写入，不解释 JavaScript 替换元字符。

发布矩阵须先通过类型、单元测试、构建和桌面/核心写作流程，再打包并上传 CI 中间产物。单一 publish job 等待两个平台完成后创建 Release 和上传产物，避免两个平台竞争创建同一个 Release。
