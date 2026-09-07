# dsh-editor-novel-kernel

Private Host-only DSH Editor plugin for the fixed novel-writing tool boundary:
bundled reference cards, preview-only proposals, the shared tool guard, the
editor system-prompt section, and a loopback `/novel-kernel` channel for
Zhihu knowledge-base list/upload.

`./contracts` is browser-safe and exposes tool names plus the versioned
proposal / memory marker parsers used by the Shell UI.

## Tools

Registered by this Host: `novel_knowledge`, `novel_propose`, `author_observe`,
`novel_index_write`, `novel_search`, `project_knowledge`, `zhihu_search`,
`zhihu_global_search`, `zhihu_hot_list`, `zhihu_ask`, `zhihu_knowledge_search`,
`novel_scratch_write`, `novel_scratch_read`, `novel_scratch_list`.

`novel_overview` is registered by `dsh-editor-workbench` under the same tool
name; the kernel guard still admits it. `novel_propose` may emit Markdown
`edit` / `create` / `split` / `merge` / `renames` markers and never writes
files. Index writes go through `novel_index_write` only.

## RPC

Channel `/novel-kernel` (`authority: 'loopback'`):

- `zhihu.knowledge.bases` — read, list knowledge bases
- `zhihu.knowledge.upload` — write, UI-initiated upload (`fileName`,
  `contentBase64`, optional `knowledgeBaseId`)

## Inject

`tools`, `systemPrompt`, `fs`, `credentials`, `connection`, `sandboxPolicy`.
`credentials` and `connection` are tolerated as missing in unit tests.

To replace it, preserve the tool names, marker schema, guard semantics,
`/novel-kernel` endpoints, and `dsh-editor:novel-kernel` section, then swap
the single `editor-novel-kernel` profile entry. Do not load two kernel
implementations or grant the replacement direct manuscript writes.
