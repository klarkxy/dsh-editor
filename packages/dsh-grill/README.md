# dsh-grill

Host-only DSH plugin. Adds `scaffold_novel`, `compile_context`, `scan_scene`, `propose_patch`, `write_chapter`, character/worldbook proposal tools, and one additive system-prompt section with four writing modes: planning, drafting, review, first-reader.

Proposal tools write `.dsh-editor/proposals.json`. They do not change the manuscript. The author confirms in the manuscript editor. `compile_context` and `scan_scene` are read-only.

Does not ship a client, a second Chat, or the `grill-your-novel` Skill tree. Compatible with `@deepseek-ai/dsh` 0.1.1-rc.1 (nested first-party packages 0.1.1-rc.2). Independent of `dsh-manuscript`.
