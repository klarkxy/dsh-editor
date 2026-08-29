# DSH Editor 架构与边界

## 产品结构

DSH Editor V1 是 Windows x64 的 GUI-first 桌面应用，不是另一套 Agent runtime。

```text
Electron（窗口、资源校验、子进程生命周期）
└─ 内置 Node 24.16.0
   └─ 内置 DSH 0.1.1-rc.2，127.0.0.1:随机端口
      └─ 专用 profiles/dsh-editor
         ├─ DSH base / web runtime / connection / renderer
         ├─ dsh-manuscript Host RPC
         └─ dsh-editor-shell 私有根界面
            ├─ 左：工作区、会话与稿件树
            ├─ 中：Markdown 稿纸、草稿、冲突、FIM、选段改写
            ├─ 内部：只读小说经验知识卡与静态主题白名单
            └─ 右：DshChatPort → 唯一 DSH SessionFace 快照
```

普通 DSH `web` profile 仍可独立安装 `dsh-manuscript` 和 `dsh-grill`。桌面 profile 才加载私有 `dsh-editor-shell`；它以较低 root priority 遮蔽官方 AppFrame，但不修改 DSH 包内部实现。DSH `0.1.1-rc.2` 的公开 root 声明明确告诫普通插件不要注册这里；本项目把它作为仅限固定版本、专用 profile 的兼容接缝，而不是稳定的上游扩展 API。升级 DSH 前必须取得受支持的 shell replacement seam 或重新完成全部桌面验收。

## 所有权边界

- DSH：Agent 循环、sessions/history、stream、tools、approvals、questions、models/providers、permissions、workspace registry（含显示名与最近入口）、sandbox、文件 API 与持久化。
- Electron：单窗口、安全策略、内置资源版本/存在性检查、DSH 子进程启动和只针对该进程树的关闭清理。
- `dsh-editor-shell` Renderer：编辑 buffer、选区、可折叠/调宽三栏和专注视图状态；新建、重命名、放弃草稿和离开保护均使用应用内、锁定焦点的对话框，不依赖浏览器 `prompt/confirm`；普通稿件能力走公开 `/manuscript`，桌面项目生命周期走私有 `/dsh-editor-workbench`；栏宽只存本机界面偏好，不进入作品或 Host；不读取凭据、绝对路径或 Node 文件系统。
- `dsh-editor-shell` Host：loopback-only 项目导入、快照、安全重命名、可恢复归档，以及只读 `novel_knowledge` 与预览式修改提案；复用同一 live-session workspace authority，不保存模式状态，也不装载完整 skill。
- `dsh-manuscript` Host：公开 `/manuscript` loopback RPC、live-session workspace authority、路径约束、版本化保存、全文搜索、DSH_HOME 草稿、FIM 与 `patch.complete`；公开产物不含 Node 文件系统能力。
- `dsh-grill`：保持为普通 DSH 可独立安装的公共插件，不进入桌面 profile 或桌面运行依赖。

没有 BFF、第二份 Chat 历史、provider registry、数据库、模式状态、工作流引擎、索引服务、云同步或后台守护进程。Chat Renderer 不执行工具或直接调用模型。打开已有作品时，产品只向当前 DSH 会话提交一次受限初始化任务：Agent 把工作区内容视为不可信数据，不改正文，唯一目标写入为 `.dsh-editor/作品索引.md`；实际工具权限、审批和沙箱仍由 DSH 权威控制。

外部作品导入只经过私有 `/dsh-editor-workbench`：两端必须是已解析、已注册且附着 live session 的工作区，Renderer 不传递 cwd 或绝对文件路径。Probe 只读取源、检查空目标并产生绑定两端 canonical root key 与文件版本/哈希的 token；Apply 会完整重 probe 后才以 `.dsh-editor-import.json` 的 `copying` 清单开始 no-clobber 写入 `正文/`。TXT 保持文本内容而改为 `.md`，隐藏路径、链接和非文本均跳过；完整项目不支持撤销。中断仅能在重新选择同一源后续传，或在每个清单拥有文件的哈希仍匹配时显式清理。Node 目录操作仅在 Host 已解析的根内逐组件拒绝 symlink/junction 后使用，文件内容和清单仍经版本化稿件文件原语读写。

整部作品文本快照保存在源工作区 `.dsh-editor/snapshots/<uuid>/`：先在同级 `.creating-<uuid>` 写入逐文件文本 payload 和校验 manifest，再同父目录 rename 发布。快照不包含未保存编辑 buffer。恢复只能经私有通道的 `snapshot.restore*` 到新的空目标；`.dsh-editor-restore.json` 绑定源根、目标根、快照、token 与清单，支持显式续传或在哈希未变时安全清理，绝不原地覆盖源作品。

文件整理仍由 live session 建立工作区 authority，并只在私有通道开放。`structure.groupCreate` 只允许在 `正文` 下建立一个可见的一级卷/部目录，拒绝隐藏名、设备名、嵌套路径、链接、已占用目标和只读工作区；目录本身就是结构来源，不新增 `structure.json`。卷内章节继续通过公开 `file.create` 的既有父目录检查与 `createIfAbsent` 写入。`file.moveManuscript` 只允许已保存的可见 Markdown/TXT 在 `正文` 目录树内部跨目录移动，保留文件名和类型，并复用与归档相同的 expectedVersion、内容哈希、逐组件 no-follow、目标 absent 与 no-replace 原子移动检查。`file.rename` 仅允许同目录、保留扩展名的 Markdown/TXT 改名；`archive.*` 把文档移动到 `.dsh-editor/archive/<timestamp>-<uuid>/`，用 root-bound、hash-protected manifest 记录 `moving/archived/restoring/restored`。Windows 实际移动使用经过运行时验证的 `System.IO.File.Move(source,target)` no-replace 原语，经固定 PowerShell 脚本、最小环境和 15 秒超时调用；目标存在、源版本变化、链接路径或完整性异常均 fail closed，不回退到 copy-delete 或普通覆盖式 rename。损坏归档会计数并展示，但不会被宣传为可恢复项。

