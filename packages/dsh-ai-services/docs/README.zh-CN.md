# @klarkxy/dsh-ai-services

插件共用的 Cordis 服务：模型角色路由、有界辅助调用、取消与用量回执。这是支撑服务，不是面向用户的功能。装上后不会自行发起推理。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/README.md)

需要 Node.js ≥22、DSH `0.1.5-rc.2`。宿主需提供 `llm`、`storageDomain`、`connection`、`webServer`。功能插件通过 `ctx.aiServices.activate(plugin)` 显式调用；稿纸补全与改写也使用本服务，保留原来的设置入口，配置统一写入用途策略。
