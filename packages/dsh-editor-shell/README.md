# dsh-editor-shell

桌面写作界面，核心包，不可关闭。提供作品列表、稿纸、文件树、搭档栏和设置；操作见[使用指南](../../docs/user-guide.md)。

## 功能

- 三栏工作台：文件树、中央稿纸（复用 dsh-manuscript）与右侧搭档栏；关注模式、打字机滚动、聚焦段落可在命令面板或视图菜单切换。
- 命令面板：Cmd/Ctrl+K 唤起（src/client/command-palette.tsx），分组提供作品操作、写作命令、视图切换和文件快速跳转；插件命令经 `dshEditorCommands` 注册表追加进对应分组，注册表由 src/client.ts 创建并提供。
- 全文搜索与跨文件替换：Ctrl+Shift+F 打开侧栏搜索面板；替换前逐文件确认处数，跳过版本已变化或匹配已变的文件（src/search-replace.ts）。
- 导出：导出对话框支持 Markdown / TXT / DOCX / EPUB 四种格式（src/export.ts、export-book.ts、export-docx.ts、export-epub.ts）。
- 历史版本对话框：列出快照与变更清单，确认后回滚（src/client/history-dialog.tsx）。
- 导入对话框：从另一部作品导入正文，先探测再确认，支持中断后的恢复与清理（src/client/import-dialog.tsx、import-flow.ts）。
- 固定分栏：把一份文档钉在稿纸旁只读对照，随树与内容版本刷新（src/client/pinned-pane.tsx）。
- 改写预设栏：选区上方提供内置改写预设与自定义指令入口（src/client/rewrite-presets-bar.tsx）。
- 设置页：通用设置、模型、助手、写作、用量、插件、知乎资料、关于 8 个分类（插件与知乎资料不可用时隐藏，分类名以 src/i18n/messages.zh.ts 为准）。
- 模型设置的后台刷新保留正在编辑的名称、模型声明与 API key 输入；原设置 revision 已变化时显示冲突并阻止旧草稿写入。对话模型与思考档位以 Host 目录为准，打开选择器不补写模型能力或猜测默认强度。
- 对话名称、归档、置顶与会话顺序以 Host 为准；改名失败可重试。自动名称写入前再次检查最新名称与官方标题管理状态，不覆盖作者已确认的名称。
- 作者侧写由 Host 的 `author_observe` 工具直接更新现有写作设置；聊天历史中的旧结果保持隐藏，读取历史不再追加侧写。既有作者记忆保留。
- 破限模式：通用设置页的独立卡片与开关（src/limit-break-config.ts、src/client/settings-general.tsx）。开启后宿主把 `resources/limit-break/agents-spec.md` 作为最后一段系统提示词追加到每次组装，关闭时不贡献文本。卡片常驻封号风险声明，从关到开须过一次确认框。

文档归档界面已移除（原 src/client/archive.tsx 的入口长期隐藏后删除）；Host 的 `archive.*` RPC 与合章内部归档仍保留，供作品合并时归档来源文件。

## Manifest 条目

| id | 设置项标题 | 映射 |
| --- | --- | --- |
| `editor-shell` | 写作界面 | 本包根插件（三栏稿纸与设置，锁定） |
| `dsh-editor-writing` | 写作偏好 | `dsh-editor-shell/writing-config`（原生写作配置，锁定） |
| `ui-developer` | 开发者偏好 | `dsh-editor-shell/developer-config`（developerMode 开关，锁定） |
| `ui-limit-break` | 破限模式 | `dsh-editor-shell/limit-break-config`（limitBreakMode 开关，锁定） |

映射关系见 package.json 的 `dshEditor.entries` 与 cordis.patch.yml。注意区分两个相近命名：「写作偏好」是本包的原生写作设置项（补全方式、写作/改写/对话模型路由、字号行宽等，src/writing-config.ts）；「通用写作」是桌面 profile 的 agent preset（apps/desktop/resources/profile/agent-presets/dsh-editor-writing/preset.yml），由 [dsh-editor-plugins](../dsh-editor-plugins/README.md) 的「写作模式」开关管理。

## 公开导出

- `./client`：浏览器侧 shell 客户端（src/client.ts）。
- `./seats`：原样转发 [dsh-editor-seats](../dsh-editor-seats/README.md) 的座位合同（src/seats.ts）。
- `./writing-config`、`./developer-config`、`./limit-break-config`：上表的设置项插件。

## 兼容约束

当前通过 root 遮蔽替换官方 AppFrame，仅用于固定 DSH 版本的专用 profile。升级前须取得受支持的 shell replacement 接口，否则重新完成全部桌面验收；不要复制上游私有 UI 来维持兼容。

插件接入使用 [dsh-editor-seats](../dsh-editor-seats/README.md)，编辑器复用 [dsh-manuscript](../dsh-manuscript/README.md)。

导入流程读取固定版本 `workspace/create` 的 `created` 答复，仅在取消或失败时清理本次新建的最近登记；幂等复用已有作品时保留原登记。登记清理不删除作品文件。稿纸切章和离场保存复用 `dsh-manuscript/client/editor-core` 的 `saveOpenEditor`，组字、冲突、失败和保存期间的新输入都会阻止离场。

模型设置与选择器的真实组件回归夹具可用 `node packages/dsh-editor-shell/fixtures/shell-repairs.mjs` 执行，截图与失败诊断写入 `.artifacts/shell-repairs/`；`--before` 使用本轮起点 `185b927` 的组件验证原问题。该夹具使用模拟 Host 数据，不证明安装后的桌面运行或实际模型请求。
