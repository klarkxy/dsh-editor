# dsh-editor-shell

桌面写作 shell 通过 loopback-only `/dsh-editor-workbench` Host RPC 创建和列出作品文本快照，并以“恢复为新副本”把选定快照恢复到用户选择的空目录。普通稿件读写、搜索与 AI 建议仍走公开 `/manuscript`；界面不会直接访问 Node 文件系统。未保存的编辑 buffer 不属于快照内容，原作品不会被恢复操作改写。

作者工作台还提供整部作品/仅正文全文搜索、完整章节前后导航、同目录安全重命名和可恢复归档。所有跳转与文件整理都服从未保存内容/冲突门禁；归档记录损坏、目标冲突或文件版本变化会在界面中停止并说明，不提供永久删除。

工作区采用可折叠、可键盘调整宽度的文件/稿纸/搭档三栏布局；专注模式临时只保留稿纸。栏宽与文件栏开合仅作为本机 Renderer 界面偏好保存，不进入作品文件或 Host 状态。

编辑器把 `/manuscript` 的 FIM 与选段 patch 显式呈现为可放弃的稿纸建议；只有作者接受后才进入本地草稿，生成期间正文或文档发生变化时旧结果不会应用。

Private client shell for the dedicated `dsh-editor` profile. It owns the root
surface only in that profile and consumes DSH `0.1.1-rc.2` public runtime and
connection contracts. It is not a public installable plugin.
