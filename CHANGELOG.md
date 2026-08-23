# Changelog

## 0.1.0 - 2026-08-24

Initial delivery candidate containing exactly two independent DSH plugins.

### dsh-manuscript

- Added a collapsed manuscript drawer with a generic workspace tree and prose editor.
- Added caller-selected live-session validation, registered-workspace confinement, DSH sandbox enforcement, path and symlink rejection, size limits, and atomic create/save semantics.
- Added recoverable drafts, dirty/conflict/error states, navigation guards, stale-response rejection, word counts, clipboard handoff, and optional DSH-routed FIM.

### dsh-grill

- Added the idempotent `scaffold_novel` tool through the official DSH approval flow.
- Added independent planning, drafting, review, and first-reader prompt modes.
- Removed proposal storage, scanners, external Web tools, copied Skill assets, and all Manuscript coupling from the v1 boundary.

### Delivery

- Added isolated install/remove matrix coverage for each material plugin combination.
- Added exact tarball-content verification, SHA-256 generation, compatibility metadata, install/remove/rollback instructions, and a single delivery verification command.
