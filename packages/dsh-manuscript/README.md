# dsh-manuscript

DSH GUI plugin providing a generic workspace tree, prose editor, guarded saves, recoverable local drafts, word count, previous/next navigation, and optional ghost completion. It is independent of `dsh-grill`; official DSH remains the only Chat and Agent surface.

The manuscript drawer uses the public `shell.overlay` slot and starts collapsed, so it does not permanently cover DSH workspace controls. Closing or switching with unsaved text is guarded, save conflicts preserve the local buffer, and late read/FIM responses cannot overwrite a newly selected document. “改这段” copies a prompt to the clipboard instead of reaching into the official Chat DOM.

Host file operations accept a live `sessionId`, derive the canonical workspace from the immutable session header and registered workspace membership, then use DSH `ctx.fs` plus the resolved sandbox policy. Creates use `createIfAbsent`; saves use `replaceIfVersion`; absolute paths, traversal, symlinks, oversized text, stale versions, unknown sessions, and read-only writes fail closed. A generic DSH RPC request has no caller principal, so the session ID is a live-session selector rather than authentication; the channel remains loopback-only and must not be exposed as a remote multi-user API.

FIM uses the provider/model recorded on the live session request header and calls DSH `llm.stream`. It never reads provider credentials directly and returns no completion when the session has no model selection.

Compatible with `@deepseek-ai/dsh` 0.1.1-rc.1 (nested first-party packages 0.1.1-rc.2). Dual-face package: host ESM plus lazy-CJS `./client`.
