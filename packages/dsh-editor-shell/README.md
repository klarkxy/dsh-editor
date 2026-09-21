# dsh-editor-shell

桌面写作界面，核心包，不可关闭。提供作品列表、稿纸、文件树、搭档栏和设置；操作见[使用指南](../../docs/user-guide.md)。

## 兼容约束

当前通过 root 遮蔽替换官方 AppFrame，仅用于固定 DSH 版本的专用 profile。升级前须取得受支持的 shell replacement 接口，否则重新完成全部桌面验收；不要复制上游私有 UI 来维持兼容。

插件接入使用 [dsh-editor-seats](../dsh-editor-seats/README.md)，编辑器复用 [dsh-manuscript](../dsh-manuscript/README.md)。核心「通用写作」模式 `dsh-editor-writing` 始终保留作默认选择。
