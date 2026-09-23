# @klarkxy/dsh-current-title

按最近人工消息更新会话标题。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-current-title/README.md)

从 [`dsh-plugins/dsh-current-title`](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title) 迁入。类型前缀中英对照。生成走 `@klarkxy/dsh-ai-services` 的弱模型用途 `current-title.generate`。

安装后默认启用，不会永久停用宿主自带的标题插件。启用期间占用 `sessionTitle` 槽位；关闭时若仍由本包持有，且被让出的加载项身份未变，则交还。

需要 Node.js ≥22 与 DSH `0.1.7-alpha.1`。标题写入宿主 `sessionTitle`。生成依赖 `@klarkxy/dsh-ai-services`。

许可证为 [SATA 2.1](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-current-title/LICENSE)，保留原插件出处。
