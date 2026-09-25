# @klarkxy/dsh-recap

后台回顾生成与独立的 agent 检查点。插件默认启用，可在「设置 → 插件」关闭。回顾、agent 检查点和语义检查点都使用固定的自动默认值。回顾只用于展示，不作为模型上下文。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-recap/README.md)

需要 Node.js ≥22、DSH `0.1.7-rc.2`。辅助生成依赖 `@klarkxy/dsh-ai-services`，并要求 `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/dsh-session` 对等依赖。

```sh
npm install @klarkxy/dsh-recap
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-recap
```

较长轮次结束、或闲置间隔（默认 15 分钟，只计算文档与用户操作，不算助手输出，且聊天面板为 `hidden` 时不计）后返回，会在后台生成回顾。聊天事件座位是一个安静的生命周期控制器，不渲染卡片、按钮、空状态或错误。回顾没有单独设置页，也没有手动生成按钮。读取状态不调用模型；每个水位线最多生成一次，除非重试该卡片或请求一次手动 `refresh`。检查点只在宿主 `agent/pre-step` 的有意义边界注入，使用原生 `createUserMessage`。

同一 profile 也启用需求澄清插件时，回顾通过 `ctx.aiMood.getContract(sessionId)` 读取它的任务约定，用于检查点上下文。

各能力开关没有设置界面：只能通过 `update` RPC 修改，或在「设置 → 插件」关闭整个插件。关闭某项能力会取消在途生成并停止自动注入，已存回顾保留。卸载插件会等待未完成的写入，并忽略之后的会话事件。

## 宿主 RPC

频道 `/dsh-recap`，走宿主授权策略。

- `status` — 设置、存储健康状况、已存的回顾卡片与检查点（可限定单个 `sessionId`）。不调用模型。
- `update` — 按比较并交换修订号（`expectedRevision`）写入设置（`cardsEnabled`、`checkpointsEnabled`、`semanticCheckpointsEnabled`、`idleReturnMs`）。
- `cards` / `checkpoints` — 已存的回顾卡片或检查点，可限定单个会话。
- `cancel` / `retry` — 取消某卡片的在途生成，或重新生成该卡片（`{ cardId, sessionId }`）。
- `idle.return` — 立即为会话执行一次闲置返回检查。
- `refresh` — 按需为会话生成一份回顾（`manual` 触发），不受「每个水位线只生成一次」限制。

从仓库根目录运行：

```sh
pnpm --filter @klarkxy/dsh-recap typecheck
pnpm exec vitest run packages/dsh-recap/src
pnpm --filter @klarkxy/dsh-recap build
```

部分宿主会预装并默认启用本功能；宿主支持热切换时，通过「设置 → 插件」开关无需重启。独立 DSH 需先加载 `@klarkxy/dsh-ai-services` 再加载本包；宿主提示需要重启时，安装或移除后重启。
