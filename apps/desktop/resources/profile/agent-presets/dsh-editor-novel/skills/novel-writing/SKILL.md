---
name: novel-writing
description: 仅用于小说的规划、正文与 canon。目录约定为正文/大纲/人物卡/世界书。不要用于文章选题或技术规格；局部语言修订用 prose-revision。
---

# 小说写作

规划、正文和 canon 是三类独立工作。需要落盘时各自走 writing_propose，等作者确认。

## 目录约定

- `正文/`：已经发生的故事。
- `大纲/`：全书、分卷、阶段大纲和章纲。章纲是普通 Markdown，可以写在总纲对应章节，也可以按作品拆到 `大纲/章纲/`。
- `人物卡/`：一人一文件，路径 `人物卡/姓名.md`。
- `世界书/`：一词条一文件，路径 `世界书/词条名.md`。

选中本 Preset 不会建这些目录。目录只在作者确认的提案需要时随采用创建。

## 独立提案

- 规划提案只改 `大纲/`。
- 正文提案只改 `正文/`。
- canon 提案只改一张人物卡或一条世界书。
- 一次 writing_propose 只处理一个 Markdown 文件。不要把章纲、正文和设定写进同一份提案。改已有文件时带上该文件 read 回执里的真实版本（edit/split 的 targetVersion，merge 的 targetVersion 与 sourceVersion，renames 每项 version）。
- 不要生成 `chapter_plan`、`chapter_summary`、frontmatter、index 或 scratch。章纲不写进正文文件头，也不另建隐藏元数据。
- 不要写人物索引、设定总汇或合订本。已有合订文件用多次提案拆成单卡，不要继续往合订本里追加。
- 尚在讨论的备选方案不要写入。落笔后不要求补章纲或章末小结。

## 不要做

- 不要按文章的选题/资料/主稿/渠道稿或技术文档的需求/决策/文档/验收来组织作品。
- 不要调用 write、edit、shell 或其他直接改文件的工具。
