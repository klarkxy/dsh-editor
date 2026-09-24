# @klarkxy/dsh-self-improvement

默认启用的自我改进：教训自动摘录进共享记忆并即时生效，可审计、可撤回，支持导出 Markdown 技能草稿。

[English](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-self-improvement/README.md)

## 安装

需要 Node.js ≥22、DSH `0.1.7-alpha.1`。捆绑入口安装后默认启用，也可在插件设置中关闭。本插件**不会**替宿主加载记忆或开启 Dream；独立部署需先加载共享服务 `@klarkxy/dsh-ai-services`，再安装、加载并启用 `@klarkxy/dsh-memory`。

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-memory
dsh plugin --profile web add @klarkxy/dsh-self-improvement
```

在 **设置 → 记忆** 展开 **自我改进** 审计教训与技能草稿；本插件没有单独设置页，聊天区也不显示管理控件。

## 行为

只从明确的人工纠正，或「同名工具先失败、后核实成功」摘录。沉默和模型自称成功不视为成功。教训以 Memory `kind: lesson`、`source: self-improvement` 保存，摘录成功即自动生效，可随时撤回。注入使用 `createUserMessage`，只放入与当前用户请求相关、未过期的已生效教训（最多 5 条，含包装约 800 tokens）。关闭本插件或等待期间关闭记忆都不会注入旧教训。

已生效的教训可预览带 `name`/`description` 的技能 Markdown。导出是浏览器下载，不会安装技能，也不会改写 `AGENTS.md`、脚本或其他插件。应用内导出记录只在实际开始下载后写入。撤回导出只更新应用内记录，不会收回已下载的文件。

[发布维护](https://github.com/klarkxy/dsh-editor/blob/main/packages/PUBLISHING.md) · [许可证](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-self-improvement/LICENSE)
