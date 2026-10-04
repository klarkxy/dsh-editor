import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

export const memoryPanelStyles = `
@keyframes memory-panel-in { from { opacity: 0; transform: translateY(8px); } }
.radix-themes .memory-panel {
${surfaceTokenAliases}
  margin: 0 var(--space-2) var(--space-2); padding: var(--space-3); max-height: min(40vh, 320px); overflow: auto; display: flex; flex-direction: column; gap: var(--space-2);
  border: 0; border-radius: var(--s-radius-panel); background: var(--s-raised); box-shadow: var(--s-elevate);
  font-family: var(--s-font); font-size: var(--font-size-2); color: var(--s-text);
  animation: memory-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .memory-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.radix-themes .memory-panel-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--s-font); color: var(--s-text); }
.radix-themes .memory-panel-header p { margin: var(--space-1) 0 0; color: var(--s-faint); }
.radix-themes .memory-filters { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.radix-themes .memory-panel button:not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: var(--s-control-sm); padding: 0 var(--space-2); border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-md);
  background: var(--s-bg); color: var(--s-text); cursor: pointer; font-size: var(--font-size-2); box-shadow: none;
}
.radix-themes .memory-filters button:not([class^="rt-"]):not([class*=" rt-"])[aria-pressed="true"],
.radix-themes .memory-filters .rt-BaseButton[aria-pressed="true"] {
  background: var(--s-selected); color: var(--s-text); border-color: transparent;
}
.radix-themes .memory-panel button:disabled { opacity: .45; cursor: default; }
.radix-themes .memory-panel .icon-button { min-width: var(--s-control-sm); }
.radix-themes .memory-change-meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.radix-themes .memory-panel .memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.radix-themes .memory-panel button.memory-row-main:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .memory-panel .rt-BaseButton.memory-row-main {
  display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--s-control); padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--s-radius-md);
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; box-shadow: none;
}
.radix-themes .memory-panel .memory-row-main::before { content: '›'; flex: none; color: var(--s-faint); transform: rotate(0); transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1); }
.radix-themes .memory-panel .memory-row-main[aria-expanded="true"]::before { transform: rotate(90deg); }
.radix-themes .memory-panel button.memory-row-main:not([class^="rt-"]):not([class*=" rt-"]):hover,
.radix-themes .memory-panel .rt-BaseButton.memory-row-main:hover { background: var(--s-hover); }
.radix-themes .memory-panel button.memory-row-main:not([class^="rt-"]):not([class*=" rt-"])[aria-expanded="true"],
.radix-themes .memory-panel .rt-BaseButton.memory-row-main[aria-expanded="true"] { background: var(--s-selected); color: var(--s-text); }
.radix-themes .memory-panel .memory-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--s-text); }
.radix-themes .memory-panel .memory-meta { flex: none; color: var(--s-muted); font-size: var(--font-size-2); }
.radix-themes .memory-panel .proposal-card { font-size: var(--font-size-2); }
.radix-themes .memory-panel .proposal-card pre { max-height: 120px; }
.radix-themes .memory-panel .memory-reason { display: grid; gap: var(--space-1); }
.radix-themes .memory-panel .memory-reason ul { margin: 0; padding-left: 18px; display: grid; gap: var(--space-1); }
.radix-themes .memory-panel .memory-reason small { color: var(--s-faint); }
.radix-themes .memory-panel .proposal-diff { display: grid; gap: var(--space-2); }
.radix-themes .memory-panel .proposal-card.memory-change { min-width: 0; }
.radix-themes details.proposal-card.memory-change-chat > summary {
  cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); list-style: none; min-width: 0;
}
.radix-themes details.proposal-card.memory-change-chat > summary::-webkit-details-marker { display: none; }
.radix-themes details.proposal-card.memory-change-chat > summary > strong { min-width: 0; overflow-wrap: anywhere; }
.radix-themes details.proposal-card.memory-change-chat > summary > code { overflow-wrap: anywhere; }
.radix-themes details.proposal-card.memory-change-chat[open] > summary { margin-bottom: 2px; }
.radix-themes .memory-panel .proposal-card.expired { border: 1px solid var(--s-danger); }
.radix-themes .memory-panel .proposal-card.checking { color: var(--s-muted); }
.radix-themes .memory-panel .warning {
  margin: 0; color: var(--s-danger); font-weight: var(--font-weight-medium);
  border-inline-start: 2px solid var(--s-danger); padding-inline-start: var(--space-2);
}
.radix-themes .memory-panel .muted { color: var(--s-muted); }
.radix-themes .memory-status { margin: 0; color: var(--s-muted); }
.memory-panel button:focus:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel input:focus:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel select:focus:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel textarea:focus, .memory-panel a:focus:not([class^="rt-"]):not([class*=" rt-"]) { outline: none; }
.memory-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel textarea:focus-visible, .memory-panel a:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel [tabindex]:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: var(--s-focus-shadow); }
@media (forced-colors: active) {
  .memory-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel textarea:focus-visible, .memory-panel a:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) {
    outline: 2px solid CanvasText;
    outline-offset: 2px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .radix-themes .memory-panel, .radix-themes .memory-panel *,
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after {
    animation: none !important; transition: none !important; transform: none !important;
  }
}
`
