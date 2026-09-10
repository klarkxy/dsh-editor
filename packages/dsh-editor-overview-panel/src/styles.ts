export const overviewPanelStyles = `
/* 概览打开时优先于其他中栏 overlay（沿用旧 Shell 的 overview-open 行为）。 */
.shell.layout-shell:has(.overview-panel[data-dsh-center-overlay]) [data-dsh-center-overlay]:not(.overview-panel) { display: none; }
.shell .overview-panel { min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--surface); box-shadow: var(--elev-raised); }
.shell .overview-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); padding: 16px 24px 12px; border-bottom: 1px solid var(--hairline); }
.shell .overview-header h2 { margin: 0; font: 500 20px/1.2 var(--font-serif); letter-spacing: -.02em; color: var(--fg); }
.shell .overview-header p { margin: 6px 0 0; }
.shell .overview-body { display: grid; gap: var(--space-5); padding: 16px 24px 32px; }
.shell .overview-totals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.6fr); gap: var(--space-3); }
.shell .overview-totals > article { display: grid; gap: 6px; padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .overview-status-card { min-width: 0; }
.shell .overview-chapters, .shell .overview-chart { min-width: 0; }
.shell .overview-totals span { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--meta); letter-spacing: .04em; }
.shell .overview-totals strong { font: 600 var(--text-md)/1.2 var(--font-sans); color: var(--fg); font-variant-numeric: tabular-nums; }
.shell .overview-status-bars { display: grid; gap: 6px; }
.shell .overview-status-bar { display: grid; gap: 3px; }
.shell .overview-status-bar small { color: var(--fg-2); font-size: var(--text-xs); }
.shell .overview-status-bar i { display: block; height: 6px; border-radius: 999px; background: var(--surface-warm); }
.shell .overview-status-bar.draft i { background: var(--muted); }
.shell .overview-status-bar.revising i { background: var(--accent); }
.shell .overview-status-bar.final i { background: var(--confirm); }
.shell .overview-body h3 { margin: 0 0 var(--space-2); font: 500 var(--text-sm)/1.4 var(--font-sans); letter-spacing: .08em; color: var(--fg-2); }
.shell .overview-chapter-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.shell .overview-chapter { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto auto; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius-sm); }
.shell .overview-chapter:hover { background: var(--bg); }
.shell .overview-chapter.empty { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 22%, transparent); }
.shell .overview-chapter-title { text-align: left; color: var(--fg); font: 500 var(--text-sm)/1.4 var(--font-sans); }
.shell .overview-chapter-title:hover { color: var(--accent); }
.shell .overview-chapter-chars, .shell .overview-chapter-time { color: var(--meta); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.shell .overview-chapter-meta { display: inline-flex; gap: 4px; min-height: 16px; }
.shell .overview-meta-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 6px; border-radius: 999px; box-shadow: var(--elev-ring); background: var(--surface-warm); color: var(--fg-2); font-size: 10px; font-weight: 500; }
.shell .overview-empty-flag { padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); font-size: 10px; }
.shell .overview-status-select { padding: 4px 8px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); font-size: var(--text-xs); }
.shell .overview-status-select:hover, .shell .overview-status-select:focus-visible { color: var(--fg); border-color: var(--hairline-strong); }
.shell .overview-char-bars, .shell .overview-curve { display: flex; align-items: flex-end; gap: 6px; min-height: 96px; padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); overflow-x: auto; }
.shell .overview-curve.weekly { min-height: 96px; }
.shell .overview-char-col, .shell .overview-curve-col { flex: 1 1 18px; min-width: 18px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; }
.shell .overview-char-col i, .shell .overview-curve-col i { display: block; width: 70%; max-width: 28px; min-height: 0; border-radius: 3px 3px 1px 1px; background: var(--accent); }
.shell .overview-char-col.empty i { background: color-mix(in srgb, var(--danger) 45%, var(--surface-warm)); }
.shell .overview-curve-col.today i { background: var(--confirm); }
.shell .overview-curve-col.negative i { background: var(--danger); }
.shell .overview-char-value, .shell .overview-curve-col small { color: var(--meta); font-size: 10px; font-variant-numeric: tabular-nums; }
.shell .overview-char-label { max-width: 4.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-size: 10px; }
.shell .overview-recent ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.shell .overview-recent li { display: grid; gap: 2px; }
.shell .overview-recent button { text-align: left; color: var(--fg); font-weight: 500; }
.shell .overview-recent button:hover { color: var(--accent); }
.shell .overview-recent small { color: var(--meta); }
@media (max-width: 720px) {
  .shell .overview-totals, .shell .overview-chapter { grid-template-columns: minmax(0, 1fr); }
}
`
