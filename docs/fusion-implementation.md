# Fusion collaboration implementation

Fusion is a production plugin built on native DSH continuable sessions. It is preinstalled but disabled by default. This document records its implementation boundaries; current verification evidence belongs to the acceptance report, not to this design document.

## Accepted boundaries

- Fusion is an optional, independently switchable plugin, not a competing user-selectable writing preset.
- DSH owns Agents, persistent Sessions, inboxes, continuations, credentials, permissions and history. Fusion adds pair/task/candidate semantics only.
- Editor writing modes automatically participate when the plugin is enabled; no second per-session enable switch. Child sessions and auxiliary calls never recursively enable Fusion.
- The existing user session is the Lead. One persistent native continuable Sidekick is bound to each participating Lead, with at most one active delegated task.
- Editor: the Lead owns discussion, planning, setting maintenance and review; the Writer owns prose candidates. The Host owns author-confirmed file application. Lead review never substitutes for author acceptance.
- Generic DSH: delegation is task-specific; explicit takeover is possible. Do not classify arbitrary tools only by their names or permanently remove all Lead execution ability.
- Candidate delivery references the exact Writer-authored revision; the Lead must not regenerate the candidate to forward it to the UI.
- Preserve original read versions and validate them at application. Drafts and rejected branches are not automatically established story facts.
- Plugin disable and task cancellation invalidate late results and stop only owned work. Closing a view neither starts nor cancels inference.

## UI

Editor retains one partner sidebar and the central manuscript. Add a compact collaboration entry and one updating task card with on-demand details. Never insert streaming candidates into the manuscript. Model review and author adoption are distinct states.

Native Web retains the primary conversation and reuses native child-session navigation and deliverable previews. Show collaboration task status separately from native activation status. A modified workspace must not be labelled as merely awaiting adoption.

The primary composer continues to address the Lead. Task-level Stop covers the participating work, not just the visible Agent. Unknown cost stays unknown; do not fabricate completion percentages or cache savings.

## Validation

Required evidence: core lifecycle and stale-result tests, native host integration, role-scoped tools, exact candidate delivery, disable/cancel and cold restore, Editor and standalone Web UI, workspace build/typecheck/tests. Simulated-model integration is distinct from live-model quality evaluation.

## Implementation

- `packages/dsh-fusion/src/contracts.ts` defines pairs, tasks, exact candidates, reviews and single-file application intents. `host-contracts.ts` is the narrow optional Editor application port.
- `service.ts` serializes business transitions and records admission, review, explicit recovery, cancellation and author application. `validation.ts` validates durable control records, content hashes and references before reuse.
- `storage.ts` uses the existing versioned `storageDomain` service with one atomic state record. Corrupt or unsupported state fails closed rather than being replaced with an empty history.
- `native.ts`, `runtime.ts`, `tools.ts` and `index.ts` connect native continuations, actual Agent identity, scoped execution guards, shared model routing and Host RPC. Native sessions own transcripts, inboxes and tool permissions.
- `packages/dsh-editor-workbench/src/fusion-host.ts` supplies the optional writing domain. It reuses workspace identity, confinement, sandbox, write locks, original read versions and shared unsaved-draft protection.
- `client.tsx` supplies the Editor collaboration surface and native turn-tail card. Native child navigation stays with the host sidebar. Views only read state or submit explicit user actions.

The browser submits stored task/candidate identity, its hash and the preview version. It cannot replace the target or candidate text. Before a file mutation, Fusion persists an application intent with the expected source version and resulting full-file hash. After a crash, it inspects the file under the Host lock: a matching result confirms application; any other result remains a conflict and is never replayed automatically.

A writing candidate must be adopted or dismissed before another task replaces its current action card. Text-producing `edit`/`create` proposals, including outlines, use the Writer because ordinary project files have no reliable prose/outline classification. The Lead retains discussion, maintenance and structural operations.

A failed native notice leaves the exact report readable. Explicit recovery notifies the Lead to read it again without re-running the Writer. Initial admission recovery checks native durable session identity; failed queries never count as proof of absence. The task's own revision remains authoritative when late native replies arrive. Exactly-once native message delivery is not claimed.

Models are resolved only for a new pair and then pinned to its persistent child. Shared settings changes apply to new pairs. The default route is the current Host Chat role; Fantasy requires explicit selection.

## Verification entry points

`pnpm test:fusion` runs deterministic service/native boundary and client projection suites, then typechecks against the installed DSH declarations. These tests do not establish actual native integration by themselves.

`pnpm exec vitest run packages/dsh-editor-workbench/src/fusion-host.spec.ts` checks real temporary file operations, original target/basis versions, shared drafts, path confinement, cancellation and duplicate writes.

`pnpm test:e2e:fusion` builds and prepares the isolated runtime, then runs `e2e/fusion.mjs` and `e2e/fusion-standalone.mjs` with a local deterministic model. The fixture exercises actual native Agent tools and persistent sessions in Editor and standalone Web. It must never use the user's credentials or manuscripts. Build/package checks and deterministic integration remain distinct from a live-provider quality evaluation.

Default-off composition is covered by `scripts/plugin-manifest.spec.mjs`. A manifest entry can declare `defaultEnabled: false`; an explicit recipe feature or the user's saved plugin setting can enable it. It is not made a required Shell service merely by being preinstalled.
