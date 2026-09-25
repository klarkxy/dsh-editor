# @klarkxy/dsh-ai-services

插件共用的 Cordis 服务：模型角色路由、有界辅助调用、取消与用量回执。这是支撑服务，不是面向用户的功能。装上后不会自行发起推理。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.7-rc.2`。宿主需提供 `llm`、`storageDomain`、`connection`、`webServer`、`agents`、`sessionProjections`、`agentDefaultModel`。

```sh
npm install @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-ai-services
```

本包是宿主锁定的核心服务。功能插件需要模型时调用 `ctx.aiServices.activate(plugin)`，本包不会自行调用模型。

## 路由

角色 `weak`、`normal`、`strong`、`fantasy` 即快速、对话、思考、幻想四档：快速档用于低成本、低延迟的辅助调用，对话档是日常默认，思考档用于更重的推理，幻想档是成本最高的创作档位。四档均可绑定任意供应商模型。内置插件不默认使用幻想档，只有用户显式选择时才使用。档位未配置时使用对话档，再回退到宿主默认对话模型；宿主默认模型按次读取，独立插件无需应用侧初始化即可调用。宿主默认对话模型缺失会显式报错。显式指定了无效的供应商／模型／推理强度时同样报错，不会改用其他路由。会话目标使用宿主原生投影、请求头与宿主默认模型，不调用已移除的 `session.models` RPC。

策略是带比较并交换（compare-and-swap）修订号的一条 storage-domain 记录，不复制供应商凭据。宿主兼容迁移通过 `importPurposes` 原子地写入缺失的用途默认值与一次性标记。

辅助调用是纯文本、不带工具。限制覆盖输入长度、输出 token、总时长、重试次数和单供应商并发。交互任务排在后台任务之前；存在原生 agent 循环请求时，它占用同一供应商的前台，后台任务等待。`run({ insert: { maxChars } })` 支持有界文本候选；其他辅助调用仍要求流完整成功。

用量回执在适配器上报时记录 token 数。成本未知时为 `null`。不存储提示词与密钥。

宿主 RPC 为 `/dsh-ai-services`（`status`、`update`、`resolve`、`usage`），走宿主授权策略。

## API / 导出

- `.` — Cordis 插件入口（`name`、`inject`、`apply`）、`AiServicesRuntime`、`registerHostRpc`、RPC 频道与座位常量，以及 `./contracts` 的全部契约类型再导出。
- `./contracts` — 浏览器安全的共享契约，不含宿主实现。
- `./host-rpc` — 供宿主挂载 `/dsh-ai-services` 频道的 `registerHostRpc` 与 `HostRpcContext`。
- `./client-utils` — Web 客户端辅助：`NativeSurfaceClient`、`useNativeSeat`、`useFeatureRefresh`、`selectedSessionId`。
- `./insert-output` — 有界插入候选辅助：`sanitizeInsert`、`collectInsertText`、`createInsertCollector`。

### AiServices

功能插件通过 `ctx.aiServices` 使用服务：

- `activate(plugin)` — 返回绑定该插件的 `AiFeatureScope`（`registerPurpose`、`run`、`dispose`），插件卸载时一并释放。
- `importPurposes(migrationId, defaults, roles?)` — 仅限宿主的兼容入口，原子地持久化缺失的用途默认值与一次性标记。
- `getPolicy()` / `updatePolicy(policy, expectedRevision)` — 读取策略，或按比较并交换修订号写入。
- `resolve(purpose, sessionId?, override?)` — 把用途解析为 `ResolvedRoute`，不调用模型。
- `purposes()` — 全部已注册的 `PurposeSpec` 及其所属插件。
- `usage()` — 已存储的用量回执。

### 共享契约（`./contracts`）

| 导出 | 用途 |
| --- | --- |
| `MemoryService`、`MemoryRecord` | 由记忆插件实现的记忆存储契约；观察在显式接受前保持候选状态 |
| `TaskContract`、`TaskCheckpoint`、`EvidenceRef` | 与需求澄清、回顾插件共享的任务约定与检查点形状 |
| `CHAT_EVENTS_SLOT` | 聊天事件座位名（`dsh-editor.chat.events`） |
| `MODEL_SETTINGS_SLOT` | 模型设置座位名（`dsh-editor.settings.models`） |
| `AI_RPC_CHANNEL` | 宿主 RPC 频道名（`/dsh-ai-services`） |
| `projectIdFromCwd` | 从宿主校验过的会话目录推导项目键 |

从仓库根目录运行：

```sh
pnpm --filter @klarkxy/dsh-ai-services typecheck
pnpm exec vitest run packages/dsh-ai-services/src
pnpm --filter @klarkxy/dsh-ai-services build
```

[发布说明](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-ai-services/LICENSE)
