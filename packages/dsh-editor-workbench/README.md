# dsh-editor-workbench

桌面作品管理 Host，核心包，不可关闭。负责作品操作、提案确认、快照与回滚，并为辅助面板提供数据。

操作见[使用指南](../../docs/user-guide.md#管理作品)。接口见 [src/contracts.ts](src/contracts.ts)，写入权限复用 [dsh-manuscript](../dsh-manuscript/README.md)；新增写作工具也须遵守[作者确认边界](../../docs/product-principles.md#作者决定内容)。
