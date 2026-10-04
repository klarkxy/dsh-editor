import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

export const cardsPanelStyles = `
@keyframes cards-panel-in { from { opacity: 0; } }
.radix-themes .cards-panel,
.radix-themes .cards-detail,
.file-dialog.prompt-dialog {
${surfaceTokenAliases}
  color: var(--s-text);
  font-family: var(--s-font);
}
.radix-themes .cards-panel {
  margin: 0 var(--space-2) var(--space-2); padding: var(--space-3); border: 0; border-radius: var(--s-radius-panel);
  background: var(--s-raised); box-shadow: var(--s-elevate);
  display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; font-size: var(--font-size-2);
  animation: cards-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .cards-panel-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2);
}
.radix-themes .cards-panel-header h2 {
  margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--s-font); color: var(--s-text);
}
.radix-themes .cards-tabs {
  display: inline-flex; flex-wrap: wrap; gap: 0; padding: 4px; border-radius: var(--s-radius-lg); background: var(--s-sunken);
}
.radix-themes .cards-tabs button:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-toolbar button:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-chip:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-ref-toggle:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-detail-actions button:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-relations button:not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: var(--s-control-sm); padding: 0 var(--space-2); border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-md);
  background: var(--s-bg); color: var(--s-text); cursor: pointer; font-size: var(--font-size-2); box-shadow: none;
}
.radix-themes .cards-tabs button:not([class^="rt-"]):not([class*=" rt-"]) {
  border: 0; background: transparent; color: var(--s-muted);
}
.radix-themes .cards-panel button:disabled, .radix-themes .cards-detail button:disabled { opacity: .45; cursor: default; }
.radix-themes .cards-tabs button:hover:not(:disabled) { background: var(--s-hover); }
.radix-themes .cards-toolbar { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
.radix-themes .cards-toolbar input:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-toolbar select:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-fields input:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-fields select:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-fields textarea {
  min-width: 0; width: 100%; min-height: var(--s-control); padding: 0 var(--space-2); border: 0; border-radius: var(--s-radius-md);
  box-shadow: var(--s-elevate-soft); background: var(--s-bg); color: var(--s-text);
  font: 400 var(--font-size-2)/var(--line-height-2) var(--s-font);
}
.radix-themes .cards-toolbar .ui-input, .radix-themes .cards-fields .ui-input { min-width: 0; width: 100%; }
.radix-themes .cards-fields textarea { min-height: 72px; padding: var(--space-2); resize: vertical; }
.radix-themes .cards-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.radix-themes .cards-chip:not([class^="rt-"]):not([class*=" rt-"]) { background: var(--s-sunken); color: var(--s-muted); border-color: transparent; }
.radix-themes .cards-tabs button:not([class^="rt-"]):not([class*=" rt-"])[aria-selected="true"],
.radix-themes .cards-tabs .rt-BaseButton[aria-selected="true"] {
  background: var(--s-raised); color: var(--s-text);
}
.radix-themes .cards-chip:not([class^="rt-"]):not([class*=" rt-"])[aria-pressed="true"],
.radix-themes .cards-chip.rt-BaseButton[aria-pressed="true"] {
  background: var(--s-selected); color: var(--s-text); border-color: transparent;
}
.radix-themes .cards-chip:hover:not(:disabled):not([aria-pressed="true"]) { background: var(--s-hover); color: var(--s-text); }
.radix-themes .cards-groups { display: grid; gap: var(--space-2); max-height: min(40vh, 320px); overflow: auto; }
.radix-themes .cards-group h3 { margin: 0; font: var(--font-weight-medium) var(--font-size-1)/var(--line-height-1) var(--s-font); color: var(--s-faint); }
.radix-themes .cards-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.radix-themes .cards-item {
  display: grid; gap: var(--space-1); padding: var(--space-3); border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-xl); background: var(--s-raised); box-shadow: none;
}
.radix-themes .cards-item.selected { background: var(--s-selected); color: var(--s-text); }
.radix-themes .cards-item-main { display: grid; gap: 3px; width: 100%; text-align: left; border: 0; background: transparent; color: var(--s-text); cursor: pointer; border-radius: var(--s-radius-md); }
.radix-themes .cards-item-main:hover { background: var(--s-hover); }
.radix-themes .cards-item-main:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: var(--s-focus-shadow); }
.radix-themes .cards-item-main strong { font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--s-font); }
.radix-themes .cards-meta { display: flex; flex-wrap: wrap; gap: var(--space-2); color: var(--s-faint); font-size: var(--font-size-2); }
.radix-themes .cards-badge { padding: 1px var(--space-2); border-radius: 999px; corner-shape: round; background: var(--s-sunken); color: var(--s-muted); font-style: normal; }
.radix-themes .cards-tags, .radix-themes .cards-item-main small { color: var(--s-faint); font-size: var(--font-size-1); overflow-wrap: anywhere; }
.radix-themes .cards-status { margin: 0; font-size: var(--font-size-2); color: var(--s-muted); }
.radix-themes .cards-refs { display: grid; gap: var(--space-1); }
.radix-themes .cards-ref-groups ol, .radix-themes .cards-ref-groups ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.radix-themes .cards-ref-groups button {
  width: 100%; text-align: left; min-height: var(--s-control-sm); padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--s-radius-md);
  background: transparent; color: var(--s-muted); cursor: pointer; font-size: var(--font-size-2);
}
.radix-themes .cards-ref-groups button:hover:not([disabled]) { background: var(--s-hover); color: var(--s-text); }
.radix-themes .cards-detail {
  min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column;
  border: 0; border-radius: var(--s-radius-panel); background: var(--s-raised); box-shadow: var(--s-elevate); font-size: var(--font-size-2);
}
.radix-themes .cards-detail-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-3); border-bottom: 0.5px solid var(--s-line);
}
.radix-themes .cards-detail-header-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.radix-themes .cards-detail-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--s-font); color: var(--s-text); }
.radix-themes .cards-detail-header p { margin: var(--space-2) 0 0; color: var(--s-muted); }
.radix-themes .cards-detail-body { display: grid; gap: var(--space-4); padding: var(--space-4) var(--space-5) var(--space-6); }
.radix-themes .cards-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); }
.radix-themes .cards-field { display: grid; gap: var(--space-1); min-width: 0; font-size: var(--font-size-2); color: var(--s-muted); }
.radix-themes .cards-field-wide { grid-column: 1 / -1; }
.radix-themes .cards-relations { display: grid; gap: var(--space-2); }
.radix-themes .cards-relation-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: var(--space-1); align-items: center; }
.radix-themes .cards-relation-link { background: transparent; border: 0; color: var(--s-accent); font-weight: var(--font-weight-medium); text-underline-offset: 3px; }
.radix-themes .cards-relation-link:hover { text-decoration: underline dotted; }
.radix-themes .cards-detail-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.radix-themes .cards-detail-header-actions button:not(.icon-button):not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: var(--s-control-sm); padding: 0 var(--space-2); border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-md);
  background: var(--s-bg); color: var(--s-text); cursor: pointer; font-size: var(--font-size-2); box-shadow: none;
}
.radix-themes .cards-panel .warning,
.radix-themes .cards-detail .warning,
.file-dialog.prompt-dialog .warning {
  margin: 0; color: var(--s-danger); font-weight: var(--font-weight-medium);
  border-inline-start: 2px solid var(--s-danger); padding-inline-start: var(--space-2);
}
.radix-themes .cards-panel .muted, .radix-themes .cards-detail .muted { color: var(--s-muted); }
.radix-themes .file-dialog.prompt-dialog, .file-dialog.prompt-dialog {
  width: min(520px, 100%); border: 0; border-radius: var(--s-radius-panel); background: var(--s-raised); box-shadow: var(--s-elevate);
}
.cards-panel button:focus:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel input:focus:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel select:focus:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel textarea:focus,
.cards-detail button:focus:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail input:focus:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail select:focus:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail textarea:focus,
.file-dialog.prompt-dialog button:focus:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog input:focus:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog select:focus:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog textarea:focus { outline: none; }
.cards-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel textarea:focus-visible,
.cards-detail button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail textarea:focus-visible,
.file-dialog.prompt-dialog button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog textarea:focus-visible { box-shadow: var(--s-focus-shadow); }
@media (forced-colors: active) {
  .cards-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel textarea:focus-visible,
  .cards-detail button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail textarea:focus-visible,
  .file-dialog.prompt-dialog button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog textarea:focus-visible {
    outline: 2px solid CanvasText;
    outline-offset: 2px;
  }
}
.radix-themes .cards-loading { display: grid; gap: var(--space-2); color: var(--s-faint); }
@media (max-width: 720px) {
  .radix-themes .cards-fields, .radix-themes .cards-relation-row { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .radix-themes .cards-panel, .radix-themes .cards-panel *, .radix-themes .cards-detail, .radix-themes .cards-detail *,
  .file-dialog.prompt-dialog, .file-dialog.prompt-dialog * {
    animation: none !important; transition: none !important;
  }
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after { animation: none !important; }
}
`
