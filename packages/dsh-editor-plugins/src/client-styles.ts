import { surfaceTokenAliases } from 'dsh-editor-seats/tokens'

export const pluginsClientStyles = `
.dsh-plugins,
.dsh-plugins-install-fallback,
.dsh-plugins-inspect {
${surfaceTokenAliases}
  font-family: var(--s-font);
  color: var(--s-text);
}
.dsh-plugins {
  display: grid;
  gap: var(--space-5);
  min-height: 0;
  padding-bottom: var(--space-2);
  line-height: 1.5;
  font-size: var(--font-size-2);
}
.dsh-plugins-intro {
  margin: 0;
  color: var(--s-muted);
  font-size: var(--font-size-2);
  line-height: 1.6;
}
.dsh-plugins-tabs {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0;
  padding: 4px;
  border: 0;
  border-radius: var(--s-radius-lg);
  background: var(--s-sunken);
  box-shadow: none;
  width: max-content;
}
.dsh-plugins-tabs button,
.dsh-plugins-tabs .rt-BaseButton {
  min-height: var(--s-control-sm);
  height: var(--s-control-sm);
  min-width: 0;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--s-radius-md);
  box-shadow: none;
  background: transparent;
  color: var(--s-muted);
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1.4 var(--s-font);
}
.dsh-plugins-tabs button[aria-selected="true"],
.dsh-plugins-tabs .rt-BaseButton[aria-selected="true"] {
  background: var(--s-raised);
  color: var(--s-text);
  box-shadow: none;
}
.dsh-plugins-search {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
}
.dsh-plugins-search input {
  flex: 1;
  min-width: 0;
  min-height: var(--s-control);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--s-radius-md);
  background: var(--s-bg);
  box-shadow: var(--s-elevate-soft);
  color: var(--s-text);
  font: inherit;
}
.dsh-plugins-search .ui-input {
  flex: 1;
  min-width: 0;
}
.dsh-plugins-search input:focus-visible,
.dsh-plugins button:focus-visible,
.dsh-plugins a:focus-visible {
  outline: 2px solid var(--s-accent);
  outline-offset: 2px;
}
.dsh-plugins-search button {
  width: auto;
  white-space: nowrap;
  flex: none;
}
.dsh-plugins-primary,
.dsh-plugins-ghost,
.rt-BaseButton.rt-Button.dsh-plugins-primary,
.rt-BaseButton.rt-Button.dsh-plugins-ghost {
  min-height: var(--s-control);
  padding: 0 var(--space-3);
  border-radius: var(--s-radius-md);
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--s-font);
}
.dsh-plugins-primary,
.rt-BaseButton.rt-variant-solid.dsh-plugins-primary {
  border: 0;
  background: var(--s-brand);
  color: var(--s-on-brand);
  box-shadow: none;
}
.dsh-plugins-primary:hover:not(:disabled),
.rt-BaseButton.rt-variant-solid.dsh-plugins-primary:hover:not(:disabled) { background: var(--s-brand-hover); }
.dsh-plugins-primary:disabled, .dsh-plugins-ghost:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.dsh-plugins-ghost {
  border: 0.5px solid var(--s-line-strong);
  background: var(--s-bg);
  color: var(--s-text);
  box-shadow: none;
}
.dsh-plugins-ghost:hover:not(:disabled) { background: var(--s-hover); }
.dsh-plugins-groups { display: grid; gap: var(--space-5); }
.dsh-plugins-group { display: grid; gap: var(--space-2); }
.dsh-plugins-group h3 {
  margin: 0;
  font: var(--dsh-ui-weight-strong, 600) var(--font-size-3)/1.5 var(--s-font);
  color: var(--s-text);
}
/* Raised rows match the shell's plugins-catalog rows. */
.dsh-plugins-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3);
  border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-xl);
  background: var(--s-raised);
  box-shadow: none;
}
.dsh-plugins-card:hover { background: var(--s-hover); }
.dsh-plugins-card-title { font: var(--font-weight-medium) var(--font-size-2)/1.4 var(--s-font); }
.dsh-plugins-card-desc, .dsh-plugins-meta {
  color: var(--s-muted);
  font-size: var(--font-size-1);
  line-height: 1.5;
}
.dsh-plugins-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.dsh-plugins button.dsh-plugins-switch,
.dsh-plugins .dsh-plugins-switch {
  all: unset;
  box-sizing: border-box;
  position: relative;
  display: inline-block;
  flex: none;
  width: 36px;
  height: 20px;
  min-width: 36px;
  min-height: 20px;
  max-width: 36px;
  max-height: 20px;
  border-radius: 999px;
  corner-shape: round;
  background: var(--s-track);
  box-shadow: none;
  color: transparent;
  overflow: hidden;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.dsh-plugins .dsh-plugins-switch.is-on {
  background: var(--s-track-on);
  box-shadow: none;
}
.dsh-plugins .dsh-plugins-switch:hover { background: var(--s-hover); }
.dsh-plugins .dsh-plugins-switch.is-on:hover { background: var(--s-accent-hover); }
.dsh-plugins .dsh-plugins-switch.is-pending { opacity: .7; cursor: wait; }
.dsh-plugins .dsh-plugins-switch:disabled { cursor: not-allowed; opacity: .7; }
.dsh-plugins .dsh-plugins-switch:focus-visible {
  outline: 2px solid var(--s-accent);
  outline-offset: 2px;
}
.dsh-plugins .dsh-plugins-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  corner-shape: round;
  background: var(--s-thumb);
  box-shadow: none;
  transition: transform 150ms ease;
}
.dsh-plugins .dsh-plugins-switch.is-on .dsh-plugins-switch-thumb { transform: translateX(16px); }
.dsh-plugins-core summary {
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1.4 var(--s-font);
  color: var(--s-muted);
}
.dsh-plugins-core-hint, .dsh-plugins-core-list {
  margin: var(--space-2) 0 0;
  color: var(--s-muted);
  font-size: var(--font-size-1);
  line-height: 1.5;
}
.dsh-plugins-core-list { padding-left: 1.1em; display: grid; gap: 6px; }
.dsh-plugins-core-list li { display: grid; gap: 2px; }
.dsh-plugins-locked { color: var(--s-muted); font-size: var(--font-size-1); }
.dsh-plugins-status, .dsh-plugins-empty { color: var(--s-muted); font-size: var(--font-size-2); }
.dsh-plugins-error {
  color: var(--s-danger);
  font-size: var(--font-size-2);
  display: grid;
  gap: 6px;
  padding-inline-start: var(--space-2);
  border-inline-start: 2px solid var(--s-danger);
}
.dsh-plugins-error-message { margin: 0; }
.dsh-plugins-error-detail summary { cursor: pointer; color: var(--s-muted); font-size: var(--font-size-1); }
.dsh-plugins-error-detail pre {
  margin: 6px 0 0;
  max-height: 8em;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font: 400 var(--font-size-1)/1.45 var(--s-mono);
  color: var(--s-muted);
}
.dsh-plugins-composition { margin-top: 4px; }
.dsh-plugins-composition summary { cursor: pointer; color: var(--s-muted); font-size: var(--font-size-1); line-height: 1.3; }
.dsh-plugins-composition ul { margin: 2px 0 0; padding-left: 1.1em; color: var(--s-muted); font-size: var(--font-size-1); line-height: 1.4; }
.dsh-plugins-card > .dsh-plugins-composition { grid-column: 1 / -1; min-width: 0; }
.dsh-plugins-spec { overflow-wrap: anywhere; max-width: 100%; color: var(--s-muted); font-size: var(--font-size-1); }
@media (max-width: 760px) {
  .dsh-plugins-card { grid-template-columns: minmax(0, 1fr); }
}
.dsh-plugins-note {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--s-radius-md);
  border-inline-start: 2px solid var(--s-accent);
  background: var(--s-accent-soft);
  color: var(--s-text);
  font-size: var(--font-size-2);
}
.dsh-plugins-stars { color: var(--s-muted); }
.dsh-plugins a {
  color: var(--s-accent);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  text-underline-offset: 3px;
}
.dsh-plugins a:hover,
.dsh-plugins a:focus-visible { text-decoration: underline dotted; }
.dsh-plugins-install-body {
  display: grid;
  gap: var(--space-3);
}
.dsh-plugins-install-body header,
.dsh-plugins-install-body footer { margin: 0; }
.dsh-plugins-install-body p { margin: 0; color: var(--s-muted); line-height: 1.55; }
.dsh-plugins-install-fallback {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 0;
  border-radius: var(--s-radius-panel);
  background: var(--s-raised);
  box-shadow: var(--s-elevate);
  color: var(--s-text);
}
.dsh-plugins-install-fallback h2 {
  margin: 0;
  font: var(--font-weight-medium) var(--font-size-4)/1.2 var(--s-font);
  color: var(--s-text);
}
.dsh-plugins-install-fallback footer,
.dsh-plugins-install-body footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.dsh-plugins-inspect {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-xl);
  background: var(--s-raised);
  box-shadow: none;
}
.dsh-plugins-inspect-blocked { border: 1px solid var(--s-danger); }
.dsh-plugins-inspect-warn { border: 1px solid var(--s-warning); }
.dsh-plugins-inspect-verdict { margin: 0; font: var(--font-weight-medium) var(--font-size-2)/1.5 var(--s-font); }
.dsh-plugins-findings { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
.dsh-plugins-finding { font-size: var(--font-size-1); line-height: 1.5; }
.dsh-plugins-finding-error { color: var(--s-danger); font-weight: var(--font-weight-medium); }
.dsh-plugins-finding-warning { color: var(--s-text); font-weight: var(--font-weight-medium); }
.dsh-plugins-finding-info { color: var(--s-muted); }
/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden,reduced-motion
   停掉循环,保留静态点与静态开关。 */
@keyframes dsh-plugins-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
.dsh-plugins-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; color: var(--s-accent); }
.dsh-plugins-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; corner-shape: round; background: currentColor; animation: dsh-plugins-activity-pulse 1.4s ease infinite; }
.dsh-plugins-dots i:nth-child(2) { animation-delay: .2s; }
.dsh-plugins-dots i:nth-child(3) { animation-delay: .4s; }
.dsh-plugins-switch.is-pending .dsh-plugins-switch-thumb { animation: dsh-plugins-activity-pulse 1.4s ease infinite; }
@media (prefers-reduced-motion: reduce) {
  .dsh-plugins, .dsh-plugins *, .dsh-plugins *::before, .dsh-plugins *::after {
    animation: none !important; transition: none !important;
  }
}
`
