# @klarkxy/dsh-mood

默认启用的需求澄清，挂在 Host `agent/pre-step`。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-mood/README.md)

需要 Node.js ≥22 和 DSH `0.1.5-rc.2`。插件安装后默认启用，也可在插件设置中关闭。它不会替代原生权限或写作提案确认。

```sh
dsh plugin --profile web add @klarkxy/dsh-mood
```

打开「设置 → 需求澄清」，可选自动、手动或严格。对话卡片使用座位 `dsh-editor.chat.events`，参数 `{sessionId, locale}`。

表述清楚的请求不调用 `mood.analyze`。自动模式只在确定存在实质含糊或风险时提问。澄清在同一次 pre-step 内等待，然后只恢复这次被拦住的请求。Recap 可通过 `ctx.aiMood.getContract(sessionId)` 读取约定。

```sh
pnpm --filter @klarkxy/dsh-mood typecheck
pnpm exec vitest run packages/dsh-mood/src
pnpm --filter @klarkxy/dsh-mood build
```
