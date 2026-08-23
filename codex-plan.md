# Goal

Build two independent, installable DSH plugins while keeping official DSH as the complete agent harness:

- `dsh-manuscript`: a three-column writing GUI with a generic workspace tree, prose editor with ghost FIM, and the unmodified official DSH conversation.
- `dsh-grill`: a minimal novel-writing extension containing one scaffold tool and four prompt-routing modes.

Official DSH continues to own Chat, Agent execution, tools, approvals, permission presets, sessions, providers, streaming, and conversation persistence. “Agent 代写” means asking the official Chat agent to write; neither plugin introduces a second chat or agent runtime.

The implementation targets the locally installed DSH snapshot: top-level `@deepseek-ai/dsh` is `0.1.1-rc.1`, while several nested first-party packages report `0.1.1-rc.2`. The current installed packages are the API authority; `dsh-plugin-autoevo` supplies proven third-party packaging patterns but targets the older `0.1.0-rc.6` API generation.

# Non-goals (v1)

- Reimplementing or wrapping official Chat, Agent, approval UI, permission presets, tool execution, session storage, or provider configuration.
- Registering manuscript as a `conversation.view` tab; that would replace Chat instead of showing Chat simultaneously.
- Novel-grouped GUI navigation. The tree mirrors the workspace filesystem.
- Directory creation from the manuscript GUI.
- Delete, rename, move, filesystem watch, bulk import, project migration, or Git operations.
- Automatically applying Chat output to a document.
- Native provider-specific FIM APIs; the inspected DSH API exposes chat-style `llm.stream`, not a verified prefix/suffix FIM endpoint.
- Packaging the complete `grill-your-novel` Skill or its reference directory.
- AI-flavor concepts, `scan_ai_flavor`, `scan_scene`, external-model generation, `llm-request`, or model-comparison workflows.
- `.grill` state, long-term canon synchronization, background indexing, or autonomous manuscript edits.
- A shared runtime package between the plugins. There will be exactly two installable packages.

# Package layout

```text
dsh-editor/
├─ package.json                  # private workspace; not installable
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ packages/
│  ├─ dsh-manuscript/
│  │  ├─ package.json
│  │  ├─ cordis.patch.yml
│  │  ├─ src/
│  │  │  ├─ index.ts            # host ESM plugin
│  │  │  ├─ rpc/
│  │  │  │  ├─ contract.ts
│  │  │  │  ├─ files.ts
│  │  │  │  └─ completion.ts
│  │  │  └─ client/
│  │  │     ├─ index.tsx        # DSH lazy-CJS client entry
│  │  │     ├─ ManuscriptFrame.tsx
│  │  │     ├─ WorkspaceTree.tsx
│  │  │     ├─ ProseEditor.tsx
│  │  │     └─ ghost-fim.ts
│  │  └─ test/
│  └─ dsh-grill/
│     ├─ package.json
│     ├─ cordis.patch.yml
│     ├─ src/
│     │  ├─ tools.ts             # grill-tools host entry
│     │  ├─ workflow.ts          # grill-workflow host entry
│     │  ├─ scaffold.ts
│     │  └─ prompts/
│     │     ├─ router.ts
│     │     ├─ planning.ts
│     │     ├─ drafting.ts
│     │     ├─ review.ts
│     │     └─ first-reader.ts
│     └─ test/
└─ opendesign-preview/           # visual reference only
```

Packaging rules:

- Both packages use host ESM and declare `dsh.bundle.patch`.
- `dsh-manuscript` exports `.` for the host and `./client` for the browser half.
- Its `dsh.client.platform` is `web`.
- The client artifact is DSH’s inspected lazy-CJS form: it registers a CommonJS-style factory through `window.__ModuleLoader__`. It is not ordinary browser ESM.
- `dsh-grill` is host-only and does not ship a meaningless client entry.
- `dsh-grill` exports `./tools` and `./workflow`; its patch loads both subpaths while remaining one installable package.
- Root configuration, tests, and build helpers are private and do not become a third package.

# Plugin contracts (what you actually inspected)

