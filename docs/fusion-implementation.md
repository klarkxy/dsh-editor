# Fusion collaboration implementation

Status: unfinished, inert foundation. These modules are not registered as a plugin and do not run in Editor or native Web. This document preserves the accepted full-feature boundaries; the current merge does not claim those outcomes.

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

## Foundation delivered in this merge

- `packages/dsh-fusion/src/contracts.ts` defines pair, task, candidate and review records.
- `validation.ts` bounds external and stored inputs, verifies candidate hashes and review references before a persisted record can resume.
- `service.ts` models reservation, reporting, revision, review, cancellation and teardown. It has no installed storage adapter, RPC endpoint, or Host write path.
- `native.ts` is an adapter against the pinned DSH 0.1.7-alpha.1 Agent and continuable-subagent types. It is not wired into a live provider.
- `presentation.ts` supplies task labels and exact child-navigation addresses; no UI mounts it.

Run `node scripts/check-fusion-foundation.mjs` after a frozen workspace install. The gate runs all `*.node.mjs` suites with deterministic fake-native boundaries and typechecks the adapter against installed DSH declarations. The root `pnpm test:fusion` command runs this gate, and the normal Check workflow runs it after workspace validation. These checks establish source-level behavior only; they do not establish live native-session, Editor, or standalone Web acceptance.

A failed or interrupted native notice can have an uncertain delivery outcome. A stored candidate remains readable, but a duplicate report without a confirmed notification receipt raises `NOTIFICATION_UNCERTAIN`; it is not silently acknowledged or blindly resent. Exactly-once native delivery and a user-facing recovery path are not claimed.

## Deferred to feature completion

Plugin registration and enable/disable wiring, a durable store with migration/recovery, RPC and role-scoped tools, safe Host application guards with original-read version checks, Editor and native Web UI, and live native/model acceptance remain required. No file adoption or author acceptance path exists in this foundation. The accepted boundaries above remain the target for the full feature.
