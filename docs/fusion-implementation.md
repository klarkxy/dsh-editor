# Fusion collaboration implementation

Status: implementation in progress on the PR branch. This document is not evidence that the feature is implemented or validated.

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
