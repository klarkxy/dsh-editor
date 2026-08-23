# dsh-grill

Host-only DSH plugin. Adds one `scaffold_novel` tool and one additive system-prompt section with four writing modes: planning, drafting, review, first-reader.

`scaffold_novel` asks for approval through the official tool flow, uses the live Agent session workspace and sandbox policy, never overwrites existing paths, and reports `created` and `skipped` paths. The prompt router only guides the official Chat; it does not write manuscript files or require another plugin.

Does not ship a client, a second Chat, or the `grill-your-novel` Skill tree. Compatible with `@deepseek-ai/dsh` 0.1.1-rc.1 (nested first-party packages 0.1.1-rc.2). Independent of `dsh-manuscript`.
