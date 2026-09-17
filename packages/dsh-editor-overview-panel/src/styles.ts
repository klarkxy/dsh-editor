export const overviewPanelStyles = `
@keyframes overview-panel-in { from { opacity: 0; transform: translateY(8px); } }
/* 概览打开时优先于其他中栏 overlay（沿用旧 Shell 的 overview-open 行为）。 */
.shell.layout-shell:has(.overview-panel[data-dsh-center-overlay]) [data-dsh-center-overlay]:not(.overview-panel) { display: none; }
.radix-themes .overview-panel {
  min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--color-panel-solid);
  box-shadow: var(--shadow-4); font-size: var(--font-size-2);
  animation: overview-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .overview-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-3); border-bottom: 1px solid var(--gray-a5);
}
.radix-themes .overview-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--default-font-family); color: var(--gray-12); }
.radix-themes .overview-header p { margin: var(--space-2) 0 0; }
.radix-themes .overview-body { display: grid; gap: var(--space-5); padding: var(--space-4) var(--space-5) var(--space-6); }
.radix-themes .overview-totals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); }
.radix-themes .overview-totals > article {
  display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--gray-a5); border-radius: var(--radius-3); background: var(--gray-1);
}
.radix-themes .overview-chapters, .radix-themes .overview-chart { min-width: 0; }
.radix-themes .overview-totals span { font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--default-font-family); color: var(--gray-10); }
.radix-themes .overview-totals strong { font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--default-font-family); color: var(--gray-12); font-variant-numeric: tabular-nums; }
.radix-themes .overview-body h3 { margin: 0 0 var(--space-2); font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--default-font-family); color: var(--gray-11); }
.radix-themes input.overview-filter {
  width: 100%; min-height: 32px; margin: 0 0 var(--space-2); padding: 0 var(--space-2); box-sizing: border-box;
  border: 1px solid var(--gray-6); border-radius: var(--radius-2); background: var(--gray-2); color: var(--gray-12);
  font: 400 var(--font-size-2)/var(--line-height-2) var(--default-font-family);
}
.radix-themes .overview-filter.ui-input { width: 100%; margin: 0 0 var(--space-2); }
.radix-themes .overview-chapter-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.radix-themes .overview-chapter {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-2); border-radius: var(--radius-2);
}
.radix-themes .overview-chapter:hover { background: var(--gray-a3); }
.radix-themes .overview-chapter.empty { box-shadow: inset 0 0 0 1px var(--red-a5); }
.radix-themes .overview-chapter-title {
  text-align: left; min-height: 32px; color: var(--gray-12); font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--default-font-family); border: 0; background: transparent; cursor: pointer;
}
.radix-themes .overview-chapter-title:hover { color: var(--accent-11); }
.radix-themes .overview-chapter-chars, .radix-themes .overview-chapter-time {
  color: var(--gray-10); font-size: var(--font-size-2); font-variant-numeric: tabular-nums;
}
.radix-themes .overview-chapter-meta { display: inline-flex; gap: var(--space-1); min-height: 16px; }
.radix-themes .overview-meta-pill {
  display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 var(--space-2);
  border-radius: 999px; background: var(--gray-3); color: var(--gray-11); font-size: var(--font-size-1); font-weight: var(--font-weight-medium);
}
.radix-themes .overview-empty-flag {
  padding: 1px var(--space-2); border-radius: 999px; background: var(--red-a3); color: var(--red-11); font-size: var(--font-size-1);
}
.radix-themes .overview-char-bars, .radix-themes .overview-curve {
  display: flex; align-items: flex-end; gap: var(--space-2); min-height: 96px; padding: var(--space-3); border: 1px solid var(--gray-a5);
  border-radius: var(--radius-3); background: var(--gray-2); overflow-x: auto;
}
.radix-themes .overview-curve.weekly { min-height: 96px; }
.radix-themes .overview-char-col, .radix-themes .overview-curve-col {
  flex: 1 1 18px; min-width: 18px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: var(--space-1);
}
.radix-themes .overview-char-col i, .radix-themes .overview-curve-col i {
  display: block; width: 70%; max-width: 28px; min-height: 0; border-radius: var(--radius-2) var(--radius-2) 1px 1px; background: var(--accent-9);
}
.radix-themes .overview-char-col.empty i { background: var(--red-a6); }
.radix-themes .overview-curve-col.today i { background: var(--green-9); }
.radix-themes .overview-curve-col.negative i { background: var(--red-9); }
.radix-themes .overview-char-value, .radix-themes .overview-curve-col small {
  color: var(--gray-10); font-size: var(--font-size-1); font-variant-numeric: tabular-nums;
}
.radix-themes .overview-char-label {
  max-width: 4.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gray-11); font-size: var(--font-size-1);
  min-height: 32px; border: 0; background: transparent; cursor: pointer;
}
.radix-themes .overview-recent ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.radix-themes .overview-recent li { display: grid; gap: 2px; }
.radix-themes .overview-recent button { text-align: left; min-height: 32px; color: var(--gray-12); font-weight: var(--font-weight-medium); border: 0; background: transparent; cursor: pointer; font-size: var(--font-size-2); }
.radix-themes .overview-recent button:hover { color: var(--accent-11); }
.radix-themes .overview-recent small { color: var(--gray-10); }
.radix-themes .overview-panel button:not([class^="rt-"]):not([class*=" rt-"]) { font-size: var(--font-size-2); }
.radix-themes .overview-panel .icon-button { min-height: 32px; min-width: 32px; }
/* 活动反馈:.panel-activity-dots / .panel-skeleton 共享类由 shell styles.ts 统一提供,
   面板不再自带副本(跨包注入同名类会互相覆盖);reduced-motion 停掉循环。
   概览载入卡片是面板私有骨架条(非共享类)。 */
@keyframes overview-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
.radix-themes .overview-loading { display: grid; gap: var(--space-5); padding: var(--space-4) var(--space-5) var(--space-6); }
.radix-themes .overview-loading-cards { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); }
.radix-themes .overview-loading-cards i { position: relative; display: block; height: 56px; border: 1px solid var(--gray-a5); border-radius: var(--radius-3); background: var(--gray-2); overflow: hidden; }
.radix-themes .overview-loading-cards i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--gray-a4), transparent); animation: overview-activity-sheen 1.5s linear infinite; }
/* 焦点环:概览可能渲染在 Theme 根之外,自带 focus-visible 词汇(box-shadow 环,不用 outline)。 */
.overview-panel :focus { outline: none; }
.overview-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .overview-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .overview-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .overview-panel textarea:focus-visible, .overview-panel a:focus-visible, .overview-panel [tabindex]:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: 0 0 0 2px var(--accent-8); }
@media (max-width: 720px) {
  .radix-themes .overview-totals, .radix-themes .overview-chapter { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .radix-themes .overview-panel, .radix-themes .overview-panel *,
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after {
    animation: none !important; transition: none !important; transform: none !important;
  }
}
`
