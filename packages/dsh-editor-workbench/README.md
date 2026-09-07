# dsh-editor-workbench

Private Host-only plugin for DSH Editor project lifecycle, bounded
project-context compilation, chapter overview/status, proofread, cards, and
writing-progress logs.

It is bundled only in the desktop-owned `dsh-editor` profile. Its browser-safe
wire contract is exported from `dsh-editor-workbench/contracts`; the Host
implementation is not a public plugin API.

The Host injects `connection`, `sessions`, `workspaceRegistry`, `fs`,
`sandboxPolicy`, and `tools`. It derives every root from a live session and
reuses `dsh-manuscript/host-api`; callers cannot supply a trusted cwd. The
`tools` inject registers read-only `novel_overview`.

Sidecar files under `.dsh-editor/` (`chapter-status.json`, `writing-log.json`,
`敏感词.txt`, `敏感词-忽略.txt`) are excluded from snapshot payloads. Writes
including `cards.metaSet` / `cards.create` / `chapter.statusSet` /
`progress.record` go through `withWorkspaceWrite`.

To replace this implementation, preserve `/dsh-editor-workbench` and its
endpoint payloads, remove `editor-workbench` from the profile, then add
exactly one replacement entry. Never load two handlers for the same channel.
