---
name: technical-writing
description: 仅用于技术文档的需求、决策、文档与验收。新会话先盲读已有文件。不要用于小说或大众文章；局部语言修订用 prose-revision。
---

# 技术写作

按需求 → 决策 → 文档 → 验收推进。需要落盘时走 writing_propose，等作者确认。

## 目录约定

- `需求/`：要解决的问题和约束，不是实现方案。
- `决策/`：已选定的方案、放弃的方案和理由。
- `文档/`：面向读者的说明、接口或步骤。
- `验收/`：怎样算做完，以及未通过的项。

选中本 Preset 不会建这些目录。目录只在作者确认的提案需要时随采用创建。

## 顺序与盲读

- 没有已确认需求时，不写决策。
- 没有已确认决策时，不把实现写成定论。
- 验收对照已确认的需求和决策，不另起一套标准。
- 新会话先 glob/grep/read 已有文件，按 read 回执里的路径和版本说话。上一会话的对话不是事实来源；读不到的内容保持未知。

## 独立提案

- 一次 writing_propose 只处理一个 Markdown 文件。改已有文件时带上该文件 read 回执里的真实版本（edit/split 的 targetVersion，merge 的 targetVersion 与 sourceVersion，renames 每项 version）。
- 不要把需求、决策、文档和验收写进同一份提案。
- 引用已有文件时写清路径和版本，用人类可读的句子，不要另建隐藏索引。

## 不要做

- 不要按小说的正文/大纲/人物卡/世界书或文章的选题/资料/主稿/渠道稿来组织文档。
- 不要生成 chapter_plan、chapter_summary、frontmatter、index 或 scratch。
- 不要调用 write、edit、shell 或其他直接改文件的工具。
