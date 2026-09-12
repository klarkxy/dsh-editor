export const proofreadPanelStyles = `
.shell .proofread-panel, .dsh-ui .proofread-panel {
  margin: 0 10px 8px; padding: 8px; border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring);
  display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: var(--text-chrome, 13px);
}
.shell .proofread-panel-header, .dsh-ui .proofread-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.shell .proofread-panel-header h2, .dsh-ui .proofread-panel-header h2 { margin: 0; font: 500 var(--text-base, 14px)/1.3 var(--font-sans); color: var(--fg); }
.shell .proofread-panel-header p, .dsh-ui .proofread-panel-header p { margin: 4px 0 0; }
.shell .proofread-toolbar, .dsh-ui .proofread-toolbar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.shell .proofread-scopes, .dsh-ui .proofread-scopes { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.shell .proofread-panel button, .dsh-ui .proofread-panel button {
  min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent);
  cursor: pointer; font-size: var(--text-chrome, 13px);
}
.shell .proofread-panel button:disabled, .dsh-ui .proofread-panel button:disabled { opacity: .45; cursor: default; }
.shell .proofread-panel button[aria-pressed="true"], .shell .proofread-panel button.active,
.dsh-ui .proofread-panel button[aria-pressed="true"], .dsh-ui .proofread-panel button.active { background: var(--accent); color: var(--accent-on); }
.shell .proofread-kinds, .dsh-ui .proofread-kinds { display: flex; flex-wrap: wrap; gap: 4px; }
.shell .proofread-chip, .dsh-ui .proofread-chip { background: var(--bg) !important; color: var(--fg-2) !important; box-shadow: var(--elev-ring); }
.shell .proofread-chip[aria-pressed="true"], .dsh-ui .proofread-chip[aria-pressed="true"] { background: var(--accent-soft) !important; color: var(--accent) !important; }
.shell .proofread-summary, .dsh-ui .proofread-summary { display: flex; flex-wrap: wrap; gap: 6px; color: var(--meta); font-size: var(--text-chrome, 13px); }
.shell .proofread-batch, .dsh-ui .proofread-batch { align-self: start; min-height: var(--control-h, 34px); }
.shell .proofread-results, .dsh-ui .proofread-results { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow: auto; }
.shell .proofread-file, .dsh-ui .proofread-file { display: grid; gap: 4px; min-width: 0; }
.shell .proofread-file > strong, .dsh-ui .proofread-file > strong { font-size: var(--text-chrome, 13px); color: var(--fg-2); overflow-wrap: anywhere; }
.shell .proofread-file ul, .dsh-ui .proofread-file ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.shell .proofread-row, .dsh-ui .proofread-row { display: grid; gap: 3px; min-width: 0; }
.shell .proofread-hit, .dsh-ui .proofread-hit {
  width: 100%; display: grid; gap: 2px; text-align: left; min-height: 32px; padding: 6px 8px; border: 0; border-radius: var(--radius-xs);
  background: transparent !important; color: var(--fg-2) !important; cursor: pointer; font-size: var(--text-chrome, 13px);
}
.shell .proofread-hit:hover:not([disabled]), .dsh-ui .proofread-hit:hover:not([disabled]) { background: var(--accent-soft) !important; color: var(--fg) !important; }
.shell .proofread-head, .dsh-ui .proofread-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; min-width: 0; }
.shell .proofread-message, .dsh-ui .proofread-message { min-width: 0; overflow-wrap: anywhere; }
.shell .proofread-hit .proofread-kind, .dsh-ui .proofread-hit .proofread-kind { color: var(--meta); }
.shell .proofread-severity, .dsh-ui .proofread-severity { display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; vertical-align: middle; background: var(--muted); }
.shell .proofread-severity.error, .dsh-ui .proofread-severity.error { background: var(--danger); }
.shell .proofread-severity.warning, .dsh-ui .proofread-severity.warning { background: var(--accent); }
.shell .proofread-severity.info, .dsh-ui .proofread-severity.info { background: var(--muted); }
.shell .proofread-excerpt, .dsh-ui .proofread-excerpt { display: block; color: var(--meta); overflow-wrap: anywhere; }
.shell .proofread-excerpt mark, .dsh-ui .proofread-excerpt mark { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--fg); padding: 0 1px; border-radius: 2px; }
.shell .proofread-suggestion, .dsh-ui .proofread-suggestion { display: block; color: var(--accent); }
.shell .proofread-row-actions, .dsh-ui .proofread-row-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 2px; }
.shell .proofread-row-actions button, .dsh-ui .proofread-row-actions button { background: var(--bg); color: var(--fg-2); box-shadow: var(--elev-ring); }
.shell .proofread-habits, .dsh-ui .proofread-habits { display: grid; gap: 4px; min-width: 0; }
.shell .proofread-habits h3, .dsh-ui .proofread-habits h3 { margin: 4px 0 0; font: 500 var(--text-chrome, 13px)/1.3 var(--font-sans); color: var(--fg-2); }
.shell .proofread-habits table, .dsh-ui .proofread-habits table { width: 100%; border-collapse: collapse; font-size: var(--text-chrome, 13px); }
.shell .proofread-habits th, .shell .proofread-habits td, .dsh-ui .proofread-habits th, .dsh-ui .proofread-habits td { padding: 3px 4px; text-align: left; color: var(--fg-2); }
.shell .proofread-habits th, .dsh-ui .proofread-habits th { color: var(--meta); font-weight: 500; }
.shell .proofread-habits td:nth-child(2), .shell .proofread-habits td:nth-child(3),
.dsh-ui .proofread-habits td:nth-child(2), .dsh-ui .proofread-habits td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
.shell .proofread-habits button, .dsh-ui .proofread-habits button { width: 100%; text-align: left; background: transparent; color: var(--fg-2); padding: 2px 4px; }
.shell .proofread-fix, .dsh-ui .proofread-fix { min-width: 0; }
.shell .proofread-panel .proposal-card, .dsh-ui .proofread-panel .proposal-card { font-size: var(--text-chrome, 13px); }
.shell .proofread-panel .proposal-card header, .shell .proofread-panel .proposal-card footer,
.dsh-ui .proofread-panel .proposal-card header, .dsh-ui .proofread-panel .proposal-card footer { flex-wrap: wrap; }
.shell .proofread-panel .proposal-card pre, .dsh-ui .proofread-panel .proposal-card pre { max-height: 120px; }
@media (prefers-reduced-motion: reduce) {
  .shell .proofread-panel, .shell .proofread-panel *, .dsh-ui .proofread-panel, .dsh-ui .proofread-panel * {
    animation: none !important; transition: none !important;
  }
}
`
