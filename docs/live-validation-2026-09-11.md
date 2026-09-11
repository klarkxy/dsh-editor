# MiniMax-M3 与知乎真调用实测（0.1.5-rc.2）

日期：2026-09-11。用户明确授权使用 MiniMax-M3 与本机知乎 Access Secret。隔离 HOME，经真实 DSH Host 与浏览器界面调用；未使用响应 mock。密钥未写入回执、日志或截图。未改写 2026-09-10 的历史回执。

## MiniMax-M3

[最终在线回执](verification/live-2026-09-11/minimax-ai-run.json) 6/6 通过。模型为界面选择的 MiniMax · MiniMax-M3。DSH 为 `0.1.5-rc.2`。

| 功能 | 实际证据 |
| --- | --- |
| 聊天 | 返回 pong。官方 `uiConversation` 在本地 `uiWorkspace` 之后由子 fiber 绑定，transcript 有 3 个节点（用户、思考过程、pong） |
| 选段改写 | `patch.complete` HTTP 200，`dsh-llm`，20 字；第一章种子句被缩短，无 `<think>` |
| 行内补全 | `fim.complete` HTTP 200，`dsh-llm`，225 字；接受后第二章落盘加长，无 `<think>` |
| 文件提案 | 应用后生成 `大纲/总纲.md`（176 字，含雾港/林简） |
| 会话操作 | 新会话可选 MiniMax-M3；归档与恢复通过 |

[磁盘复核](verification/live-2026-09-11/saved-text-check.json) 确认改写生效、补全文本已落盘、正文没有推理标签。

首次在 0.1.5 上跑时，Host 已经完成回合（投影缓存有 token 与 pong 思考），界面却停在「已发送 / 正在回复…」。原因是 Shell 不能在 `apply()` 时 inject `uiConversation`（它要等本地 `uiWorkspace`），第一次挂上 Chat 时官方对话分面还没就绪。子 fiber 绑定后 6/6 通过。

```powershell
pnpm --filter dsh-editor-shell build
$env:DSH_EDITOR_COMPOSITION = 'full'
$env:E2E_FEATURE_AI_ONLY = '1'
node e2e/feature-coverage.mjs
```

## 知乎 Access Secret

[知乎回执](verification/live-2026-09-11/zhihu-live.json) 7/7 通过。凭据来自本机 `~/.config/zhihu-search/credentials.json`（未打印）。隔离 HOME 不携带 DSH 凭证库，插件按文件回退解析。0.1.5 的 `/zhihu` 需先用 loopback token 换 cookie。

| 功能 | 实际证据 |
| --- | --- |
| `/zhihu` 站内搜索 | HTTP 200，5 条，首条为小说节奏/结构讨论 |
| `/zhihu` 热榜 | HTTP 200，5 条 |
| `/zhihu` 直答 | `zhida-fast-1p5` HTTP 200，62 字可用正文 |
| 用量 | 当日 3 次调用、0 失败、11 条结果 |
| 面板搜索 / 热榜 | 界面分别显示「站内搜索共 5 条」「知乎热榜共 10 条」 |

```powershell
$env:DSH_EDITOR_COMPOSITION = 'full'
$env:E2E_ZHIHU_ASK = '1'
node scripts/prepare-desktop-dev.mjs
node e2e/zhihu-live.mjs
```

未提交密钥、`.dev/` 或 `e2e/out/`。
