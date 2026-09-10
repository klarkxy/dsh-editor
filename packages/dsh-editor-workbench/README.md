# dsh-editor-workbench

Private Host-only plugin for DSH Editor project lifecycle, bounded
project-context compilation, chapter overview/status, proofread, and
writing-progress logs.

It is bundled only in the desktop-owned `dsh-editor` profile. Its browser-safe
wire contract is exported from `dsh-editor-workbench/contracts`; the Host
implementation is not a public plugin API. Card list/create/meta/reference
RPCs live on `dsh-editor-cards`; this package imports `listCards` from
`dsh-editor-cards/host-api` for proofread card-vs-manuscript checks.

The Host injects `connection`, `sessions`, `workspaceRegistry`, `fs`, and
`sandboxPolicy`. It derives every root from a live session and reuses
`dsh-manuscript/host-api`; callers cannot supply a trusted cwd. The optional
`dsh-editor-workbench/tools` entry injects `tools` and registers read-only
`novel_overview`.

Host RPC dispatch is a per-cluster handler table in `src/rpc/`, still one
Cordis entry and one channel (`/dsh-editor-workbench`). To add an endpoint:
declare it on the `WorkbenchEndpoint` union and request/response maps, then
add a `WorkbenchHandler` to the matching cluster module (`mutation`,
`sessionless`, and `sessionKey` as needed). The merged table is checked at
load/typecheck for duplicates and missing/extra keys; `withWorkspaceWrite`
gating is derived from `mutation: true`.

Sidecar files under `.dsh-editor/` (`chapter-status.json`, `writing-log.json`,
`敏感词.txt`, `敏感词-忽略.txt`) are excluded from snapshot payloads. Writes
including `chapter.statusSet` / `progress.record` go through
`withWorkspaceWrite`.

To replace this implementation, preserve `/dsh-editor-workbench` and its
endpoint payloads, remove `editor-workbench` from the profile, then add
exactly one replacement entry. Never load two handlers for the same channel.
