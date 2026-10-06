# Refactor Migration Scripts

This directory contains automation scripts for the architecture refactor.

## Scripts

### 1. `move-package.mjs`
Move a package to a new location and update all import paths.

```bash
node scripts/refactor/move-package.mjs <source> <target>

# Example:
node scripts/refactor/move-package.mjs \
  packages/dsh-manuscript \
  packages/domain/manuscript
```

### 2. `extract-module.mjs`
Extract modules from one package into a new package.

```bash
node scripts/refactor/extract-module.mjs \
  <source-package> \
  <module-files> \
  <target-package>

# Example:
node scripts/refactor/extract-module.mjs \
  packages/dsh-editor-workbench \
  "src/proposal-ops.ts,src/contracts.ts" \
  packages/features/proposals
```

### 3. `validate-deps.mjs`
Validate dependency relationships after refactor.

```bash
node scripts/refactor/validate-deps.mjs
```

**Checks:**
- ✓ No circular dependencies
- ✓ Correct dependency direction (App → Features → UI/Domain → Core)
- ✓ No domain dependencies in UI layer
- ✓ No domain dependencies in Core layer

**Current Issues Found:**
- ❌ `dsh-editor-workspace-kit` (Core) depends on `dsh-manuscript` (Domain)
  - This violates the layer separation rule
  - Will be fixed in Phase 1 by extracting frontmatter parsing to domain layer

## Layer Rules

```
┌─────────────────┐
│   App (L5)      │  apps/desktop
├─────────────────┤
│  Features (L4)  │  Extracted from workbench
├─────────────────┤
│  UI (L3)        │  shell, panels, design-system
│  Domain (L3)    │  manuscript, workbench, novel
├─────────────────┤
│  Core (L2)      │  contracts, seats, workspace-kit
└─────────────────┘
```

**Rules:**
- Higher layers can depend on lower layers
- Same-level dependencies are allowed (UI ↔ Domain)
- Lower layers CANNOT depend on higher layers
- Core MUST NOT depend on Domain, UI, or Features
- Domain MUST NOT depend on UI or Features
- UI should prefer Core contracts over Domain implementations

## Usage During Refactor

Each phase should:

1. Run `validate-deps.mjs` before changes (baseline)
2. Make the refactor changes
3. Run `validate-deps.mjs` after changes (verify improvement)
4. Run `pnpm typecheck` (ensure type safety)
5. Commit with detailed message

## See Also

- [Refactor Proposal](../../docs/refactoring-proposal-focused.md)
- [Architecture Comparison](../../docs/architecture-comparison.md)
- [Refactor Checklist](../../docs/refactoring-checklist.md)
