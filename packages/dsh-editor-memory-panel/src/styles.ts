export const memoryPanelStyles = `
.shell .memory-change-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.shell .memory-panel .memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.shell .memory-panel .memory-row-main { display: flex; align-items: center; gap: 6px; width: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.shell .memory-panel .proposal-card { font-size: var(--text-xs); }
.shell .memory-panel .proposal-card pre { max-height: 120px; }
.shell .memory-panel .memory-change-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.shell .memory-panel .memory-reason { display: grid; gap: 4px; }
.shell .memory-panel .memory-reason ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.shell .memory-panel .memory-reason small { color: var(--meta); }
.shell .memory-panel .proposal-diff { display: grid; gap: 7px; }
.shell .memory-panel .proposal-card.memory-change { min-width: 0; }
.shell .memory-panel .proposal-card.expired { border-color: var(--danger); }
.shell .memory-panel .proposal-card.checking { color: var(--muted); }
`
