# dsh-editor-shell

桌面写作 shell 通过既有 `/manuscript` RPC 创建和列出作品文本快照，并以“恢复为新副本”把选定快照恢复到用户选择的空目录。界面不会直接访问 Node 文件系统；未保存的编辑 buffer 不属于快照内容，原作品不会被恢复操作改写。

Private client shell for the dedicated `dsh-editor` profile. It owns the root
surface only in that profile and consumes DSH `0.1.1-rc.2` public runtime and
connection contracts. It is not a public installable plugin.
