# @klarkxy/dsh-model-center

默认启用的模型中心，接管宿主的模型设置页：先显示模型配置，再显示供应商管理。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-model-center/README.md)

## 安装

需要 Node.js ≥22、DSH 0.1.7-rc.2，以及已加载的 @klarkxy/dsh-ai-services。供应商和凭据仍由 DSH 原生设置管理。

```sh
npm install @klarkxy/dsh-model-center
```

AI 策略由 `@klarkxy/dsh-ai-services` 存储。模型中心未安装或停用时，档位调用直接使用对话档或宿主默认模型，已保存的档位绑定保持不变。

## 使用

「模型档位」提供快速、对话、思考、幻想四档：快速档用于低成本、低延迟的辅助调用，对话档是日常默认，思考档用于更重的推理，幻想档是成本最高的创作档位。四档可绑定任意供应商模型，每档分别设置模型与思考强度。未单独设置的档位跟随对话档。「能力默认值」中的新对话、补全、改写、标题、澄清、回顾等可引用任一档，也可单独设置模型与思考强度；辅助能力仍可跟随当前会话。修改档位会影响引用它的能力；新对话使用保存后的默认值，已有对话的手动选择保持不变。并发、超时、输入输出上限和重试次数统一放在「运行设置」。供应商页只管理连接与模型。无效配置会报告错误，不自动改用其他供应商；推理强度来自当前模型目录。

宿主支持热切换时启停即时生效；关闭模型中心后可恢复原模型设置页。安装、卸载或加载失败时按插件设置的提示操作。

插件默认档位：正文补全、当前标题、回顾使用快速；新对话、选区改写、需求澄清、自我改进使用对话；记忆整理使用思考。幻想档成本较高，不作为任何插件的默认档位，仅在用户显式选择时使用。保留用户已保存的单独设置。未安装或停用管理器时，档位调用使用默认对话模型。

## API / 导出

- `.` — Cordis 插件入口（`name`、`inject`、`apply`）、以 `ctx.modelCenter` 提供的 `ModelCenter` 服务（`status()`），以及 `handleHostRpc`。
- `./contracts` — 频道与插件常量（`MODEL_CENTER_RPC_CHANNEL`、`MODEL_CENTER_PLUGIN`、`MODEL_CENTER_ENTRY_ID`、`MODEL_ROLES`）、从 `@klarkxy/dsh-ai-services/contracts` 再导出的策略类型，以及界面类型（`ModelCenterStatus`、`ModelCenterTab`、`RegisteredPurpose`、`ProviderListing`、`DiscoveredModel`、`RoutePreview`）。
- `./client` — Web 客户端入口（`apply`），注册设置座位并渲染模型中心标签页。

宿主 RPC 为 `/dsh-model-center`，只有 `status` 一个端点，返回 `{ enabled, plugin }`。策略读写走 `/dsh-ai-services`：`status` 返回已存策略与已注册用途，`update` 按比较并交换修订号（`expectedRevision`）写入策略，`resolve` 预览某用途的路由而不调用模型。

## 开发

```sh
pnpm --filter @klarkxy/dsh-model-center typecheck
pnpm exec vitest run packages/dsh-model-center/src
pnpm --filter @klarkxy/dsh-model-center build
```

[许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-model-center/LICENSE)

部分宿主会预装并默认启用本功能；宿主支持热切换时，通过「设置 → 插件」开关无需重启。独立 DSH 需先加载 `@klarkxy/dsh-ai-services` 再加载本包；宿主提示需要重启时，安装或移除后重启。
