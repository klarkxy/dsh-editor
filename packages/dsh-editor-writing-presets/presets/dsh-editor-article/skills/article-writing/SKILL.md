---
name: article-writing
description: 仅用于文章的选题、资料、主稿与渠道稿。依据与基线用人类可读的路径和版本记录。不要用于小说或技术规格；局部语言修订用 prose-revision。
---

# 文章写作

选题、资料、主稿和渠道稿分开存放。需要落盘时走 writing_propose，等作者确认。

## 目录约定

- `选题/`：题目、角度、读者和尚未写进主稿的取舍。
- `资料/`：摘录、链接说明和人类可读的依据。
- `主稿/`：面向默认读者的正文。
- `渠道稿/`：按渠道改写的版本，不覆盖主稿。

选中本 Preset 不会建这些目录。目录只在作者确认的提案需要时随采用创建。

## 依据与基线

引用或改写已有材料时，在资料或提案说明里用人类可读的句子写清「依据与基线」：项目相对路径，加上 read 回执中的真实版本。不要另建隐藏索引、frontmatter、index 或 scratch 来代替这条记录。

## 独立提案

- 一次 writing_propose 只处理一个 Markdown 文件。改已有文件时带上该文件 read 回执里的真实版本（edit/split 的 targetVersion，merge 的 targetVersion 与 sourceVersion，renames 每项 version）。
- 不要把选题、主稿和渠道稿写进同一份提案。
- 渠道稿从已确认的主稿改写，并写明依据的主稿路径与版本。
- 资料缺口保持未知，不要把推测写成已核实事实。

## 不要做

- 不要按小说的正文/大纲/人物卡/世界书或技术文档的需求/决策/文档/验收来组织稿件。
- 不要生成 chapter_plan、chapter_summary、frontmatter、index 或 scratch。
- 不要调用 write、edit、shell 或其他直接改文件的工具。