| Contract | Inspected behavior and design consequence |
|---|---|
| `conversation.view` | It is a session-scoped list slot inside the official conversation surface. Only one registered view is displayed at a time. The shipped Chat view and a manuscript view would become sibling tabs, so it cannot satisfy “editor plus official Chat simultaneously.” Manuscript will not register here. |
| Official layout | `@deepseek-ai/dsh-client-ui-layout` owns the root three-column `AppFrame` and declares `sidebar`, `conversation`, and `details`. Registering into `conversation` replaces the complete official conversation surface. `AppFrame` and `ConversationRoot` are package-internal, not public component exports. |
| `connection.rpc.handle/call` | Host: `handle(channel, handler, {authority})`; client: `call(channel, endpoint, payload, signal?)`. Results use `{ok:true,value}` or `{ok:false,error}`. Manuscript will own `/manuscript` with `loopback` authority and pass cancellation signals through. |
| `defineTool` | Registers typed parameters, mandatory output schema/rendering, and an async executor receiving `exec.signal` and optional `exec.agent`. Calls pass through DSH’s pre-execute, guards, execution, post-execute, rendering, and result pipeline. |
| Tool approvals | `defineTool` does not automatically mark a tool as approval-required. The verified extension point is `tools/pre-execute`, which can return `allow`, `deny`, or `ask`; DSH then routes `ask` through its official one-shot approval seam. Missing answerers fail closed. |
| Sandbox policy | `ctx.sandboxPolicy.resolve({session?, mode?})` returns the effective mode and canonical workspace root. Session `cwd` is the normal workspace boundary. |
| DSH filesystem | `ctx.fs` exposes resolution, containment, stat/lstat, lazy directory listing, text reads, and atomic/version-guarded text writes. It does not expose directory creation, deletion, rename, or watching. |
| `systemPrompt.section` | Registers an additive ordered section whose text may be static or derived from `AssembleContext`. It does not expose the latest user message for programmatic classification. Therefore v1 routing is a static instruction telling the official agent to select a mode—not a deterministic runtime classifier. |
| `llm.stream` | Requires provider, model, and messages; yields block and delta events and accepts an abort signal. No inspected FIM-specific prefix/suffix fields exist. Its allowed `purpose` values do not include FIM. |
| Client packaging | Installed client modules declare `dsh.client.platform: "web"`, resolve `exports["./client"]`, and load lazy CommonJS factories. Exact third-party build configuration that generates this wrapper was not shipped in the inspected packages and remains **UNKNOWN**. |
| Bundle patching | Local `dsh-plugin-autoevo` verifies `dsh.bundle.patch` and Cordis patch insertion. Installed first-party patches verify that package subpaths can be loader entries. |
| Skill source | The decomposition was based on [SKILL.md](</C:/Users/27837/.agents/skills/grill-your-novel/SKILL.md>), its planning, drafting, review, first-reader references, and `scripts/init_project.py`. Only the four useful writing modes and a reduced scaffold are retained. |

The first implementation gate is the layout contract. The plausible route is a custom root occupant that renders its own tree/editor and seats the existing official `conversation` child slot in the right column. Whether a third-party root occupant can safely redeclare that child slot, establish the required session scope, and preserve the existing `ConversationRoot` registration is **UNKNOWN**.

If that spike fails, implementation must stop and request a supported upstream shell/root composition API. Falling back to `conversation.view`, cloning Chat, or importing package-internal components would violate the locked requirements.

# dsh-manuscript

The host plugin injects DSH connection, filesystem, workspace registry, LLM, sandbox policy, and default-model services. It registers one `/manuscript` RPC channel with a small typed endpoint map:

- `tree.list`: list one directory level for lazy expansion.
- `file.read`: return UTF-8 text plus the current filesystem version.
- `file.create`: create one text file in an already-existing directory with `createIfAbsent`; it never creates a directory.
- `file.write`: atomic `replaceIfVersion` save.
- `fim.complete`: stream a short continuation and return only the accepted text fragment.

Every filesystem request carries a workspace ID and relative path. The host resolves the workspace from the official registry, rejects absolute paths and traversal, checks containment against the canonical workspace root, and refuses symlink traversal. Binary and oversized files receive explicit errors.

The client has three areas:

- Left: a lazy, generic filesystem tree. It displays actual names and nesting without interpreting `正文`, `人物卡`, or other novel concepts.
- Center: a prose-oriented CodeMirror editor with no IDE-style gutter or minimap. It tracks dirty state, file version, IME composition, and save conflicts.
- Right: the existing official conversation occupant. Manuscript supplies no transcript, composer, approval card, model picker, or agent controls.

Ghost FIM behavior:

