import { panelChromeStyles } from 'dsh-editor-panel-base/chrome'

/*
 * 文稿校对：共享面板外观在 dsh-editor-panel-base/chrome（.dsh-panel 根、页头、
 * 提示、焦点环、standalone 按钮兜底、reduced-motion），这里只写本面板的结构差异。
 */
export const proofreadPanelStyles = `${panelChromeStyles}
@keyframes proofread-panel-in { from { opacity: 0; transform: translateY(8px); } }
.proofread-panel {
  margin: 0; padding: var(--s-space-3); border: 0; border-radius: 0; border-bottom: 0.5px solid var(--s-line);
  background: transparent; box-shadow: none; gap: var(--s-space-2);
  animation: proofread-panel-in var(--s-duration-slow) var(--s-ease-out) both;
}
.proofread-panel-header { padding-bottom: var(--s-space-1); }
.proofread-toolbar { display: grid; gap: var(--s-space-2); min-width: 0; }
.proofread-scopes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-space-1); min-width: 0; padding: var(--s-space-1); border-radius: var(--s-radius-lg); background: var(--s-sunken); }
.proofread-scopes button, .proofread-toolbar > button { width: 100%; }
.proofread-panel .proofread-scopes button { border: 0; background: transparent; color: var(--s-muted); box-shadow: none; }
.proofread-panel .proofread-scopes button[aria-pressed='true'],
.proofread-panel .proofread-scopes button.active {
  background: var(--s-raised); color: var(--s-text); border: 0.5px solid var(--s-line-strong);
}
.proofread-kinds { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-space-1); }
.proofread-filter-label { flex: 0 0 100%; color: var(--s-muted); font-weight: var(--s-weight-medium); font-size: var(--s-text-xs); }
.proofread-panel button.proofread-chip { background: var(--s-sunken); color: var(--s-muted); border-color: transparent; }
.proofread-panel button.proofread-chip[aria-pressed='true'] { background: var(--s-selected); color: var(--s-text); }
.proofread-summary { display: flex; flex-wrap: wrap; gap: var(--s-space-2); color: var(--s-faint); font-size: var(--s-text-xs); }
.proofread-panel button.proofread-batch {
  align-self: start; min-height: var(--s-control); border: 0; background: var(--s-brand); color: var(--s-on-brand);
}
.proofread-panel button.proofread-batch:hover:not(:disabled) { background: var(--s-brand-hover); color: var(--s-on-brand); }
.proofread-results { display: flex; flex-direction: column; gap: var(--s-space-3); max-height: min(60vh, 640px); overflow: auto; }
.proofread-file { display: grid; gap: var(--s-space-1); min-width: 0; }
.proofread-file > strong { font-size: var(--s-text-sm); color: var(--s-text); overflow-wrap: anywhere; }
.proofread-file-title { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-space-1); padding: var(--s-space-1) 0; border-bottom: 0.5px solid var(--s-line); }
.proofread-file-title span { color: var(--s-faint); font-weight: var(--s-weight-regular); white-space: nowrap; }
.proofread-file ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--s-space-1); }
.proofread-row { display: grid; gap: var(--s-space-1); min-width: 0; padding-bottom: var(--s-space-1); border-bottom: 0.5px solid var(--s-line); }
.proofread-hit {
  width: 100%; height: auto; white-space: normal; display: grid; gap: calc(var(--s-space-1) / 2); text-align: left; min-height: var(--s-control-sm);
  padding: var(--s-space-2); border: 0; border-radius: var(--s-radius-md);
  background: transparent; color: var(--s-muted); cursor: pointer; font-size: var(--s-text-sm); box-shadow: none;
}
.proofread-hit:hover:not([disabled]) { background: var(--s-hover); color: var(--s-text); }
.proofread-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--s-space-1); min-width: 0; }
.proofread-message { grid-column: 1 / -1; min-width: 0; color: var(--s-text); overflow-wrap: anywhere; }
.proofread-location { color: var(--s-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.proofread-hit .proofread-kind { color: var(--s-faint); }
.proofread-severity { display: inline-block; width: var(--s-space-2); height: var(--s-space-2); margin-right: calc(var(--s-space-1) + 1px); border-radius: var(--s-radius-full); corner-shape: round; vertical-align: middle; background: var(--s-faint); }
.proofread-severity.error { background: var(--s-danger); }
.proofread-severity.warning { background: var(--s-warning); }
.proofread-severity.info { background: var(--s-faint); }
.proofread-excerpt { display: block; color: var(--s-faint); overflow-wrap: anywhere; }
.proofread-excerpt mark { background: var(--s-accent-soft); color: var(--s-text); padding: 0 1px; border-radius: var(--s-radius-xs); }
.proofread-suggestion { display: block; color: var(--s-accent); font-weight: var(--s-weight-medium); }
.proofread-row-actions { display: flex; flex-wrap: wrap; gap: var(--s-space-1); padding: 0 var(--s-space-2); }
.proofread-row-actions button { background: var(--s-raised); color: var(--s-text); }
.proofread-habits { display: grid; gap: var(--s-space-1); min-width: 0; }
.proofread-habits table { width: 100%; border-collapse: collapse; font-size: var(--s-text-sm); }
.proofread-habits th, .proofread-habits td { padding: calc(var(--s-space-1) * 0.75) var(--s-space-1); text-align: left; color: var(--s-muted); border-bottom: 0.5px solid var(--s-line); }
.proofread-habits th { color: var(--s-faint); font-weight: var(--s-weight-medium); font-size: var(--s-text-xs); }
.proofread-habits td:nth-child(2), .proofread-habits td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
.proofread-habits button { width: 100%; text-align: left; background: transparent; border: 0; color: var(--s-muted); padding: calc(var(--s-space-1) / 2) var(--s-space-1); box-shadow: none; }
.proofread-fix { min-width: 0; }
.proofread-panel .proposal-card { font-size: var(--s-text-sm); }
.proofread-panel .proposal-card header, .proofread-panel .proposal-card footer { flex-wrap: wrap; }
.proofread-panel .proposal-card pre { max-height: 120px; }
.proofread-loading { display: grid; gap: var(--s-space-2); color: var(--s-muted); }
@media (max-width: 400px) {
  .proofread-panel { margin-inline: var(--s-space-1); }
  .proofread-chip { flex: 1 1 auto; }
}
`
