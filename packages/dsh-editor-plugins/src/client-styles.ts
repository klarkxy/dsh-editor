export const pluginsClientStyles = `
.dsh-plugins {
  display: grid;
  gap: var(--space-4);
  min-height: 0;
  font-family: var(--default-font-family);
  color: var(--gray-12);
  font-size: var(--font-size-2);
}
.dsh-plugins-intro {
  margin: 0;
  color: var(--gray-11);
  font-size: var(--font-size-2);
  line-height: 1.6;
}
.dsh-plugins-tabs {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-3);
  background: var(--gray-3);
  box-shadow: 0 0 0 1px var(--gray-a5);
  width: max-content;
}
.dsh-plugins-tabs button {
  min-height: 28px;
  min-width: 0;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-2);
  box-shadow: none;
  background: transparent;
  color: var(--gray-11);
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
}
.dsh-plugins-tabs button[aria-selected="true"] {
  background: var(--accent-a3);
  color: var(--accent-11);
  box-shadow: 0 0 0 1px var(--gray-a5);
}
.dsh-plugins-search {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
}
.dsh-plugins-search input {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  background: var(--color-surface);
  color: inherit;
  font: inherit;
}
.dsh-plugins-search .ui-input {
  flex: 1;
  min-width: 0;
}
.dsh-plugins-search input:focus-visible, .dsh-plugins button:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-a8);
}
.dsh-plugins-search button {
  width: auto;
  white-space: nowrap;
  flex: none;
}
.dsh-plugins-primary,
.dsh-plugins-ghost {
  min-height: 32px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-2);
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: .04em;
}
.dsh-plugins-primary {
  border: 0;
  background: var(--accent-9);
  color: var(--accent-contrast);
  box-shadow: none;
}
.dsh-plugins-primary:disabled, .dsh-plugins-ghost:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.dsh-plugins-ghost {
  border: 1px solid var(--gray-6);
  background: var(--color-surface);
  color: var(--gray-11);
}
.dsh-plugins-ghost:hover {
  background: var(--gray-a3);
}
.dsh-plugins-group { display: grid; gap: var(--space-2); }
.dsh-plugins-group h3 {
  margin: 0;
  font: var(--font-weight-medium) var(--font-size-2)/1.4 var(--default-font-family);
  letter-spacing: .04em;
  color: var(--gray-11);
}
.dsh-plugins-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-3);
  background: var(--color-surface);
  transition: background-color 150ms ease;
}
.dsh-plugins-card:hover { background: var(--gray-a3); }
.dsh-plugins-card-title { font: var(--font-weight-medium) var(--font-size-2)/1.4 var(--default-font-family); }
.dsh-plugins-card-desc, .dsh-plugins-meta {
  color: var(--gray-11);
  font-size: var(--font-size-1);
  line-height: 1.5;
}
.dsh-plugins-actions { display: flex; align-items: start; gap: var(--space-2); }
.dsh-plugins-switch {
  position: relative;
  display: inline-block;
  flex: none;
  box-sizing: border-box;
  width: 36px;
  height: 20px;
  min-width: 36px;
  min-height: 20px;
  max-height: 20px;
  padding: 0;
  border: 1px solid var(--gray-6);
  border-radius: 999px;
  background: var(--gray-3);
  box-shadow: none;
  color: transparent;
  letter-spacing: 0;
  cursor: pointer;
  appearance: none;
  transform: none;
}
.dsh-plugins-switch.is-on {
  background: var(--accent-9);
  border-color: var(--accent-9);
}
.dsh-plugins-switch:hover {
  background: var(--gray-4);
}
.dsh-plugins-switch.is-on:hover {
  background: var(--accent-10);
}
.dsh-plugins-switch:active {
  transform: none;
}
.dsh-plugins-switch.is-pending { opacity: .7; cursor: wait; }
.dsh-plugins-switch:disabled { cursor: not-allowed; opacity: .7; }
.dsh-plugins-switch:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-a8);
}
.dsh-plugins-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--color-surface);
  box-shadow: var(--shadow-1);
  transition: transform 150ms ease;
}
.dsh-plugins-switch.is-on .dsh-plugins-switch-thumb { transform: translateX(16px); }
.dsh-plugins-core summary {
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1.4 var(--default-font-family);
  color: var(--gray-11);
}
.dsh-plugins-core-hint, .dsh-plugins-core-list {
  margin: var(--space-2) 0 0;
  color: var(--gray-11);
  font-size: var(--font-size-1);
  line-height: 1.5;
}
.dsh-plugins-core-list { padding-left: 1.1em; display: grid; gap: 6px; }
.dsh-plugins-core-list li { display: grid; gap: 2px; }
.dsh-plugins-locked { color: var(--gray-11); font-size: var(--font-size-1); }
.dsh-plugins-status, .dsh-plugins-empty { color: var(--gray-11); font-size: var(--font-size-2); }
.dsh-plugins-error { color: var(--red-11); font-size: var(--font-size-2); display: grid; gap: 6px; }
.dsh-plugins-error-message { margin: 0; }
.dsh-plugins-error-detail summary { cursor: pointer; color: var(--gray-11); font-size: var(--font-size-1); }
.dsh-plugins-error-detail pre {
  margin: 6px 0 0;
  max-height: 8em;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font: 400 var(--font-size-1)/1.45 var(--code-font-family);
  color: var(--gray-11);
}
.dsh-plugins-composition { margin-top: 4px; }
.dsh-plugins-composition summary { cursor: pointer; color: var(--gray-11); font-size: var(--font-size-1); line-height: 1.3; }
.dsh-plugins-composition ul { margin: 2px 0 0; padding-left: 1.1em; color: var(--gray-11); font-size: var(--font-size-1); line-height: 1.4; }
.dsh-plugins-note {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-2);
  background: var(--accent-a3);
  color: var(--accent-11);
  font-size: var(--font-size-2);
}
.dsh-plugins-stars { color: var(--gray-11); }
.dsh-plugins a { color: var(--accent-11); }
.dsh-plugins a:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-a8);
}
.dsh-plugins-install-body {
  display: grid;
  gap: var(--space-3);
}
.dsh-plugins-install-body header,
.dsh-plugins-install-body footer { margin: 0; }
.dsh-plugins-install-body p { margin: 0; color: var(--gray-11); line-height: 1.55; }
.dsh-plugins-install-fallback {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-3);
  background: var(--color-surface);
  color: var(--gray-12);
}
.dsh-plugins-install-fallback h2 {
  margin: 0;
  font: var(--font-weight-medium) var(--font-size-5)/1.2 var(--default-font-family);
  letter-spacing: -.02em;
  color: var(--gray-12);
}
.dsh-plugins-install-fallback footer,
.dsh-plugins-install-body footer {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  flex-wrap: wrap;
}
.dsh-plugins-inspect {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-3);
  background: var(--color-surface);
}
.dsh-plugins-inspect-blocked { border-color: var(--red-9); }
.dsh-plugins-inspect-warn {
  border-color: var(--amber-a8);
}
.dsh-plugins-inspect-verdict { margin: 0; font: var(--font-weight-medium) var(--font-size-2)/1.5 var(--default-font-family); }
.dsh-plugins-findings { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
.dsh-plugins-finding { font-size: var(--font-size-1); line-height: 1.5; }
.dsh-plugins-finding-error { color: var(--red-11); }
.dsh-plugins-finding-warning { color: var(--gray-11); }
.dsh-plugins-finding-info { color: var(--gray-11); }
/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden,reduced-motion
   停掉循环,保留静态点与静态开关。 */
@keyframes dsh-plugins-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
.dsh-plugins-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; color: var(--accent-9); }
.dsh-plugins-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: dsh-plugins-activity-pulse 1.4s ease infinite; }
.dsh-plugins-dots i:nth-child(2) { animation-delay: .2s; }
.dsh-plugins-dots i:nth-child(3) { animation-delay: .4s; }
.dsh-plugins-switch.is-pending .dsh-plugins-switch-thumb { animation: dsh-plugins-activity-pulse 1.4s ease infinite; }
@media (prefers-reduced-motion: reduce) {
  .dsh-plugins, .dsh-plugins *, .dsh-plugins *::before, .dsh-plugins *::after {
    animation: none !important; transition: none !important;
  }
}
`
