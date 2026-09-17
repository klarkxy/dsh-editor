// One-shot stylesheet for the zhihu dock. Colors use Radix Themes
// variables from the host Theme tree. Placement follows the host's
// --dsh-ext-* contract.

export const zhihuClientStyles = `
.zhihu-dock {
  position: var(--dsh-ext-dock-position, absolute);
  right: var(--dsh-ext-dock-right, var(--space-4));
  bottom: var(--dsh-ext-dock-bottom, calc(var(--space-4) + 44px));
  pointer-events: auto;
}
.zhihu-settings-embed {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 0;
}
.zhihu-settings-embed .zhihu-tabs {
  margin: 0 0 var(--space-2);
}
.zhihu-settings-embed .zhihu-panel-body {
  padding: var(--space-3) 0 0;
  overflow: visible;
}
.zhihu-toggle {
  pointer-events: auto;
  font: inherit;
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  min-height: var(--control-h, 34px);
  color: var(--gray-11);
  background: var(--color-panel-solid);
  border: 1px solid var(--gray-6);
  border-radius: 999px;
  padding: 0 14px;
  cursor: pointer;
  box-shadow: var(--shadow-3);
}
.zhihu-toggle:hover { border-color: var(--accent-9); color: var(--accent-11); background: var(--gray-a3); }
.zhihu-toggle:focus-visible,
.zhihu-panel button:focus-visible,
.zhihu-panel input:focus-visible,
.zhihu-panel select:focus-visible,
.zhihu-panel a:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-a8);
}
.zhihu-dock .zhihu-panel {
  position: absolute;
  top: var(--dsh-ext-panel-top, auto);
  right: 0;
  bottom: var(--dsh-ext-panel-bottom, calc(100% + 6px));
  z-index: 10;
  width: min(440px, calc(100vw - 32px));
  max-height: min(72vh, 620px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  color: var(--gray-12);
  background: var(--color-panel-solid);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-3);
  box-shadow: var(--shadow-4);
  overflow: hidden;
}
.zhihu-panel {
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  color: var(--gray-12);
  background: var(--color-panel-solid);
}
.zhihu-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--gray-6);
}
.zhihu-panel-title {
  margin: 0;
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-medium);
  font-family: var(--default-font-family);
}
.zhihu-panel-close {
  font: inherit; font-size: var(--font-size-2); min-height: 32px; color: var(--gray-11); background: none; border: none;
  border-radius: var(--radius-2); padding: 0 8px; cursor: pointer;
}
.zhihu-panel-close:hover { color: var(--gray-12); background: var(--gray-a3); }
.zhihu-panel-close:disabled { opacity: 0.5; cursor: default; }
.zhihu-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  margin: var(--space-2) var(--space-3) 0;
  border-radius: var(--radius-3);
  background: var(--gray-3);
  box-shadow: 0 0 0 1px var(--gray-a5);
  width: max-content;
}
.zhihu-tab {
  font: inherit;
  font-size: var(--font-size-2);
  min-height: 28px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-2);
  background: transparent;
  color: var(--gray-11);
  cursor: pointer;
}
.zhihu-tab:hover { color: var(--gray-12); background: var(--gray-a3); }
.zhihu-tab[aria-selected="true"] {
  background: var(--accent-a3);
  color: var(--accent-11);
  box-shadow: 0 0 0 1px var(--gray-a5);
  font-weight: var(--font-weight-medium);
  transform: scale(1.04);
}
.zhihu-panel-body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
}
.zhihu-field { display: flex; flex-direction: column; gap: 4px; }
.zhihu-field-label { color: var(--gray-11); font-weight: var(--font-weight-medium); }
.zhihu-input, .zhihu-select {
  width: 100%;
  min-height: var(--control-h, 34px);
  box-sizing: border-box;
  font: inherit;
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  color: var(--gray-12);
  background: var(--color-surface);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: 0 8px;
}
.zhihu-row { display: flex; align-items: center; gap: var(--space-2); }
.zhihu-button {
  font: inherit; font-size: var(--font-size-2); min-height: var(--control-h, 34px); color: var(--gray-11); background: none;
  border: 1px solid var(--gray-6); border-radius: var(--radius-2);
  padding: 0 12px; cursor: pointer;
}
.zhihu-button:hover { background: var(--gray-a3); }
.zhihu-button:disabled { opacity: 0.5; cursor: default; }
.zhihu-button-primary {
  color: var(--accent-contrast);
  background: var(--accent-9);
  border-color: var(--accent-9);
}
.zhihu-button-primary:hover:not(:disabled) { background: var(--accent-10); }
.zhihu-button-danger { color: var(--red-11); }
.zhihu-hint { color: var(--gray-11); font-size: var(--font-size-2); margin: 0; }
.zhihu-status { color: var(--gray-11); margin: 0; padding: var(--space-2) 0; }
.zhihu-error { color: var(--red-11); margin: 0; padding: var(--space-2) 0; }
.zhihu-warning { color: var(--red-11); margin: 0; }
.zhihu-saved { color: var(--green-11); margin: 0; }
.zhihu-link { color: var(--accent-11); }
/* Ordinary DSH paints a light fill on bare <a>. Keep plugin links
   transparent so computed contrast falls through to the panel surface. */
.zhihu-panel .zhihu-link, .zhihu-panel .zhihu-result-title { background: transparent; }
.zhihu-stale {
  color: var(--gray-11);
  background: var(--gray-a3);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}
.zhihu-results { display: flex; flex-direction: column; gap: var(--space-2); }
.zhihu-results-summary { color: var(--gray-11); font-weight: var(--font-weight-medium); margin: 0; }
.zhihu-result-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.zhihu-result-item {
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--color-surface);
}
.zhihu-result-item:hover { background: var(--gray-a3); }
.zhihu-result-title { font-weight: var(--font-weight-medium); color: var(--gray-12); }
.zhihu-result-meta { color: var(--gray-11); font-size: var(--font-size-2); }
.zhihu-result-summary { color: var(--gray-11); }
.zhihu-result-snippet {
  color: var(--gray-11);
  background: var(--gray-3);
  border-radius: var(--radius-2);
  padding: 4px 8px;
}
.zhihu-ask-content { white-space: pre-wrap; line-height: 1.7; color: var(--gray-12); }
.zhihu-ask-reasoning { color: var(--gray-11); font-size: var(--font-size-2); }
.zhihu-status-grid { display: flex; gap: var(--space-2); margin: 0; align-items: baseline; }
.zhihu-status-label { color: var(--gray-11); font-weight: var(--font-weight-medium); }
.zhihu-status-value { margin: 0; display: flex; align-items: center; gap: 6px; }
.zhihu-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.zhihu-dot-configured { background: var(--green-11); }
.zhihu-dot-missing { background: var(--gray-9); }
.zhihu-dot-locked { background: var(--red-9); }
.zhihu-guide {
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}
.zhihu-guide-title { margin: 0 0 4px; font-size: var(--font-size-2); font-weight: var(--font-weight-medium); font-family: var(--default-font-family); }
.zhihu-guide-steps { margin: 0; padding-left: 18px; color: var(--gray-11); }
.zhihu-scopes { display: flex; gap: var(--space-3); flex-wrap: wrap; }
.zhihu-scope {
  display: inline-flex; align-items: center; gap: 4px; color: var(--gray-11);
  font: inherit; background: none; border: 1px solid var(--gray-6); border-radius: var(--radius-2);
  padding: 0 10px; min-height: var(--control-h, 34px); cursor: pointer;
}
.zhihu-scope.is-on, .zhihu-scope[aria-pressed="true"] {
  color: var(--accent-11); background: var(--accent-a3); border-color: var(--accent-a6);
}
.zhihu-input.ui-input { width: 100%; }
.zhihu-usage { display: flex; flex-direction: column; gap: var(--space-3); }
.zhihu-usage-intro { margin: 0; color: var(--gray-11); line-height: 1.6; }
.zhihu-usage-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: var(--space-2); }
.zhihu-usage-card { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: var(--space-2); border: 1px solid var(--gray-6); border-radius: var(--radius-2); background: var(--color-panel-solid); }
.zhihu-usage-card:hover { background: var(--gray-a3); }
.zhihu-usage-card-label { color: var(--gray-11); font-size: var(--font-size-2); }
.zhihu-usage-card-value { font-weight: var(--font-weight-medium); font-variant-numeric: tabular-nums; color: var(--gray-12); }
.zhihu-usage-card-unit { margin-left: 4px; color: var(--gray-11); font-size: var(--font-size-2); font-weight: 400; }
.zhihu-usage-heading { margin: 0; font-size: var(--font-size-2); font-weight: var(--font-weight-medium); color: var(--gray-11); font-family: var(--default-font-family); }
.zhihu-usage-legend { display: flex; flex-wrap: wrap; gap: 6px var(--space-3); margin: 0; padding: 0; list-style: none; color: var(--gray-11); font-size: var(--font-size-2); }
.zhihu-usage-legend li { display: inline-flex; align-items: center; gap: 6px; }
.zhihu-chart-chip { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.zhihu-chart-chip-ok { background: var(--accent-9); }
.zhihu-chart-chip-fail { background: var(--red-9); }
.zhihu-chart { width: 100%; height: auto; aspect-ratio: 600 / 176; display: block; }
.zhihu-chart-bar-ok { fill: var(--accent-9); }
.zhihu-chart-bar-fail { fill: var(--red-9); }
.zhihu-chart-hit { fill: transparent; }
.zhihu-chart-grid { stroke: var(--gray-6); stroke-width: 1; }
.zhihu-chart-axis { fill: var(--gray-11); font-size: var(--font-size-1); font-family: var(--code-font-family); }
.zhihu-chart-tick { fill: var(--gray-11); font-size: var(--font-size-1); font-family: var(--code-font-family); }
.zhihu-chart-value { fill: var(--gray-11); font-size: var(--font-size-1); font-family: var(--code-font-family); }
.zhihu-usage-table-wrap { overflow-x: auto; }
.zhihu-usage-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.zhihu-usage-table th, .zhihu-usage-table td { padding: 4px 6px; text-align: right; border-bottom: 1px solid var(--gray-6); color: var(--gray-11); }
.zhihu-usage-table th:first-child, .zhihu-usage-table td:first-child { text-align: left; }
.zhihu-usage-table th { color: var(--gray-11); font-weight: var(--font-weight-medium); }
.zhihu-file {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.zhihu-upload-confirm {
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  color: var(--gray-11);
}
/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden。 */
@keyframes zhihu-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
.zhihu-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; color: var(--accent-9); }
.zhihu-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: zhihu-activity-pulse 1.4s ease infinite; }
.zhihu-dots i:nth-child(2) { animation-delay: .2s; }
.zhihu-dots i:nth-child(3) { animation-delay: .4s; }
@media (prefers-reduced-motion: reduce) {
  .zhihu-dock, .zhihu-dock *, .zhihu-panel, .zhihu-panel * {
    animation: none !important; transition: none !important;
    transform: none !important; filter: none !important;
  }
  .zhihu-dots i { animation: none; }
}
/* Keep the standalone dark-host selectors so specs and a DSH host without
   Theme still recognize the contract. Do not use prefers-color-scheme. */
html:not([data-theme]) body[data-ds-dark-theme] .zhihu-dock,
html:not([data-theme]) body[data-ds-dark-theme] .zhihu-toggle,
html:not([data-theme]) body[data-ds-dark-theme] .zhihu-panel,
:root[data-theme="dark"] .zhihu-dock,
:root[data-theme="dark"] .zhihu-toggle,
:root[data-theme="dark"] .zhihu-panel {
  color-scheme: dark;
}
`
