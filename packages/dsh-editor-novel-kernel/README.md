# dsh-editor-novel-kernel

Private Host-only DSH Editor plugin for the fixed novel-writing tool boundary:
bundled reference cards, preview-only proposals, the shared tool guard, and the
editor system-prompt section.

`./contracts` is browser-safe and exposes tool names plus the versioned
proposal / memory marker parsers used by the Shell UI.

## Tools

Registered by this Host: `novel_knowledge`, `novel_propose`, `author_observe`,
`novel_index_write`, `novel_scratch_write`, `novel_scratch_read`,
`novel_scratch_list`.

`novel_overview` is registered by `dsh-editor-workbench` under the same tool
name; the kernel guard still admits it. Zhihu tools are registered by
`dsh-zhihu/tools`. The old `novel_search` / `project_knowledge` tools are no
longer registered. `novel_propose` may emit Markdown `edit` / `create` /
`split` / `merge` / `renames` markers and never writes files. Index writes go
through `novel_index_write` only.

## Inject

`tools`, `systemPrompt`, `fs`, `sandboxPolicy`.

To replace it, preserve the tool names, marker schema, guard semantics, and
`dsh-editor:novel-kernel` section, then swap the single `editor-novel-kernel`
profile entry. Do not load two kernel implementations or grant the replacement
direct manuscript writes.
