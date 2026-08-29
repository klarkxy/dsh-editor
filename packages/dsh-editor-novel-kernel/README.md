# dsh-editor-novel-kernel

Private Host-only DSH Editor plugin for the fixed novel-writing tool boundary:
bundled reference cards, preview-only proposals, the shared tool guard, and the
editor system-prompt section. It has no RPC, renderer, workspace/session state,
or direct file-writing capability.

`./contracts` is browser-safe and exposes only tool names plus the versioned
proposal marker parser/type used by the Shell UI.

The Host injects only `tools` and `systemPrompt`. To replace it, preserve the
tool names, marker schema, guard semantics, and `dsh-editor:novel-kernel`
section, then swap the single `editor-novel-kernel` profile entry. Do not load
two kernel implementations or grant the replacement direct manuscript writes.
