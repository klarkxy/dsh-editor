export const cardsPanelStyles = `
.shell .cards-panel { margin: 0 10px 8px; padding: 8px; border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring); display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.shell .cards-tabs { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.shell .cards-tabs button, .shell .cards-toolbar button, .shell .cards-chip, .shell .cards-ref-toggle, .shell .cards-detail-actions button, .shell .cards-relations button { padding: 5px 7px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); cursor: pointer; font-size: var(--text-xs); }
.shell .cards-panel button:disabled, .shell .cards-detail button:disabled { opacity: .45; cursor: default; }
.shell .cards-tabs button[aria-selected="true"], .shell .cards-chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-on); }
.shell .cards-toolbar { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.shell .cards-toolbar input, .shell .cards-toolbar select, .shell .cards-fields input, .shell .cards-fields select, .shell .cards-fields textarea { min-width: 0; width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg); font: 400 var(--text-sm)/1.3 var(--font-sans); }
.shell .cards-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.shell .cards-chip { background: var(--bg); color: var(--fg-2); box-shadow: var(--elev-ring); }
.shell .cards-groups { display: grid; gap: 8px; max-height: 280px; overflow: auto; }
.shell .cards-group h3 { margin: 0; font: 500 var(--text-xs)/1.3 var(--font-sans); color: var(--meta); letter-spacing: .06em; }
.shell .cards-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.shell .cards-item { display: grid; gap: 4px; padding: 6px; border-radius: var(--radius-sm); }
.shell .cards-item.selected { background: var(--accent-soft); }
.shell .cards-item-main { display: grid; gap: 3px; width: 100%; text-align: left; border: 0; background: transparent; color: var(--fg); cursor: pointer; }
.shell .cards-item-main strong { font: 500 var(--text-sm)/1.3 var(--font-sans); }
.shell .cards-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--meta); font-size: var(--text-xs); }
.shell .cards-badge { padding: 1px 6px; border-radius: 999px; background: var(--surface-warm); color: var(--fg-2); font-style: normal; }
.shell .cards-tags, .shell .cards-item-main small { color: var(--meta); font-size: var(--text-xs); overflow-wrap: anywhere; }
.shell .cards-refs { display: grid; gap: 4px; }
.shell .cards-ref-groups ol, .shell .cards-ref-groups ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.shell .cards-ref-groups button { width: 100%; text-align: left; padding: 4px 6px; border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--fg-2); cursor: pointer; font-size: var(--text-xs); }
.shell .cards-ref-groups button:hover:not([disabled]) { background: var(--accent-soft); color: var(--fg); }
.shell .cards-detail { min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--surface); box-shadow: var(--elev-raised); }
.shell .cards-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); padding: 16px 24px 12px; border-bottom: 1px solid var(--hairline); }
.shell .cards-detail-header-actions { display: flex; align-items: center; gap: 6px; }
.shell .cards-detail-header h2 { margin: 0; font: 500 20px/1.2 var(--font-serif); letter-spacing: -.02em; color: var(--fg); }
.shell .cards-detail-header p { margin: 6px 0 0; }
.shell .cards-detail-body { display: grid; gap: var(--space-4); padding: 16px 24px 32px; }
.shell .cards-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
.shell .cards-field { display: grid; gap: 4px; min-width: 0; font-size: var(--text-xs); color: var(--muted); }
.shell .cards-field-wide { grid-column: 1 / -1; }
.shell .cards-relations { display: grid; gap: 6px; }
.shell .cards-relation-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: 4px; align-items: center; }
.shell .cards-relation-link { background: transparent; color: var(--accent); }
.shell .cards-detail-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.shell .cards-detail-header-actions button:not(.icon-button) { padding: 5px 7px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); cursor: pointer; font-size: var(--text-xs); }
@media (max-width: 720px) {
  .shell .cards-fields, .shell .cards-relation-row { grid-template-columns: minmax(0, 1fr); }
}
.shell .file-dialog.prompt-dialog { width: min(520px, 100%); }
`
