import { panelChromeStyles } from 'dsh-editor-panel-base/chrome'

/*
 * 文档概览：中心覆盖层，卡片容器保留浮起外观；共享面板外观（页头/分节/列表/
 * 提示/焦点/reduced-motion）在 dsh-editor-panel-base/chrome。
 */
export const overviewPanelStyles = `${panelChromeStyles}
@keyframes overview-panel-in { from { opacity: 0; transform: translateY(8px); } }
.shell.layout-shell:has(.overview-panel[data-dsh-center-overlay]) [data-dsh-center-overlay]:not(.overview-panel) { display: none; }
.overview-panel {
  overflow: auto;
  border: 0; border-radius: var(--s-radius-panel); background: var(--s-raised); box-shadow: var(--s-elevate);
  animation: overview-panel-in var(--s-duration-slow) var(--s-ease-out) both;
}
.overview-header { padding: var(--s-space-4) var(--s-space-6) var(--s-space-3); border-bottom: 0.5px solid var(--s-line); }
.overview-body { display: grid; gap: var(--s-space-5); padding: var(--s-space-4) var(--s-space-6) var(--s-space-6); }
.overview-totals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-space-3); }
/* Stat tiles are plain text blocks, not filled cards: the container must not
   compete with the numbers it presents. */
.overview-totals > article {
  display: grid; gap: var(--s-space-2); padding: var(--s-space-2) 0; border: 0;
  border-radius: 0; background: transparent; box-shadow: none;
}
.overview-totals span { font-size: var(--s-text-xs); color: var(--s-faint); }
.overview-totals strong { font-size: var(--s-text-base); font-weight: var(--s-weight-medium); color: var(--s-text); font-variant-numeric: tabular-nums; }
input.overview-filter {
  width: 100%; min-height: var(--s-control); margin: 0 0 var(--s-space-2); padding: 0 var(--s-space-3); box-sizing: border-box;
  border: 0; border-radius: var(--s-radius-md); box-shadow: var(--s-elevate-soft); background: var(--s-bg); color: var(--s-text);
  font: var(--s-weight-regular) var(--s-text-sm)/var(--s-leading-normal) var(--s-font);
}
.overview-filter.ui-input { width: 100%; margin: 0 0 var(--s-space-2); }
.overview-chapter {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto; align-items: center; gap: var(--s-space-2); padding: var(--s-space-2); border-radius: var(--s-radius-md);
}
.overview-chapter:hover { background: var(--s-hover); }
.overview-chapter.empty { border: 1px solid var(--s-danger); }
.overview-chapter-title {
  justify-content: flex-start; text-align: left; min-height: var(--s-control-sm); color: var(--s-text);
  font-size: var(--s-text-sm); font-weight: var(--s-weight-medium); border: 0; background: transparent; cursor: pointer;
}
.overview-chapter-title:hover { color: var(--s-accent); }
.overview-chapter-chars, .overview-chapter-time {
  color: var(--s-faint); font-size: var(--s-text-xs); font-variant-numeric: tabular-nums;
}
.overview-chapter-meta { display: inline-flex; gap: var(--s-space-1); min-height: var(--s-space-4); align-items: center; }
.overview-meta-pill {
  display: inline-flex; align-items: center; justify-content: center; min-width: var(--s-space-4); height: var(--s-space-4); padding: 0 var(--s-space-2);
  border-radius: var(--s-radius-full); corner-shape: round; background: var(--s-sunken); color: var(--s-muted);
  font-size: var(--s-text-xs); font-weight: var(--s-weight-medium);
}
.overview-empty-flag {
  padding: 1px var(--s-space-2); border-radius: var(--s-radius-full); corner-shape: round; background: var(--s-bg);
  border: 1px solid var(--s-danger); color: var(--s-danger); font-size: var(--s-text-xs); font-weight: var(--s-weight-medium);
}
.overview-char-bars {
  padding: var(--s-space-3); display: grid; gap: var(--s-space-2);
  border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-md); background: var(--s-bg); box-shadow: none;
}
.overview-char-col { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(60px, 1fr) auto; gap: var(--s-space-2); align-items: center; }
.overview-char-label {
  min-width: 0; min-height: var(--s-control-sm); padding: 0; justify-content: flex-start; text-align: left; white-space: normal; overflow-wrap: anywhere;
  color: var(--s-muted); font-size: var(--s-text-sm); border: 0; background: transparent; cursor: pointer; box-shadow: none;
}
.overview-char-label:hover { color: var(--s-accent); }
.overview-char-meter { display: block; height: var(--s-space-2); border-radius: var(--s-radius-xs); background: var(--s-sunken); overflow: hidden; }
.overview-char-meter i { display: block; height: 100%; background: var(--s-accent); }
.overview-char-col.empty .overview-char-meter i { background: var(--s-danger); }
.overview-char-value { color: var(--s-faint); font-size: var(--s-text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
.overview-chart h4 { margin: var(--s-space-3) 0 var(--s-space-1); font-size: var(--s-text-sm); font-weight: var(--s-weight-medium); color: var(--s-text); }
.overview-chart-summary { margin: 0 0 var(--s-space-2); color: var(--s-muted); font-variant-numeric: tabular-nums; }
.overview-curve {
  display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); align-items: end; gap: var(--s-space-1);
  min-height: 96px; padding: var(--s-space-3); border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-md); background: var(--s-bg); box-shadow: none; overflow: hidden;
}
.overview-curve.daily { grid-template-columns: repeat(30, minmax(0, 1fr)); gap: calc(var(--s-space-1) / 2); }
.overview-curve-col { min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: var(--s-space-1); }
.overview-curve-col i {
  display: block; width: 70%; max-width: var(--s-space-7); min-height: 0; border-radius: var(--s-radius-xs) var(--s-radius-xs) 1px 1px; background: var(--s-accent);
}
.overview-curve-col.today i { background: var(--s-success); }
.overview-curve-col.negative i { background: var(--s-danger); }
.overview-curve-col small { color: var(--s-faint); font-size: var(--s-text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
.overview-recent li { display: grid; gap: calc(var(--s-space-1) / 2); }
.overview-recent button { justify-content: flex-start; padding-inline: 0; text-align: left; min-height: var(--s-control-sm); color: var(--s-text); font-weight: var(--s-weight-medium); font-size: var(--s-text-sm); border: 0; background: transparent; cursor: pointer; box-shadow: none; }
.overview-recent button:hover { color: var(--s-accent); }
.overview-recent small { color: var(--s-faint); }
@keyframes overview-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
.overview-loading { display: grid; gap: var(--s-space-5); padding: var(--s-space-4) var(--s-space-6) var(--s-space-6); }
.overview-loading-cards { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-space-3); }
.overview-loading-cards i { position: relative; display: block; height: 56px; border: 0; border-radius: var(--s-radius-md); background: var(--s-sunken); box-shadow: none; overflow: hidden; }
.overview-loading-cards i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--s-hover), transparent); animation: overview-activity-sheen 1.5s linear infinite; }
@media (max-width: 720px) {
  .overview-totals, .overview-chapter { grid-template-columns: minmax(0, 1fr); }
  .overview-char-col { grid-template-columns: minmax(0, 1fr) auto; }
  .overview-char-meter { grid-column: 1 / -1; grid-row: 2; }
}
`
