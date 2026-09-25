# @klarkxy/dsh-self-improvement

Self Improve 负责“怎样做事”：目标、适用条件、推荐步骤、避免做法与检查方式。作者用语、偏好和最近在做什么由 Dream 维护。

[English](../README.md)

## 独立 DSH Web 安装

需要 Node.js ≥22、DSH `0.1.7-rc.2`，不依赖 Editor 私有包。

```sh
dsh plugin --profile web add @klarkxy/dsh-ai-services
dsh plugin --profile web add @klarkxy/dsh-memory
dsh plugin --profile web add @klarkxy/dsh-self-improvement
```

Memory 必须明确启用为存储，Dream 可以关闭。本插件不会替用户打开其他插件。安装后默认启用，可单独停用；在「设置 → 记忆 → 自我改进」审计行动经验与技能草稿，不增加聊天管理面板或单独设置页。

## 生效与证据

新增 lesson 的 procedure 包含来源类型（明确要求或结果观察）、目标、条件、步骤、避免项和验证检查。原文依据与例外保留。纯词义或事实纠正不生成方法；混合消息只摘录方法部分，临时请求、角色台词和引用资料不变成永久规程。

明确的人类方法要求可在原适用范围内直接生效；正向方法反馈和工具恢复观察保留为候选，采纳后才参与行动。采纳表示允许使用，不代表通过了自动化质量验证。当前指令、任务验收标准及权限始终优先。

工具恢复要求同一人类请求、明确的同一目标和发生变化的参数。仅同名工具后来没报错、另一文件成功、目标未知或参数不变的重试都不够；即使匹配，也只算观察。沉默和模型自称成功不作为成功依据。没有 AI 时，只保守保留明确的方法要求，不把词义或错误日志整段当作技能。

通过原生 pre-step 注入最多 5 条、含包装约 800 tokens 的相关 active 方法。支持中文检索；用户只说“继续”时先读取未过期的同项目近期状态，再选方法，不依赖插件加载顺序。停用或等待期间失去 Memory 时不注入旧结果。

Skill 由已生效方法形成可审阅 Markdown 草稿。采纳、下载和撤回仍为显式操作，不自动安装、不改写 AGENTS.md 或执行脚本；撤回不收回已经下载的文件。旧记录继续可读，不补造结构化字段或验证历史。

[设计与限制](../../../docs/portable-learning.md) · [发布维护](../../PUBLISHING.md) · [许可证](../LICENSE)
