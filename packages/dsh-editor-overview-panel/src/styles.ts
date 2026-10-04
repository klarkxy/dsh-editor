import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

export const overviewPanelStyles = `
@keyframes overview-panel-in { from { opacity: 0; transform: translateY(8px); } }
.shell.layout-shell:has(.overview-panel[data-dsh-center-overlay]) [data-dsh-center-overlay]:not(.overview-panel) { display: none; }
.radix-themes .overview-panel {
${surfaceTokenAliases}
  min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column;
  border: 0; border-radius: var(--s-radius-panel); background: var(--s-raised); box-shadow: var(--s-elevate);
  font-family: var(--s-font); font-size: var(--font-size-2); color: var(--s-text);
  animation: overview-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .overview-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-3); border-bottom: 0.5px solid var(--s-line);
}
.radix-themes .overview-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--s-font); color: var(--s-text); }
.radix-themes .overview-header p { margin: var(--space-2) 0 0; color: var(--s-muted); }
.radix-themes .overview-body { display: grid; gap: var(--space-5); padding: var(--space-4) var(--space-5) var(--space-6); }
.radix-themes .overview-totals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); }
/* Stat tiles are plain text blocks, not filled cards: the container must not
   compete with the numbers it presents. */
.radix-themes .overview-totals > article {
  display: grid; gap: var(--space-2); padding: var(--space-2) 0; border: 0;
  border-radius: 0; background: transparent; box-shadow: none;
}
.radix-themes .overview-chapters, .radix-themes .overview-chart { min-width: 0; }
.radix-themes .overview-totals span { font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--s-font); color: var(--s-faint); }
.radix-themes .overview-totals strong { font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--s-font); color: var(--s-text); font-variant-numeric: tabular-nums; }
.radix-themes .overview-body h3 { margin: 0 0 var(--space-2); font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--s-font); color: var(--s-muted); }
.radix-themes input.overview-filter {
  width: 100%; min-height: var(--s-control); margin: 0 0 var(--space-2); padding: 0 var(--space-3); box-sizing: border-box;
  border: 0; border-radius: var(--s-radius-md); box-shadow: var(--s-elevate-soft); background: var(--s-bg); color: var(--s-text);
  font: 400 var(--font-size-2)/var(--line-height-2) var(--s-font);
}
.radix-themes .overview-filter.ui-input { width: 100%; margin: 0 0 var(--space-2); }
.radix-themes .overview-chapter-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.radix-themes .overview-chapter {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto; align-items: center; gap: var(--space-2); padding: var(--space-2); border-radius: var(--s-radius-md);
}
.radix-themes .overview-chapter:hover { background: var(--s-hover); }
.radix-themes .overview-chapter.empty { border: 1px solid var(--s-danger); }
.radix-themes .overview-chapter-title {
  justify-content: flex-start; text-align: left; min-height: var(--s-control-sm); color: var(--s-text);
  font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--s-font); border: 0; background: transparent; cursor: pointer;
}
.radix-themes .overview-chapter-title:hover { color: var(--s-accent); }
.radix-themes .overview-chapter-chars, .radix-themes .overview-chapter-time {
  color: var(--s-faint); font-size: var(--font-size-2); font-variant-numeric: tabular-nums;
}
.radix-themes .overview-chapter-meta { display: inline-flex; gap: var(--space-1); min-height: 16px; }
.radix-themes .overview-meta-pill {
  display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 var(--space-2);
  border-radius: 999px; corner-shape: round; background: var(--s-sunken); color: var(--s-muted); font-size: var(--font-size-1); font-weight: var(--font-weight-medium);
}
.radix-themes .overview-empty-flag {
  padding: 1px var(--space-2); border-radius: 999px; corner-shape: round; background: var(--s-bg);
  border: 1px solid var(--s-danger); color: var(--s-danger); font-size: var(--font-size-1); font-weight: var(--font-weight-medium);
}
.radix-themes .overview-char-bars {
  margin: 0; padding: var(--space-3); list-style: none; display: grid; gap: var(--space-2);
  border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-lg); background: var(--s-bg); box-shadow: none;
}
.radix-themes .overview-char-col { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(60px, 1fr) auto; gap: var(--space-2); align-items: center; }
.radix-themes .overview-char-label {
  min-width: 0; min-height: var(--s-control-sm); padding: 0; justify-content: flex-start; text-align: left; white-space: normal; overflow-wrap: anywhere;
  color: var(--s-muted); font-size: var(--font-size-2); border: 0; background: transparent; cursor: pointer;
}
.radix-themes .overview-char-label:hover { color: var(--s-accent); }
.radix-themes .overview-char-meter { display: block; height: var(--space-2); border-radius: var(--s-radius-xs); background: var(--s-sunken); overflow: hidden; }
.radix-themes .overview-char-meter i { display: block; height: 100%; background: var(--s-accent); }
.radix-themes .overview-char-col.empty .overview-char-meter i { background: var(--s-danger); }
.radix-themes .overview-char-value { color: var(--s-faint); font-size: var(--font-size-1); font-variant-numeric: tabular-nums; white-space: nowrap; }
.radix-themes .overview-chart h4 { margin: var(--space-3) 0 var(--space-1); font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--s-font); color: var(--s-text); }
.radix-themes .overview-chart-summary { margin: 0 0 var(--space-2); color: var(--s-muted); font-variant-numeric: tabular-nums; }
/* Empty states stay quieter than real data: muted flat text, no card chrome. */
.radix-themes .overview-chart-empty { margin: 0; padding: var(--space-2) 0; border: 0; border-radius: 0; background: transparent; color: var(--s-muted); }
.radix-themes .overview-curve {
  display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); align-items: end; gap: var(--space-1);
  min-height: 96px; padding: var(--space-3); border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-lg); background: var(--s-bg); box-shadow: none; overflow: hidden;
}
.radix-themes .overview-curve.daily { grid-template-columns: repeat(30, minmax(0, 1fr)); gap: 2px; }
.radix-themes .overview-curve-col { min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: var(--space-1); }
.radix-themes .overview-curve-col i {
  display: block; width: 70%; max-width: 28px; min-height: 0; border-radius: var(--s-radius-xs) var(--s-radius-xs) 1px 1px; background: var(--s-accent);
}
.radix-themes .overview-curve-col.today i { background: var(--s-success); }
.radix-themes .overview-curve-col.negative i { background: var(--s-danger); }
.radix-themes .overview-curve-col small { color: var(--s-faint); font-size: var(--font-size-1); font-variant-numeric: tabular-nums; white-space: nowrap; }
.radix-themes .overview-recent ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.radix-themes .overview-recent li { display: grid; gap: 2px; }
.radix-themes .overview-recent button { justify-content: flex-start; padding-inline: 0; text-align: left; min-height: var(--s-control-sm); color: var(--s-text); font-weight: var(--font-weight-medium); border: 0; background: transparent; cursor: pointer; font-size: var(--font-size-2); box-shadow: none; }
.radix-themes .overview-recent button:hover { color: var(--s-accent); }
.radix-themes .overview-recent small { color: var(--s-faint); }
.radix-themes .overview-panel button:not([class^="rt-"]):not([class*=" rt-"]) { font-size: var(--font-size-2); }
.radix-themes .overview-panel .icon-button { min-height: var(--s-control-sm); min-width: var(--s-control-sm); }
.radix-themes .overview-panel .warning {
  margin: 0; color: var(--s-danger); font-weight: var(--font-weight-medium);
  border-inline-start: 2px solid var(--s-danger); padding-inline-start: var(--space-2);
}
.radix-themes .overview-panel .muted { color: var(--s-muted); }
@keyframes overview-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
.radix-themes .overview-loading { display: grid; gap: var(--space-5); padding: var(--space-4) var(--space-5) var(--space-6); }
.radix-themes .overview-loading-cards { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); }
.radix-themes .overview-loading-cards i { position: relative; display: block; height: 56px; border: 0; border-radius: var(--s-radius-lg); background: var(--s-sunken); box-shadow: none; overflow: hidden; }
.radix-themes .overview-loading-cards i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--s-hover), transparent); animation: overview-activity-sheen 1.5s linear infinite; }
.overview-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .overview-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .overview-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .overview-panel textarea:focus-visible, .overview-panel a:focus-visible, .overview-panel [tabindex]:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { outline: 2px solid var(--s-accent); outline-offset: 2px; }
@media (max-width: 720px) {
  .radix-themes .overview-totals, .radix-themes .overview-chapter { grid-template-columns: minmax(0, 1fr); }
  .radix-themes .overview-char-col { grid-template-columns: minmax(0, 1fr) auto; }
  .radix-themes .overview-char-meter { grid-column: 1 / -1; grid-row: 2; }
}
@media (prefers-reduced-motion: reduce) {
  .radix-themes .overview-panel, .radix-themes .overview-panel *,
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after {
    animation: none !important; transition: none !important; transform: none !important;
  }
}
`
