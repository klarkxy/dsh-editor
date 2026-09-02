// Thin re-export from the unified editor-core. The shell previously owned
// its own copy of these helpers; the canonical implementation now lives in
// `dsh-manuscript/client/editor-core`. Keep this shim so the in-tree
// `editor-state.spec.ts` and downstream callers continue to resolve.
export * from 'dsh-manuscript/client/editor-core'