`search.text` 仅做有界、字面量、大小写不敏感的 Markdown/TXT 扫描，拒绝正则与控制字符，跳过隐藏、生成和链接路径，并限制文件数、总字节和结果数。Renderer 只接收路径、行列、片段、偏移和版本；定位前再次比较版本。章节导航由递归工作区列表中完整的 `正文/**/*.{md,txt}` 自然排序产生，不依赖用户是否展开文件树。

## Desktop profile 与数据

开发模式使用 `.dev/desktop-home`。便携版遵循 `DSH_HOME`，未设置时使用 DSH 默认 home；应用只原子部署 `profiles/dsh-editor` 和带 owner marker 的 `runtime/dsh-editor-runtime`，遇到无应用标记的同名目录会拒绝覆盖。

profile 模板带 `.dsh-editor-owner.json`。若同名目录没有应用标记，启动会拒绝覆盖并在窗口显示诊断与重试。每次部署先写同级 stage，原子替换已标记 profile；home 级 credentials、settings、sessions、storages 和真实 workspace 不会被复制或删除。

桌面资源固定包含 Node `24.16.0`、DSH `0.1.1-rc.2`、`dsh-editor-shell`、`dsh-manuscript` 及 profile。准备脚本核对版本、依赖闭包和整棵资源 SHA-256；便携版首次启动从 NSIS TEMP 原子物化并复核持久运行时缓存，再从该缓存启动 DSH。应用不依赖系统 Node、pnpm 或全局 dsh。

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

固定与动态读取结果、扫描计数和原始请求以 V2 JSON 信封一次提交给同一 DSH session；解析器仍严格接受历史 V1。文件文本是不可信数据，单文件缺失、格式无效、超限或读取失败只进入有界回执；整个 Host 编译失败则不调用 `session.prompt`。Renderer 仅显示原请求和不含原文的回执，DSH 历史保留完整信封。`novel_knowledge` 不属于该回执，深层或最新事实仍由 Agent 通过 `glob`、`grep`、`read` 验证。

普通世界书编辑器在同一正文 buffer 上提供 `triggers/enabled/priority` 可视化设置；应用时只规范化有界 frontmatter，文件正文逐字保留，随后复用现有草稿、自动保存、expectedVersion 与冲突处理。没有 frontmatter 的旧文件可升级为规范头；显式但损坏的 frontmatter 禁止表单写入，必须先由作者手工修复。该表单不建立第二份世界书状态或存储。

未知节点或工具显示通用降级卡。Renderer 不持久化对话副本；刷新后仍以 DSH snapshot 为准。

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

## Electron 安全与进程边界

BrowserWindow 使用 `nodeIntegration: false`、`contextIsolation: true`、renderer sandbox、`webSecurity: true`，拒绝所有权限、新窗口和非本次 loopback origin 导航。CSP 限定 self、data/blob 图片、同源及 loopback WebSocket；DSH `0.1.1-rc.2` 的客户端模块加载器需要 `unsafe-eval`，这是已验证的固定版本例外，窗口仍不加载外部 origin。

Supervisor 只接受 `dsh web: http://127.0.0.1:<port>` 形式的就绪行。正常关闭先发优雅终止，超时后仅对记录的子进程 PID 使用 Windows process-tree fallback。启动超时、版本错误和意外退出都进入应用内诊断页；关闭验收必须证明端口已释放。

## 公开 Web 插件边界

`dsh-manuscript` 在普通 `web` profile 中继续使用 `shell.overlay` 抽屉，不占官方 root；其公开 tarball 只含 provider-confined 稿件能力，不含 Node 文件系统或桌面生命周期端点。`dsh-grill` 继续只注册工具和提示。两者仍可单独安装、共存和任意顺序卸载；桌面 shell 与 `/dsh-editor-workbench` 不进入公开 tarball。

## 非目标与后置

- 安装器、自动更新、代码签名、发布；
- 句内卡片、`/`/`@` 面板、审阅 gutter、附件和完整官方高级管理界面；
- 永久删除、`正文` 之外的跨目录移动、卷/部之外的任意建目录、watch、独立索引服务、Git UI；
- Android、远程多用户、云同步；
- 未经授权的 commit、push、tag 或 release。

## 验证闸门

- 全 workspace typecheck、unit 与 build；
- Chat adapter、patch stale/abort/bounds、profile collision/atomic deploy、supervisor timeout/exit/cleanup；
- 公开插件打包及 fresh-home 安装/卸载矩阵；
- Playwright Electron 当前源码窗口：DSH Editor 标题、私有 `.shell`、双栏写作身份、1280×720 外窗和关闭端口释放；
- portable EXE：固定资源版本/哈希、启动、核心旅程、关闭与无遗留进程。

历史报告不能替代当前源码证据。兼容版本只声明 `0.1.1-rc.2`；升级必须重新验证公开会话契约、root priority、CSP、profile patch、RPC 和真实 EXE。
