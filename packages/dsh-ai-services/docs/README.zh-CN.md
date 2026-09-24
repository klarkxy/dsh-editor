# @klarkxy/dsh-ai-services

插件共用的 Cordis 服务：模型角色路由、有界辅助调用、取消与用量回执。这是支撑服务，不是面向用户的功能。装上后不会自行发起推理。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/README.md)

需要 Node.js ≥22、DSH `0.1.7-alpha.1`。宿主需提供 `llm`、`storageDomain`、`connection`、`webServer`。功能插件通过 `ctx.aiServices.activate(plugin)` 显式调用。

快速／对话／思考／幻想分别对应 Haiku／Sonnet／Opus／Fable 的档位定位，可绑定任意供应商模型。内置插件不默认使用幻想档，只有用户显式选择时才使用。档位未配置时使用对话档，再回退到宿主默认对话模型；宿主默认模型按次读取，独立插件无需 Editor 初始化即可调用。手动指定的模型或会话选择保持有效；显式无效配置仍报错。
