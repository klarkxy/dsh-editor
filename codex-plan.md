# DSH Editor architecture

## Current decision

This workspace contains exactly two independently installable DSH plugins. It does not implement another application shell, Chat, Agent runtime, approval system, provider store, or conversation database.

```text
official DSH
├─ Chat / Agent / tools / approvals / providers / sessions
├─ dsh-manuscript
│  ├─ collapsed shell.overlay drawer
│  ├─ generic workspace tree and prose buffer
│  └─ loopback RPC → live session → registered workspace → DSH fs/sandbox
└─ dsh-grill
   ├─ scaffold_novel through the official tool/approval flow
   └─ additive four-mode writing prompt
```

The architecture is viable with one deliberate UI compromise: the installed public DSH API offers an additive overlay, but no supported way for a plugin to recompose the official root into a permanent editor-plus-Chat three-column frame. Manuscript therefore uses a closable 360 px drawer. Closed state has no full-screen pointer interception; a true first-class manuscript column requires an upstream shell composition API.

## Ownership boundaries

- Official DSH owns Chat, Agent execution, tool scheduling, approval UI, permission presets, session lifecycle, model/provider configuration, streaming, and conversation persistence.
- `dsh-manuscript` owns only manuscript presentation, local edit state, and its loopback filesystem/FIM RPC adapter.
- `dsh-grill` owns only one scaffold tool and an additive prompt section.
- The plugins have no imports, RPCs, files, schemas, or runtime state in common. Installing or removing either one does not change the other's contract.

## Manuscript host boundary

Browser filesystem requests carry `{ sessionId, path, ... }`; browser `cwd`, provider, and model values are ignored.

For every request the Host:

1. Resolves a live session by ID.
2. Reads its immutable `session.header.cwd`.
3. Resolves the registered workspace and verifies that the session belongs to it.
4. Resolves the session sandbox policy.
5. Normalizes the workspace-relative path and rejects absolute/device/traversal input.
6. Uses DSH `ctx.fs` for canonical resolution, containment, component-wise symlink rejection, stat/list/read, and writes.
7. Creates with `createIfAbsent` and saves with `replaceIfVersion`, passing the session policy to the atomic write.

Text I/O is capped at 2 MB. Binary/non-regular files, missing parents, stale versions, symlinks, read-only writes, unknown sessions, and workspace mismatches fail closed. GUI rename/delete/move/directory creation are intentionally absent because the current public DSH filesystem contract cannot implement them with the same atomic safety.

The RPC channel is `loopback`. Installed DSH currently gives a generic RPC handler no connection/session principal, so a supplied session ID proves only that the selected session is live, not that the browser caller owns it. This is acceptable only for DSH's local single-user trust model. Remote or multi-user exposure remains blocked until upstream supplies caller-bound RPC identity or capabilities.

## Manuscript client state

- The drawer starts closed and can be reopened without modifying the official root surface.
- Each loaded document tracks saved text, local text, opaque filesystem version, and `loading | saved | dirty | conflict | error` state.
- Unsaved text is persisted by workspace path and restored after a reload. Reverting to saved text removes the draft.
- Switching file/session/workspace holds the current buffer until the user saves or explicitly discards it. Browser unload and drawer close are guarded.
- Failed or stale saves preserve the buffer. Late reads and FIM responses are ignored after the target changes.
- “改这段” copies a reusable prompt to the clipboard. It does not query or mutate official Chat DOM elements.

FIM derives provider/model only from the live session's request header and calls official `llm.stream`. If that selection or service is absent, completion returns empty. Completion changes the local buffer only; disk changes still require an explicit guarded save.

## Grill v1

`dsh-grill` registers exactly one tool, `scaffold_novel`, and one additive prompt section with `planning`, `drafting`, `review`, and `first-reader` modes.

The scaffold tool uses the calling Agent session workspace, checks the resolved sandbox policy, asks through DSH's official pre-execute approval seam, never overwrites existing paths, and is idempotent. The prompt guides official Chat responses only. It does not write manuscript files, scan scenes, compile hidden context, access the Web, queue proposals, or require the manuscript plugin.

## Non-goals

- A second Chat/Agent or replacement conversation surface.
- Automatic application of Chat prose to files.
- A proposal store or cross-plugin protocol.
- Rename, delete, move, directory creation, filesystem watching, indexing, Git operations, or migration UI in Manuscript.
- Scene/AI-flavor scanners, external-model generation, canon state, or copied Skill assets in Grill.
- Publishing, tagging, or releasing from this repository without separate authorization.

## Verification gates

- Build and typecheck both packages.
- Run unit tests for workspace authority, path attacks, symlinks, atomic create/save, stale versions, read-only policy, dirty/conflict/draft state, late-response rejection, FIM routing, scaffold idempotence/approval, and four-mode prompts.
- Search source and packed artifacts for removed proposal/scan/Web-tool features and direct Node filesystem/provider-credential access in Manuscript.
- Pack exactly two plugin tarballs and inspect their exports, loader patches, client wrapper, licenses, and dependency closure.
- In an isolated DSH profile, verify scaffold approval, tree refresh/reload, editor save, dirty close guard, collapsed drawer behavior, and optional FIM. The live script must exit non-zero when any required check fails.
- Before release, run the four installation states: Manuscript only, Grill only, both, and removal of either. Publishing remains a separate explicit action.

## Compatibility and residual risks

The implementation targets installed `@deepseek-ai/dsh` `0.1.1-rc.1` with several nested first-party packages at `0.1.1-rc.2`. Host service shapes that are not exported as stable third-party types are structurally typed and backed by contract tests; every DSH upgrade requires rerunning live loading and filesystem tests.

DSH's userspace filesystem sandbox is not a kernel isolation boundary. This plugin performs path-component checks before and after canonical resolution and relies on the official sandbox backend to revalidate atomic writes, but should remain within DSH's documented local trust model.
