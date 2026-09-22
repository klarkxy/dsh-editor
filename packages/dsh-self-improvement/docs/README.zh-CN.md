# @klarkxy/dsh-self-improvement

默认启用的自我改进：候选教训写入共享记忆，审阅后可导出 Markdown 技能草稿。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-self-improvement/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.5-rc.2`。捆绑入口安装后默认启用，也可在插件设置中关闭。本插件**不会**替宿主加载记忆或开启 Dream；独立部署仍需安装并加载 `@klarkxy/dsh-memory`。

```sh
dsh plugin --profile web add @klarkxy/dsh-self-improvement
```

候选教训与技能草稿统一在 **设置 → 自我改进** 审阅；聊天区不显示插件状态、空状态或管理控件。

## 行为

只从明确的人工纠正，或「同名工具先失败、后核实成功」摘录候选。沉默和模型自称成功不视为成功。候选以 Memory `kind: lesson`、`source: self-improvement` 保存，接受前不进入提示。注入使用 `createUserMessage`，只放入与当前用户请求相关、未过期的已接受教训（最多 5 条，含包装约 800 tokens）。关闭本插件或等待期间关闭记忆都不会注入旧教训。

已接受的教训可预览带 `name`/`description` 的技能 Markdown。导出是浏览器下载，不会安装技能，也不会改写 `AGENTS.md`、脚本或其他插件。应用内导出记录只在实际开始下载后写入。撤回导出只更新应用内记录，不会收回已下载的文件。

[发布维护](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-self-improvement/LICENSE)
