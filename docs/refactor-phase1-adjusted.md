# Phase 1 Strategy Adjustment

## Original Plan vs Reality

### Original Plan (Too Aggressive)
- Extract proposals → new package `packages/features/proposals`
- Extract tools → new package `packages/features/tools`
- Extract integrations → separate packages
- **Problem**: Massive dependency web, high risk

### Adjusted Plan (Pragmatic)
**Phase 1: Internal Reorganization (Low Risk)**

Instead of extracting to new packages immediately, we first reorganize workbench internally by grouping related files into subdirectories. This:
- ✅ Clarifies responsibility boundaries
- ✅ Makes dependencies visible
- ✅ Enables incremental migration
- ✅ Low risk (no cross-package changes)
- ✅ Can be validated with simple typecheck

### New Directory Structure

```
packages/dsh-editor-workbench/src/
├── proposals/              # Proposal system (8 files)
│   ├── writing-propose-tool.ts
│   ├── planning-proposals.ts
│   ├── proposal-ops.ts
│   ├── chapter-meta.ts
│   └── *.spec.ts
├── tools/                  # Tool registration (4 files)
│   ├── tools.ts
│   ├── observe-tool.ts
│   ├── novel-tools.ts
│   └── workbench-tools.ts
├── integrations/           # External integrations (6 files)
│   ├── proofread.ts
│   ├── proofread-defaults.ts
│   ├── overview.ts
│   └── *.spec.ts
├── memory/                 # Author memory system (6 files)
│   ├── author-memory.ts
│   ├── author-preferences.ts
│   ├── memory.ts
│   ├── memory-tool.ts
│   ├── memory-access.ts
│   └── memory-contracts.ts
├── lifecycle/              # Project lifecycle (8 files)
│   ├── lifecycle.ts
│   ├── project.ts
│   ├── import.ts
│   ├── snapshot.ts
│   ├── writing-log.ts
│   └── *.spec.ts
├── context/                # Project context (2 files)
│   ├── context.ts
│   ├── project-context-hooks.ts
├── io/                     # File operations (6 files)
│   ├── binary.ts
│   ├── metadata-io.ts
│   ├── frontmatter.ts
│   └── *.spec.ts
├── contracts/              # RPC contracts (existing)
│   └── *.ts
├── kit/                    # Shared utilities (existing)
│   └── *.ts
├── rpc/                    # RPC handlers (existing)
│   └── *.ts
├── index.ts                # Main entry
├── contracts.ts            # Re-exports
└── host-guard.ts           # Security
```

### Migration Steps

1. **Create subdirectories** (0 risk)
2. **Move files** using git mv (preserves history)
3. **Update imports** (local paths only, no cross-package)
4. **Run typecheck** (validate)
5. **Commit** with clear message

### Benefits

- **Immediate**: Code navigation improves dramatically
- **Documentation**: Structure self-documents responsibilities
- **Preparation**: Clear extraction boundaries for Phase 2
- **Reversible**: Can be undone with git revert if needed

### Phase 2 (Later)

After internal organization proves stable:
- Extract `proposals/` → `packages/domain/proposals`
- Extract `tools/` → `packages/domain/tools`
- Add proper package boundaries

## Decision

**Proceed with internal reorganization first.**

This is the pragmatic, low-risk path that delivers immediate value while preparing for future extraction.
