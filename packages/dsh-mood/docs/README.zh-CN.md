# @klarkxy/dsh-mood

默认启用的需求澄清：在 Host `agent/pre-step` 边界拦截代理请求，在含糊的工作开始前先提问确认。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/README.md)

需要 Node.js ≥22 和 DSH `0.1.7-rc.2`。插件安装后默认启用，也可在插件设置中关闭。它不会替代原生权限或写作提案确认。

```sh
npm install @klarkxy/dsh-mood
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-mood
```

在「设置 → 插件」开关需求澄清。启用后按自动模式运行，不再提供单独设置页。对话卡片使用座位 `dsh-editor.chat.events`，参数 `{sessionId, locale}`。

表述清楚的请求不调用 `mood.analyze`。自动模式只在确定存在实质含糊或风险时提问，且最多提 `MAX_QUESTIONS`（3）个问题。澄清在同一次 pre-step 内等待，然后只恢复这次被拦住的请求。

## 任务约定（TaskContract）

每个会话澄清出的需求存为一份 `TaskContract`（目标、交付、范围、约束、验收、假定、待确认问题、证据）。聊天卡片渲染目标、证据列表和澄清问题及其回答，并提供三个操作：「修订」（修改目标）、「重新分析」（重新分析该会话）、「按原请求重试」（有被扣住的原请求时恢复它一次）。

约定带有 `readiness` 状态：`pending`（待确认）、`clear-request`（表述清楚）、`user-confirmed`（作者已确认）、`disclosed-assumptions`（按已披露假定继续）、`cancelled`（已取消，未确认）、`stale`（已过期）。

在 `agent/pre-step` 时，约定快照作为有界的用户消息注入模型上下文；它只是描述性上下文，不能代替文件修改或发布审批。

### 名称对照

同一功能在不同界面有不同名称，指的都是它：

| 位置 | 名称 |
| --- | --- |
| 「设置 → 插件」功能入口 | 需求澄清 |
| 聊天座位 label | 需求约定 |
| 聊天卡片标题 | 任务约定 |
| API 与契约类型 | `TaskContract` |

## 宿主 RPC

频道 `/dsh-mood`，走宿主授权策略。

- `status` — 设置；传入 `sessionId` 时附会话视图（约定、澄清、扣留与待处理标记）。
- `contract` — 该会话当前的任务约定，没有时为 `null`。
- `mode` — 按比较并交换修订号保存澄清模式（`{ mode, expectedRevision }`）；功能启用期间存储的模式为 `auto`。
- `manual` — 为会话排队一次手动分析。
- `retry` — 恢复该会话被扣住的原请求一次。
- `edit` — 按比较并交换修订号修订约定目标（`{ sessionId, expectedRevision, patch }`）。

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm exec vitest run packages/dsh-mood/src
pnpm --filter @klarkxy/dsh-mood build
```

[发布说明](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/LICENSE)

部分宿主会预装并默认启用本功能；宿主支持热切换时，通过「设置 → 插件」开关无需重启。独立 DSH 需先加载 `@klarkxy/dsh-ai-services` 再加载本包；宿主提示需要重启时，安装或移除后重启。
