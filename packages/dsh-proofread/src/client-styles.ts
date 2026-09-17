// One-shot stylesheet for the proofread dock. Colors use Radix Themes
// variables from the host Theme tree. Placement follows the host's
// --dsh-ext-* contract: a launcher rail pulls the dock inline and drops
// the open panel below the toggle; a bare host gets the legacy
// bottom-right dock with the panel opening upward.
export const proofreadClientStyles = `
.dsh-proofread-dock {
  position: var(--dsh-ext-dock-position, absolute);
  right: var(--dsh-ext-dock-right, var(--space-4));
  bottom: var(--dsh-ext-dock-bottom, var(--space-4));
  pointer-events: auto;
}
.dsh-proofread-toggle {
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
.dsh-proofread-toggle:hover { border-color: var(--accent-9); color: var(--accent-11); background: var(--gray-a3); }
.dsh-proofread-toggle:focus-visible,
.dsh-proofread-panel button:focus-visible,
.dsh-proofread-input:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-a8);
}
.dsh-proofread-dock .dsh-proofread-panel {
  position: absolute;
  top: var(--dsh-ext-panel-top, auto);
  right: 0;
  bottom: var(--dsh-ext-panel-bottom, calc(100% + 6px));
  z-index: 10;
  width: min(380px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
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
.dsh-proofread-panel {
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  color: var(--gray-12);
  background: var(--color-panel-solid);
}
.dsh-proofread-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--gray-6);
}
.dsh-proofread-panel-title {
  margin: 0;
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-medium);
  font-family: var(--default-font-family);
}
.dsh-proofread-panel-close {
  font: inherit; font-size: var(--font-size-2); min-height: 32px; color: var(--gray-11); background: none; border: none;
  border-radius: var(--radius-2); padding: 0 8px; cursor: pointer;
}
.dsh-proofread-panel-close:hover { color: var(--gray-12); background: var(--gray-a3); }
.dsh-proofread-panel-close:disabled { opacity: 0.5; cursor: default; }
.dsh-proofread-panel-body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
}
.dsh-proofread-input {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  box-sizing: border-box;
  font: inherit;
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  line-height: 1.7;
  color: var(--gray-12);
  background: var(--color-surface);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}
.dsh-proofread-panel-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.dsh-proofread-check {
  font: inherit;
  font-size: var(--font-size-2);
  min-height: var(--control-h, 34px);
  color: var(--accent-contrast);
  background: var(--accent-9);
  border: 1px solid var(--accent-9);
  border-radius: var(--radius-2);
  padding: 0 14px;
  cursor: pointer;
}
.dsh-proofread-check:hover:not(:disabled) { background: var(--accent-10); }
.dsh-proofread-check:disabled { opacity: 0.5; cursor: default; }
.dsh-proofread-cancel {
  font: inherit; font-size: var(--font-size-2); min-height: var(--control-h, 34px); color: var(--gray-11); background: none;
  border: 1px solid var(--gray-6); border-radius: var(--radius-2);
  padding: 0 12px; cursor: pointer;
}
.dsh-proofread-cancel:hover { background: var(--gray-a3); }
.dsh-proofread-hint { color: var(--gray-11); font-size: var(--font-size-2); margin-left: auto; }
.dsh-proofread-hint.dsh-proofread-is-over { color: var(--red-11); }
.dsh-proofread-status { color: var(--gray-11); padding: var(--space-2) 0; }
.dsh-proofread-error { color: var(--red-11); padding: var(--space-2) 0; }
.dsh-proofread-stale {
  color: var(--gray-11);
  background: var(--gray-a3);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}
.dsh-proofread-result { display: flex; flex-direction: column; gap: var(--space-2); }
.dsh-proofread-result-summary { color: var(--gray-11); font-weight: var(--font-weight-medium); }
.dsh-proofread-habits { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.dsh-proofread-habit {
  color: var(--gray-11);
  border: 1px solid var(--gray-6);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: var(--font-size-2);
}
.dsh-proofread-findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.dsh-proofread-finding {
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--color-surface);
}
.dsh-proofread-finding-head { display: flex; align-items: baseline; gap: var(--space-2); }
.dsh-proofread-finding-kind { font-weight: var(--font-weight-medium); color: var(--gray-11); }
.dsh-proofread-finding-pos { color: var(--gray-11); font-size: var(--font-size-2); margin-left: auto; font-family: var(--code-font-family); }
.dsh-proofread-severity { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
.dsh-proofread-severity-error { background: var(--red-9); }
.dsh-proofread-severity-warning { background: var(--accent-9); }
.dsh-proofread-severity-info { background: var(--gray-9); }
.dsh-proofread-finding-message { color: var(--gray-12); }
.dsh-proofread-finding-excerpt {
  color: var(--gray-11);
  font-size: var(--font-size-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-proofread-finding-suggestion {
  color: var(--gray-11);
  background: var(--gray-3);
  border-radius: var(--radius-2);
  padding: 4px 8px;
}
.dsh-proofread-scope { color: var(--gray-11); font-size: var(--font-size-2); }
.dsh-proofread-finding-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.dsh-proofread-locate,
.dsh-proofread-ignore {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  background: var(--color-surface);
  color: var(--gray-11);
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: 0;
  box-shadow: none;
}
.dsh-proofread-ignore:hover {
  background: var(--gray-a3);
}
.dsh-proofread-locate {
  background: var(--accent-9);
  border-color: var(--accent-9);
  color: var(--accent-contrast);
}
/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden。 */
@keyframes dsh-proofread-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
.dsh-proofread-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; color: var(--accent-9); }
.dsh-proofread-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: dsh-proofread-activity-pulse 1.4s ease infinite; }
.dsh-proofread-dots i:nth-child(2) { animation-delay: .2s; }
.dsh-proofread-dots i:nth-child(3) { animation-delay: .4s; }
@media (prefers-reduced-motion: reduce) {
  .dsh-proofread-dock, .dsh-proofread-dock *, .dsh-proofread-panel, .dsh-proofread-panel * {
    animation: none !important; transition: none !important;
  }
  .dsh-proofread-dots i { animation: none; }
}
/* Keep the standalone dark-host selectors so specs and a DSH host without
   Theme still recognize the contract. Do not use prefers-color-scheme. */
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-dock,
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-toggle,
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-panel,
:root[data-theme="dark"] .dsh-proofread-dock,
:root[data-theme="dark"] .dsh-proofread-toggle,
:root[data-theme="dark"] .dsh-proofread-panel {
  color-scheme: dark;
}
`
