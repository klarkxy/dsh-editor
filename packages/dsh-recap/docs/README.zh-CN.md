# @klarkxy/dsh-recap

默认启用的回顾与检查点插件。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-recap/README.md)

需要 Node.js ≥22、DSH 0.1.7-rc.2，以及已加载的 @klarkxy/dsh-ai-services。Editor 已预装；独立 DSH 需要显式加载共享服务和此插件。

启用后，较长轮次结束或闲置返回会在后台生成回顾；聊天区不显示卡片、按钮、空状态或错误。回顾不再提供单独设置页或手动生成入口。回顾不作为模型上下文。

Agent 检查点和语义检查点随插件默认开启，维持连贯性由搭档自己负责；可在「设置 → 插件」关闭整个回顾功能。检查点通过宿主的下一步入口加入上下文，保留任务约定和来源。

同一 profile 也启用需求澄清插件时，回顾会读取它的任务约定，用于检查点上下文。

关闭插件会取消生成并停止注入，已存卡片保留。Editor 中的正常启停即时生效；安装、卸载或加载失败时按插件设置的提示操作。