1. After a short idle debounce, capture bounded prefix and suffix windows around the caret.
2. Cancel the previous RPC whenever text, selection, or file changes.
3. Resolve provider/model through the installed `agentDefaultModel.currentSelection()` service.
4. Call `ctx.llm.stream` with a compact continuation instruction and prefix/suffix context.
5. Accept only `text-delta`, stop at a small character/token limit, and discard incomplete output after an error or abort.
6. Render the result as an inline ghost decoration.
7. `Tab` accepts, `Esc` dismisses, and ordinary typing invalidates it.
8. Acceptance changes only the local editor buffer; `Ctrl+S` performs the guarded file write.

No request is sent during active IME composition. FIM never writes automatically and never inserts Markdown fences or explanatory text.

# dsh-grill

`dsh-grill` contains two loader entries but remains one package.

`grill-tools` registers exactly one tool: `scaffold_novel`.

Its v1 contract is:

```text
Input:
  target?: relative directory, default "."

Output:
  root
  created[]
  skipped[]
```

The reduced scaffold creates only a small editable structure:

```text
正文/
大纲/
人物卡/
世界书/
项目总览.md
大纲/总纲.md
人物卡/人物索引.md
世界书/设定总汇.md
```

Behavior:

- Use the calling agent’s immutable session `cwd`.
- Reject calls without a live agent/session workspace.
- Reject absolute targets, traversal, and symlinked path components.
- Never overwrite existing files.
- Return created and skipped paths.
- Be idempotent and non-concurrency-safe.
- Observe `exec.signal`.
- Register a matching `tools/pre-execute` policy; DSH owns the resulting approval decision and UI.

Because `ctx.fs` has no directory-creation API, the directory portion must use carefully confined Node filesystem operations. Before any effect, it resolves the official session sandbox policy and canonical workspace boundary. File creation can then use guarded DSH filesystem writes. This mixed directory path is a specific verification target, not an excuse to add a private approval system.

`grill-workflow` registers one additive `systemPrompt.section`, not four competing complete prompts. The section contains a compact router and four branches:

- `planning`: clarify story mechanics, causality, canon boundaries, outline, chapter/scene goals, and handoff. Do not draft prose unless asked.
- `drafting`: write, continue, or rewrite prose only when requested. Preserve adopted prose and confirmed canon; missing facts remain unknown.
- `review`: evidence-ranked report by default. Identify structural, continuity, pacing, dialogue, viewpoint, and prose-flow problems without silently editing.
- `first-reader`: read in order from one explicit reader persona and report attention, expectation, confusion, and emotional response without turning into an editor.

The router instructs the official Chat agent to infer the requested mode. It may combine modes only when the user explicitly asks for a combined operation. Review remains report-only unless edit authority is explicit.

No Skill files are copied wholesale. AI-flavor diagnosis, AI-flavor vocabulary, external model calls, scene scanners, and model-comparison machinery are omitted entirely.

# Main-line user flow

1. The user installs `dsh-manuscript` through official DSH plugin management.
2. DSH opens its normal workspace/session. The manuscript frame binds to the official current workspace.
3. The left tree displays the real filesystem without novel grouping.
4. The user opens an existing text file or creates a file inside an existing directory.
5. Editing triggers cancellable ghost completion after a pause. `Tab` accepts it locally; `Ctrl+S` saves with a version guard.
6. If an external edit changed the file, save fails safely and preserves the local buffer for comparison or copying.
7. The right column remains official DSH Chat. “Agent 代写” is requested there and arrives as a normal official assistant response; it is never auto-applied.
8. Independently, the user may install `dsh-grill`.
9. Official Chat then gains the four-mode writing guidance and the single `scaffold_novel` tool.
10. When scaffolding is requested, the normal DSH tool and approval pipeline runs. The tool reports created/skipped paths.
11. Removing either plugin leaves the other functional; there is no shared RPC, import, configuration, or UI dependency.

# Implementation order

1. **Lock the compatibility snapshot.** Record installed DSH and nested package versions, peer ranges, public exports, inject names, and AutoEvo’s older compatibility baseline.

2. **Run the layout feasibility spike.** Build the smallest host/client package and prove that a custom root can render the existing official conversation in its right column with working streaming, composer, session switching, approvals, and disposal. This is a hard go/no-go gate.

3. **Prove dual-face packaging.** Produce host ESM and the DSH lazy-CJS `./client` artifact; validate `dsh.client.platform`, external module declarations, loader materialization, and HMR disposal.

4. **Implement manuscript host RPC.** Add endpoint schemas, workspace resolution, path confinement, lazy listing, text read/create/write, version conflicts, payload limits, and cancellation.

