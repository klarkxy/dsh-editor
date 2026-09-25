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

归档视图（src/client/archive.tsx）当前不在界面开放：文档归档入口已收起（`DOCUMENT_ARCHIVE_UI = false`），Host 的 `archive.*` 与合章内部归档仍保留。

## Manifest 条目

| id | 设置项标题 | 映射 |
| --- | --- | --- |
| `editor-shell` | 写作界面 | 本包根插件（三栏稿纸与设置，锁定） |
| `dsh-editor-writing` | 写作偏好 | `dsh-editor-shell/writing-config`（原生写作配置，锁定） |
| `ui-developer` | 开发者偏好 | `dsh-editor-shell/developer-config`（developerMode 开关，锁定） |

映射关系见 package.json 的 `dshEditor.entries` 与 cordis.patch.yml。注意区分两个相近命名：「写作偏好」是本包的原生写作设置项（补全方式、写作/改写/对话模型路由、字号行宽等，src/writing-config.ts）；「通用写作」是桌面 profile 的 agent preset（apps/desktop/resources/profile/agent-presets/dsh-editor-writing/preset.yml），由 [dsh-editor-plugins](../dsh-editor-plugins/README.md) 的「写作模式」开关管理。

## 公开导出

- `./client`：浏览器侧 shell 客户端（src/client.ts）。
- `./seats`：原样转发 [dsh-editor-seats](../dsh-editor-seats/README.md) 的座位合同（src/seats.ts）。
- `./writing-config`、`./developer-config`：上表两个设置项插件。

## 兼容约束

当前通过 root 遮蔽替换官方 AppFrame，仅用于固定 DSH 版本的专用 profile。升级前须取得受支持的 shell replacement 接口，否则重新完成全部桌面验收；不要复制上游私有 UI 来维持兼容。

插件接入使用 [dsh-editor-seats](../dsh-editor-seats/README.md)，编辑器复用 [dsh-manuscript](../dsh-manuscript/README.md)。
