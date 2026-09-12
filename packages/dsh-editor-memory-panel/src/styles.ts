export const memoryPanelStyles = `
.shell .memory-panel, .dsh-ui .memory-panel {
  margin: 0 10px 8px; padding: 8px; max-height: 420px; overflow: auto; display: flex; flex-direction: column; gap: 8px;
  border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring); font-size: var(--text-chrome, 13px);
}
.shell .memory-panel-header, .dsh-ui .memory-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.shell .memory-panel-header h2, .dsh-ui .memory-panel-header h2 { margin: 0; font: 500 var(--text-base, 14px)/1.3 var(--font-sans); color: var(--fg); }
.shell .memory-panel-header p, .dsh-ui .memory-panel-header p { margin: 4px 0 0; color: var(--meta); }
.shell .memory-filters, .dsh-ui .memory-filters { display: flex; flex-wrap: wrap; gap: 4px; }
.shell .memory-filters button, .dsh-ui .memory-filters button,
.shell .memory-panel button, .dsh-ui .memory-panel button {
  min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent);
  cursor: pointer; font-size: var(--text-chrome, 13px);
}
.shell .memory-filters button[aria-pressed="true"], .dsh-ui .memory-filters button[aria-pressed="true"] { background: var(--accent); color: var(--accent-on); }
.shell .memory-panel button:disabled, .dsh-ui .memory-panel button:disabled { opacity: .45; cursor: default; }
.shell .memory-panel .icon-button, .dsh-ui .memory-panel .icon-button { min-width: 32px; }
.shell .memory-change-meta, .dsh-ui .memory-change-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.shell .memory-panel .memory-list, .dsh-ui .memory-panel .memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.shell .memory-panel .memory-row-main, .dsh-ui .memory-panel .memory-row-main {
  display: flex; align-items: center; gap: 6px; width: 100%; min-height: 36px; padding: 4px 6px; border: 0; border-radius: var(--radius-sm);
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.shell .memory-panel .memory-row-main:hover, .dsh-ui .memory-panel .memory-row-main:hover { background: var(--accent-soft); }
.shell .memory-panel .memory-label, .dsh-ui .memory-panel .memory-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.shell .memory-panel .memory-meta, .dsh-ui .memory-panel .memory-meta { flex: none; color: var(--muted); font-size: var(--text-chrome, 13px); }
.shell .memory-panel .proposal-card, .dsh-ui .memory-panel .proposal-card { font-size: var(--text-chrome, 13px); }
.shell .memory-panel .proposal-card pre, .dsh-ui .memory-panel .proposal-card pre { max-height: 120px; }
.shell .memory-panel .memory-reason, .dsh-ui .memory-panel .memory-reason { display: grid; gap: 4px; }
.shell .memory-panel .memory-reason ul, .dsh-ui .memory-panel .memory-reason ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.shell .memory-panel .memory-reason small, .dsh-ui .memory-panel .memory-reason small { color: var(--meta); }
.shell .memory-panel .proposal-diff, .dsh-ui .memory-panel .proposal-diff { display: grid; gap: 7px; }
.shell .memory-panel .proposal-card.memory-change, .dsh-ui .memory-panel .proposal-card.memory-change { min-width: 0; }
.shell .memory-panel .proposal-card.expired, .dsh-ui .memory-panel .proposal-card.expired { border-color: var(--danger); }
.shell .memory-panel .proposal-card.checking, .dsh-ui .memory-panel .proposal-card.checking { color: var(--muted); }
.shell .memory-status, .dsh-ui .memory-status { margin: 0; }
@media (prefers-reduced-motion: reduce) {
  .shell .memory-panel, .shell .memory-panel *, .dsh-ui .memory-panel, .dsh-ui .memory-panel * {
    animation: none !important; transition: none !important;
  }
}
`
