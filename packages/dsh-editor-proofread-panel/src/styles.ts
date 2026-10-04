import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

export const proofreadPanelStyles = `
@keyframes proofread-panel-in { from { opacity: 0; transform: translateY(8px); } }
.radix-themes .proofread-panel {
${surfaceTokenAliases}
  margin: 0 var(--space-2) var(--space-2); padding: var(--space-3); border: 0; border-radius: var(--s-radius-panel);
  background: var(--s-raised); box-shadow: var(--s-elevate);
  display: flex; flex-direction: column; gap: var(--space-2); min-width: 0;
  font-family: var(--s-font); font-size: var(--font-size-2); color: var(--s-text);
  animation: proofread-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .proofread-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.radix-themes .proofread-panel-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--s-font); color: var(--s-text); }
.radix-themes .proofread-panel-header p { margin: var(--space-1) 0 0; color: var(--s-muted); }
.radix-themes .proofread-toolbar { display: grid; gap: var(--space-2); min-width: 0; }
.radix-themes .proofread-scopes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); min-width: 0; padding: 4px; border-radius: var(--s-radius-lg); background: var(--s-sunken); }
.radix-themes .proofread-scopes button, .radix-themes .proofread-toolbar > button { width: 100%; }
.radix-themes .proofread-panel button:not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: var(--s-control-sm); padding: 0 var(--space-2); border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-md);
  background: var(--s-bg); color: var(--s-text); cursor: pointer; font-size: var(--font-size-2); box-shadow: none;
}
.radix-themes .proofread-panel .proofread-scopes button:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .proofread-panel .proofread-scopes .rt-BaseButton { border: 0; background: transparent; color: var(--s-muted); }
.radix-themes .proofread-panel button:disabled { opacity: .45; cursor: default; }
.radix-themes .proofread-panel button:not([class^="rt-"]):not([class*=" rt-"])[aria-pressed="true"],
.radix-themes .proofread-panel .rt-BaseButton[aria-pressed="true"],
.radix-themes .proofread-panel button.active:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .proofread-panel .rt-BaseButton.active {
  background: var(--s-selected); color: var(--s-text); border-color: transparent;
}
.radix-themes .proofread-panel .proofread-scopes button:not([class^="rt-"]):not([class*=" rt-"])[aria-pressed="true"],
.radix-themes .proofread-panel .proofread-scopes .rt-BaseButton[aria-pressed="true"],
.radix-themes .proofread-panel .proofread-scopes button.active:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .proofread-panel .proofread-scopes .rt-BaseButton.active {
  background: var(--s-raised); color: var(--s-text);
}
.radix-themes .proofread-kinds { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
.radix-themes .proofread-filter-label { flex: 0 0 100%; color: var(--s-muted); font-weight: var(--font-weight-medium); }
.radix-themes .proofread-panel button.proofread-chip:not([class^="rt-"]):not([class*=" rt-"]) { background: var(--s-sunken); color: var(--s-muted); border-color: transparent; }
.radix-themes .proofread-panel button.proofread-chip:not([class^="rt-"]):not([class*=" rt-"])[aria-pressed="true"],
.radix-themes .proofread-panel .rt-BaseButton.proofread-chip[aria-pressed="true"] { background: var(--s-selected); color: var(--s-text); }
.radix-themes .proofread-summary { display: flex; flex-wrap: wrap; gap: var(--space-2); color: var(--s-faint); font-size: var(--font-size-2); }
.radix-themes .proofread-panel button.proofread-batch:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .proofread-panel .rt-BaseButton.proofread-batch {
  align-self: start; min-height: var(--s-control); border: 0; background: var(--s-brand); color: var(--s-on-brand);
}
.radix-themes .proofread-panel button.proofread-batch:not([class^="rt-"]):not([class*=" rt-"]):hover:not(:disabled),
.radix-themes .proofread-panel .rt-BaseButton.proofread-batch:hover:not(:disabled) { background: var(--s-brand-hover); color: var(--s-on-brand); }
.radix-themes .proofread-results { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); max-height: min(60vh, 640px); overflow: auto; }
.radix-themes .proofread-file { display: grid; gap: var(--space-1); min-width: 0; }
.radix-themes .proofread-file > strong { font-size: var(--font-size-2); color: var(--s-text); overflow-wrap: anywhere; }
.radix-themes .proofread-file-title { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-1); padding: var(--space-1) 0; border-bottom: 0.5px solid var(--s-line); }
.radix-themes .proofread-file-title span { color: var(--s-faint); font-weight: normal; white-space: nowrap; }
.radix-themes .proofread-file ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.radix-themes .proofread-row { display: grid; gap: var(--space-1); min-width: 0; padding-bottom: var(--space-1); border-bottom: 0.5px solid var(--s-line); }
.radix-themes .proofread-hit {
  width: 100%; height: auto; white-space: normal; display: grid; gap: 2px; text-align: left; min-height: var(--s-control-sm); padding: var(--space-2); border: 0; border-radius: var(--s-radius-md);
  background: transparent; color: var(--s-muted); cursor: pointer; font-size: var(--font-size-2); box-shadow: none;
}
.radix-themes .proofread-hit:hover:not([disabled]) { background: var(--s-hover); color: var(--s-text); }
.radix-themes .proofread-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-1); min-width: 0; }
.radix-themes .proofread-message { grid-column: 1 / -1; min-width: 0; color: var(--s-text); overflow-wrap: anywhere; }
.radix-themes .proofread-location { color: var(--s-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.radix-themes .proofread-hit .proofread-kind { color: var(--s-faint); }
.radix-themes .proofread-severity { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; corner-shape: round; vertical-align: middle; background: var(--s-faint); }
.radix-themes .proofread-severity.error { background: var(--s-danger); }
.radix-themes .proofread-severity.warning { background: var(--s-warning); }
.radix-themes .proofread-severity.info { background: var(--s-faint); }
.radix-themes .proofread-excerpt { display: block; color: var(--s-faint); overflow-wrap: anywhere; }
.radix-themes .proofread-excerpt mark { background: var(--s-accent-soft); color: var(--s-text); padding: 0 1px; border-radius: var(--s-radius-xs); }
.radix-themes .proofread-suggestion { display: block; color: var(--s-accent); font-weight: var(--font-weight-medium); }
.radix-themes .proofread-row-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: 0 var(--space-2); }
.radix-themes .proofread-row-actions button:not([class^="rt-"]):not([class*=" rt-"]) { background: var(--s-bg); color: var(--s-text); }
.radix-themes .proofread-habits { display: grid; gap: var(--space-1); min-width: 0; }
.radix-themes .proofread-habits h3 { margin: var(--space-1) 0 0; font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--s-font); color: var(--s-muted); }
.radix-themes .proofread-habits table { width: 100%; border-collapse: collapse; font-size: var(--font-size-2); }
.radix-themes .proofread-habits th, .radix-themes .proofread-habits td { padding: 3px var(--space-1); text-align: left; color: var(--s-muted); border-bottom: 0.5px solid var(--s-line); }
.radix-themes .proofread-habits th { color: var(--s-faint); font-weight: var(--font-weight-medium); }
.radix-themes .proofread-habits td:nth-child(2), .radix-themes .proofread-habits td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
.radix-themes .proofread-habits button { width: 100%; text-align: left; background: transparent; border: 0; color: var(--s-muted); padding: 2px var(--space-1); box-shadow: none; }
.radix-themes .proofread-fix { min-width: 0; }
.radix-themes .proofread-panel .proposal-card { font-size: var(--font-size-2); }
.radix-themes .proofread-panel .proposal-card header, .radix-themes .proofread-panel .proposal-card footer { flex-wrap: wrap; }
.radix-themes .proofread-panel .proposal-card pre { max-height: 120px; }
.radix-themes .proofread-panel .warning {
  margin: 0; color: var(--s-danger); font-weight: var(--font-weight-medium);
  border-inline-start: 2px solid var(--s-danger); padding-inline-start: var(--space-2);
}
.radix-themes .proofread-panel .muted { color: var(--s-muted); }
.proofread-panel button:focus:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel input:focus:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel select:focus:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel textarea:focus, .proofread-panel a:focus:not([class^="rt-"]):not([class*=" rt-"]) { outline: none; }
.proofread-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel textarea:focus-visible, .proofread-panel a:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel [tabindex]:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: var(--s-focus-shadow); }
@media (forced-colors: active) {
  .proofread-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel textarea:focus-visible, .proofread-panel a:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) {
    outline: 2px solid CanvasText;
    outline-offset: 2px;
  }
}
.radix-themes .proofread-loading { display: grid; gap: var(--space-2); color: var(--s-muted); }
@media (max-width: 400px) {
  .radix-themes .proofread-panel { margin-inline: var(--space-1); }
  .radix-themes .proofread-chip { flex: 1 1 auto; }
}
@media (prefers-reduced-motion: reduce) {
  .radix-themes .proofread-panel, .radix-themes .proofread-panel *,
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after {
    animation: none !important; transition: none !important; transform: none !important;
  }
}
`
