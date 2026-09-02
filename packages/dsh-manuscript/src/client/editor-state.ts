// Re-export from the unified editor-core. Kept as a shim so the in-tree
// `editor-state.spec.ts` (and any in-tree imports) keep their `./editor-state.ts`
// import path without change. The canonical home is `editor-core/editor-state.ts`.
export * from './editor-core/editor-state.ts'