5. **Implement the manuscript client.** Add generic tree, tabs or single-document state, CodeMirror prose presentation, dirty state, keyboard behavior, loading/error/empty states, and accessible focus movement.

6. **Add ghost FIM.** Integrate default model resolution, bounded context construction, `llm.stream`, abort propagation, stale-response rejection, inline decoration, and acceptance rules.

7. **Implement `grill-tools`.** Add `scaffold_novel`, official pre-execute approval routing, canonical containment, idempotent directory/file creation, typed output, cancellation, and error rendering.

8. **Implement `grill-workflow`.** Write the compact static router and four positive mode prompts. Keep the source free of excluded Skill features.

9. **Integrate independently.** Test manuscript alone, grill alone, both together, and removal of either package.

10. **Package but do not publish.** Inspect tarball contents, patches, exports, licenses, dependency closure, and plugin-manager loading. Release or publication requires separate authorization.

# Verification

- Build, type-check, lint, and run unit tests for both packages.
- Inspect packed artifacts and confirm there are exactly two installable packages.
- Verify host entries are ESM and manuscript `./client` materializes through DSH’s lazy-CJS loader.
- Load both plugins against the currently installed DSH—not only AutoEvo’s older development dependencies.
- Verify the manuscript frame keeps official Chat functional: streaming, model selection, tool cards, approval prompts, session switching, replay, and cancellation.
- Verify `conversation.view` is not used for the manuscript layout.
- Exercise path attacks: absolute paths, `..`, alternate separators, unknown workspace IDs, symlinks, stale versions, binary files, and oversized payloads.
- Verify no GUI RPC endpoint performs `mkdir`, rename, move, or delete.
- Test IME composition, rapid typing, stale completion arrival, file switching, `Tab`, `Esc`, undo, dirty state, aborts, provider errors, and partial stream failures.
- Confirm FIM never edits disk until an explicit save.
- Verify `dsh-grill` exposes exactly `scaffold_novel`.
- Verify scaffold approval is displayed by official DSH where required and fails closed when unavailable or rejected.
- Run scaffold twice and confirm the second run only reports skipped paths.
- Snapshot the assembled grill prompt and confirm the four routes, report-only review rule, and absence of excluded features.
- Search package sources and artifacts for `scan_ai_flavor`, `scan_scene`, `llm-request`, external-model generation, and copied Skill/reference directories.
- Confirm GUI behavior is identical with grill absent and grill behavior works with manuscript absent.

# Risks / unknowns

- **UNKNOWN — official Chat placement:** the installed public API does not prove that a third-party root frame can redeclare and render the existing `conversation` occupant in another column. This is the principal blocker.
- **UNKNOWN — root/session composition:** the internal `AppFrame` establishes session scope, but it is not exported. The supported way for an external root occupant to provide equivalent scope has not been verified.
- **UNKNOWN — client build recipe:** the runtime format is inspected, but the exact supported third-party build configuration for producing the lazy-CJS wrapper is not published in the installed packages.
- **UNKNOWN — client RPC TypeScript augmentation:** runtime `ctx.connection.rpc.call` is verified; the clean public typing/import seam for third-party client code still needs a compile spike.
- **UNKNOWN — current-session model:** `agentDefaultModel.currentSelection()` is verified, but it may differ from the model selected in the visible Chat session. A public current-session model selector was not established.
- `llm.stream` is chat generation, not verified native FIM. Completion quality and provider cost may vary.
- The `purpose` vocabulary has no FIM value, so FIM calls cannot be tagged through that inspected field.
- DSH filesystem has no `mkdir`. `scaffold_novel` therefore needs a narrowly confined directory implementation whose interaction with sandbox modes must be tested carefully.
- Approval is not automatic for custom tools. The plugin must declare its `ask` decision through `tools/pre-execute`; DSH must remain the decision and presentation owner.
- There is no filesystem watch API in the inspected service. V1 needs manual refresh and refresh-after-save/scaffold behavior.
- Installed DSH currently mixes RC package versions. Every upgrade requires rerunning the contract and loader tests.
- The OpenDesign preview remains a visual reference, but its novel-grouped tree is intentionally superseded by the locked generic-tree requirement.

<oai-mem-citation>
<citation_entries>
MEMORY.md:721-730|note=[prior DSH reuse boundary and version-specific context]
</citation_entries>
<rollout_ids>
</rollout_ids>
</oai-mem-citation>