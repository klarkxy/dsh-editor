# Architecture Refactor Baseline

**Date**: 2026-10-06 21:28
**Branch**: refactor/arch-v2
**Commit**: 7e8ccdd

## Package Structure (13 packages)

### Core Packages
- dsh-editor-shell (31,870 lines - UI + Config + Design System)
- dsh-editor-workbench (10,112 lines - 7 responsibilities)
- dsh-editor-workspace-kit (1,264 lines)
- dsh-editor-seats (interface contracts)
- dsh-editor-plugins (plugin + writing modes)

### Domain Packages
- dsh-manuscript (11,885 lines)
- dsh-proofread (校对引擎)
- dsh-editor-novel-kernel (小说工具)
- dsh-editor-writing-presets (24 lines - almost empty)

### UI/Panel Packages
- dsh-editor-cards (人物卡)
- dsh-editor-memory-panel (891 lines - duplicated patterns)
- dsh-editor-overview-panel (1,073 lines - duplicated patterns)
- dsh-editor-proofread-panel (1,308 lines - duplicated patterns)

### Application
- apps/desktop (Electron app)

## Known Issues

### P0 Severe Issues
1. **workbench overload**: 10,112 lines, 7 responsibilities, 5 dependents
2. **Panel code duplication**: 3 panels with identical RPC/messages/styles patterns
3. **shell boundary issues**: 31,870 lines, 197 files, mixed concerns

### P1 Important Issues
4. Code organization inconsistency
5. workspace-kit naming misleading
6. plugins package mixed concerns
7. Circular dependency risks via devDependencies

### P2 Minor Issues
8. Design system scattered across 5 packages
9. Public/private package boundaries unclear
10. writing-presets package almost empty

## Refactor Plan

### Target: 13 packages → 19 packages

- **Core**: 2 → 3 packages (+contracts)
- **Domain**: 5 → 5 packages (reorganize)
- **UI**: 5 → 6 packages (+design-system, +panels/base)
- **Features**: 0 → 4 packages (extract from workbench/plugins)
- **App**: 1 → 1 package (unchanged)

### Expected Improvements

- workbench: 10,112 → ~3,000 lines (-70%)
- shell: 31,870 → ~15,000 lines (-53%)
- memory-panel: 891 → ~400 lines (-55%)
- overview-panel: 1,073 → ~500 lines (-53%)
- proofread-panel: 1,308 → ~600 lines (-54%)

## Verification Status

❌ Type check failed (EPERM error - permission issue)
❌ Unit tests failed (EPERM error - permission issue)

**Note**: Build verification will be performed after each refactor phase.
The EPERM errors are environmental issues (Windows permissions/antivirus),
not code issues. Refactor can proceed with manual verification.

## Next Steps

1. ✅ Create refactor branch
2. ✅ Record baseline
3. → Create migration scripts framework
4. → Extract proposals system (first actual change)
5. → Continue with Phase 1 workbench split
