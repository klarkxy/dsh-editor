# dsh-editor-shell

桌面写作 shell 调用 `dsh-editor-workbench` 拥有的 loopback-only `/dsh-editor-workbench` RPC 管理作品生命周期，普通稿件读写、搜索与 AI 建议仍走公开 `/manuscript`；界面不会直接访问 Node 文件系统。

## 三栏与面板

工作区是可折叠、可键盘调整宽度的文件 / 稿纸 / 搭档三栏；专注模式临时只保留稿纸。左侧文件树只渲染磁盘上真实存在的条目（隐藏 `.` 开头项）；新建作品只预建 `正文/`。栏顶入口：

- 搜索（Ctrl+Shift+F）：整部作品或仅正文的字面量全文搜索（`search.text`）
- 校对（Ctrl+Shift+L）：标点 / 错别字 / 敏感词 / 重复 / 口癖（`proofread.scan`）；自动应用只接受 Markdown，`.txt` 需手工改
- 概览（Ctrl+Shift+O）：章节状态、字数分布、近 30 日 / 12 周写作曲线
- 人物（Ctrl+Shift+C）/ 设定（Ctrl+Shift+W）：人物卡与世界书面板（`cards.*`，页签也可互切）；选中一张后稿纸区旁打开字段表单与引用列表
- 提交 / 历史：简易快照，不是独立的快捷键表或快照库对话框

作品菜单与命令面板提供导入、导出预检（Markdown / TXT / DOCX / EPUB）和「已归档」。没有单独的快捷键对照表对话框；命令面板（Ctrl+K）列出可用命令。

稿纸内查找 / 替换是 Ctrl+F / Ctrl+H（`@codemirror/search`）。打字机滚动 Ctrl+Alt+T，段落聚焦 Ctrl+Alt+P；字号、行高、字体、段距、纸宽写在 `dsh-editor-writing`。打开世界书 Markdown 时，稿纸下方提供触发词 / 启用 / 优先级表单。保存成功后 5 秒防抖调用 `progress.record`。侧栏可显示每日目标字数小标。

## 归档与对话

文件树右键「归档」只对单个可见 Markdown/TXT 生效，记录进 `.dsh-editor/archive/`，可从「已归档」恢复；目录不能归档。右键删除是永久删除，与归档不同。

对话标题栏 ⋯ 菜单提供归档、恢复、删除。删除只在本机写入墓碑 id，从切换列表和已归档列表隐藏；DSH `0.1.5-rc.2` 没有会话删除 API，会话本体仍留在 Host。

## 其它

栏宽与文件栏开合只作为本机 Renderer 界面偏好保存。编辑器把 FIM 与选段 patch 显式呈现为可放弃建议。作品显示名和最近列表复用 DSH workspace registry。

Private client shell for the dedicated `dsh-editor` profile. It owns the root
surface only in that profile and consumes DSH `0.1.5-rc.2` public runtime and
connection contracts. The Host entry registers the `dsh-editor-writing`
settings schema. Project lifecycle and novel tools belong to the two private
Host plugins. It is not a public installable plugin.
