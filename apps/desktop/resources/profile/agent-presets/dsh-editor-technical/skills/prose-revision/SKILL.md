---
name: prose-revision
description: 仅用于已有文稿的语言、节奏、衔接与去 AI 腔修订。不规划结构、不改目录协议、不写选题或技术方案。结构、规划与专业体裁改用当前 Preset 的专业工作流（若有）。
---

# 文稿修订

只改指定范围内的说法、节奏和衔接，不改事实、结构或尚未讨论的结论。

## 何时加载

作者要求润色、改顺、去 AI 腔、收紧句子或局部重写，且目标已经是落在磁盘上的文稿。

## 做法

- 先 read 目标片段，把 read 回执里的真实版本写入 writing_propose：edit/split 用 targetVersion，merge 用 targetVersion 与 sourceVersion，renames 每项带 version。不要编造版本，也不要用后来的读取替换已过期的生成基线。
- 一次 writing_propose 只处理一个文件。oldText 必须是原文里唯一、完整的片段。
- 作者说「校对、微调、尽量少改」时只修妨碍阅读的问题；说「润色、改顺」时可以重写呈现，但仍不得改情节、论点、接口或已确认结论。
- 只要求审查时只指出问题，不提案。
- 选中 Preset 或加载本技能都不会建目录、不会写项目。

## 不要做

- 不要补大纲、人物卡、选题、需求或验收。
- 不要生成 chapter_plan、chapter_summary、frontmatter、index 或 scratch。
- 不要调用 write、edit、shell 或其他直接改文件的工具。
