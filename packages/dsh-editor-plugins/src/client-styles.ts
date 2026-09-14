export const pluginsClientStyles = `
/* Dark host fallback: mirror the shell ink tokens (docs/ui.md table) for every
   colour these styles reference, on the :root[data-theme] contract only.
   Inside the shell the same values already apply at :root; standalone, a
   data-theme="ink" host stays readable instead of falling back to paper. */
:root[data-theme="ink"] {
  --bg: #161310;
  --bg-sunken: #100e0b;
  --surface: #221e18;
  --surface-warm: #2c2820;
  --fg: #ede7d7;
  --fg-2: #cdc7b8;
  --muted: #a8a294;
  --meta: #8f897b;
  --border: #3d382f;
  --border-soft: #2a261f;
  --hairline: rgba(237, 231, 215, 0.07);
  --hairline-strong: rgba(237, 231, 215, 0.14);
  --accent: #9db4d0;
  --accent-soft: rgba(157, 180, 208, 0.16);
  --accent-on: #161310;
  --accent-active: #b6c9e0;
  --ghost: #8f897b;
  --danger: #c4786a;
  --confirm: #8aaa70;
  --focus-ring: 0 0 0 2px var(--accent-active);
  color-scheme: dark;
}
.dsh-plugins {
  display: grid;
  gap: var(--space-4, 16px);
  min-height: 0;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--fg, #141413);
  font-size: var(--text-chrome, 13px);
}
.dsh-plugins-intro {
  margin: 0;
  color: var(--muted, #504e49);
  font-size: var(--text-sm, 13px);
  line-height: 1.6;
}
.dsh-plugins-tabs,
.dsh-ui .dsh-plugins-tabs[role="tablist"],
.dsh-ui.file-dialog .dsh-plugins-tabs[role="tablist"] {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-md, 8px);
  background: var(--bg-sunken, #ebe9df);
  box-shadow: var(--elev-ring, inset 0 0 0 1px var(--hairline, rgba(20,20,19,.08)));
  width: max-content;
}
.dsh-plugins-tabs button,
.dsh-ui.file-dialog .dsh-plugins-tabs button,
.dsh-ui .dsh-plugins-tabs button {
  min-height: 28px;
  min-width: 0;
  padding: 0 var(--space-3, 12px);
  border: 0;
  border-radius: var(--radius-sm, 6px);
  box-shadow: none;
  background: transparent;
  color: var(--fg-2, #3d3d3a);
  cursor: pointer;
  font: 500 var(--text-sm, 13px)/1 var(--font-sans, system-ui, sans-serif);
}
.dsh-plugins-tabs button[aria-selected="true"],
.dsh-ui.file-dialog .dsh-plugins-tabs button[aria-selected="true"],
.dsh-ui .dsh-plugins-tabs button[aria-selected="true"] {
  background: var(--surface, #fdfcf6);
  color: var(--fg, #141413);
  box-shadow: var(--elev-ring, inset 0 0 0 1px var(--hairline, rgba(20,20,19,.08)));
}
.dsh-plugins-search,
.dsh-ui .dsh-plugins-search,
.dsh-ui.file-dialog .dsh-plugins-search {
  display: flex;
  gap: var(--space-2, 8px);
  min-width: 0;
}
.dsh-plugins-search input {
  flex: 1;
  min-width: 0;
  min-height: 32px;
  padding: 0 var(--space-3, 12px);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-sm, 6px);
  background: var(--surface, #fdfcf6);
  color: inherit;
  font: inherit;
}
.dsh-plugins-search input:focus-visible, .dsh-plugins button:focus-visible {
  box-shadow: var(--focus-ring, 0 0 0 2px var(--accent-active, #142a48));
}
.dsh-plugins-search button,
.dsh-ui .dsh-plugins-search button,
.dsh-ui.file-dialog .dsh-plugins-search button {
  width: auto;
  white-space: nowrap;
  flex: none;
}
.dsh-plugins-primary, .dsh-plugins-ghost,
.dsh-ui.file-dialog .dsh-plugins-primary, .dsh-ui.file-dialog .dsh-plugins-ghost,
.dsh-ui .dsh-plugins-primary, .dsh-ui .dsh-plugins-ghost {
  min-height: 32px;
  padding: 0 var(--space-3, 12px);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  font: 500 var(--text-sm, 13px)/1 var(--font-sans, system-ui, sans-serif);
  letter-spacing: .04em;
}
.dsh-plugins-primary,
.dsh-ui.file-dialog .dsh-plugins-primary,
.dsh-ui .dsh-plugins-primary {
  border: 0;
  background: var(--accent, #1b365d);
  color: var(--accent-on, #faf9f5);
  box-shadow: none;
}
.dsh-plugins-primary:disabled, .dsh-plugins-ghost:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.dsh-plugins-ghost {
  border: 1px solid var(--border, #d8d5c7);
  background: var(--surface, #fdfcf6);
  color: var(--fg-2, #3d3d3a);
}
.dsh-plugins-group { display: grid; gap: var(--space-2, 8px); }
.dsh-plugins-group h3 {
  margin: 0;
  font: 600 var(--text-sm, 13px)/1.4 var(--font-sans, system-ui, sans-serif);
  letter-spacing: .04em;
  color: var(--meta, #6b6a64);
}
.dsh-plugins-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2, 8px) var(--space-3, 12px);
  padding: var(--space-3, 12px);
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-md, 8px);
  background: var(--surface, #fdfcf6);
  transition: background-color var(--motion-fast, 150ms) var(--ease, ease);
}
.dsh-plugins-card:hover { background: var(--surface-warm, #e8e6dc); }
.dsh-plugins-card-title { font: 600 var(--text-sm, 13px)/1.4 var(--font-sans, system-ui, sans-serif); }
.dsh-plugins-card-desc, .dsh-plugins-meta {
  color: var(--muted, #504e49);
  font-size: var(--text-xs, 11px);
  line-height: 1.5;
}
.dsh-plugins-actions { display: flex; align-items: start; gap: var(--space-2, 8px); }
.dsh-plugins-switch,
.dsh-ui .dsh-plugins-switch,
.dsh-ui.file-dialog .dsh-plugins-switch,
.dsh-ui.file-dialog button.dsh-plugins-switch {
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
  border: 1px solid var(--border, #d8d5c7);
  border-radius: 999px;
  background: var(--bg-sunken, #ebe9df);
  box-shadow: none;
  color: transparent;
  letter-spacing: 0;
  cursor: pointer;
  appearance: none;
  transform: none;
}
.dsh-plugins-switch.is-on,
.dsh-ui .dsh-plugins-switch.is-on,
.dsh-ui.file-dialog .dsh-plugins-switch.is-on,
.dsh-ui.file-dialog button.dsh-plugins-switch.is-on {
  background: var(--accent, #1b365d);
  border-color: var(--accent, #1b365d);
}
.dsh-plugins-switch:hover,
.dsh-ui.file-dialog .dsh-plugins-switch:hover,
.dsh-ui.file-dialog button.dsh-plugins-switch:hover {
  background: var(--bg-sunken, #ebe9df);
}
.dsh-plugins-switch.is-on:hover,
.dsh-ui.file-dialog .dsh-plugins-switch.is-on:hover,
.dsh-ui.file-dialog button.dsh-plugins-switch.is-on:hover {
  background: var(--accent, #1b365d);
}
.dsh-plugins-switch:active,
.dsh-ui .dsh-plugins-switch:active,
.dsh-ui.file-dialog .dsh-plugins-switch:active {
  transform: none;
}
.dsh-plugins-switch.is-mixed {
  background: color-mix(in srgb, var(--accent, #1b365d) 45%, var(--bg-sunken, #ebe9df));
  border-color: var(--accent, #1b365d);
}
.dsh-plugins-switch.is-pending { opacity: .7; cursor: wait; }
.dsh-plugins-switch:disabled { cursor: not-allowed; opacity: .7; }
.dsh-plugins-switch:focus-visible {
  box-shadow: var(--focus-ring, 0 0 0 2px var(--accent-active, #142a48));
}
.dsh-plugins-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--surface, #fdfcf6);
  box-shadow: 0 1px 2px rgba(20, 20, 19, 0.18);
  transition: transform var(--motion-fast, 150ms) var(--ease, ease);
}
.dsh-plugins-switch.is-on .dsh-plugins-switch-thumb { transform: translateX(16px); }
.dsh-plugins-switch.is-mixed .dsh-plugins-switch-thumb { transform: translateX(8px); }
.dsh-plugins-core summary {
  cursor: pointer;
  font: 600 var(--text-sm, 13px)/1.4 var(--font-sans, system-ui, sans-serif);
  color: var(--meta, #6b6a64);
}
.dsh-plugins-core-hint, .dsh-plugins-core-list {
  margin: var(--space-2, 8px) 0 0;
  color: var(--muted, #504e49);
  font-size: var(--text-xs, 11px);
  line-height: 1.5;
}
.dsh-plugins-core-list { padding-left: 1.1em; display: grid; gap: 6px; }
.dsh-plugins-core-list li { display: grid; gap: 2px; }
.dsh-plugins-locked { color: var(--meta, #6b6a64); font-size: 11px; }
.dsh-plugins-status, .dsh-plugins-empty { color: var(--muted, #504e49); font-size: var(--text-sm, 13px); }
.dsh-plugins-error { color: var(--danger, #8a3a30); font-size: var(--text-sm, 13px); display: grid; gap: 6px; }
.dsh-plugins-error-message { margin: 0; }
.dsh-plugins-error-detail summary { cursor: pointer; color: var(--muted, #504e49); font-size: var(--text-xs, 11px); }
.dsh-plugins-error-detail pre {
  margin: 6px 0 0;
  max-height: 8em;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font: 400 11px/1.45 var(--font-mono, ui-monospace, monospace);
  color: var(--fg-2, #3d3d3a);
}
.dsh-plugins-composition { margin-top: 4px; }
.dsh-plugins-composition summary { cursor: pointer; color: var(--meta, #6b6a64); font-size: 11px; line-height: 1.3; }
.dsh-plugins-composition ul { margin: 2px 0 0; padding-left: 1.1em; color: var(--muted, #504e49); font-size: 11px; line-height: 1.4; }
.dsh-plugins-note {
  margin: 0;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  border-radius: var(--radius-sm, 6px);
  background: var(--accent-soft, rgba(27,54,93,.08));
  color: var(--accent, #1b365d);
  font-size: var(--text-sm, 13px);
}
.dsh-plugins-stars { color: var(--meta, #6b6a64); }
.dsh-plugins a { color: var(--accent, #1b365d); }
.dsh-plugins a:focus-visible {
  box-shadow: var(--focus-ring, 0 0 0 2px var(--accent-active, #142a48));
}
.dsh-plugins-install-body {
  display: grid;
  gap: var(--space-3, 12px);
}
.dsh-plugins-install-body header,
.dsh-plugins-install-body footer { margin: 0; }
.dsh-plugins-install-body p { margin: 0; color: var(--muted, #504e49); line-height: 1.55; }
.dsh-plugins-install-fallback {
  display: grid;
  gap: var(--space-3, 12px);
  padding: var(--space-3, 12px);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-md, 8px);
  background: var(--surface, #fdfcf6);
  color: var(--fg, #141413);
}
.dsh-plugins-install-fallback h2 {
  margin: 0;
  font: 500 20px/1.2 var(--font-serif, Georgia, 'Noto Serif', serif);
  letter-spacing: -.02em;
  color: var(--fg, #141413);
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
  gap: var(--space-2, 8px);
  padding: var(--space-3, 12px);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-md, 8px);
  background: var(--surface, #fdfcf6);
}
.dsh-plugins-inspect-blocked { border-color: var(--danger, #8a3a30); }
.dsh-plugins-inspect-warn {
  border-color: color-mix(in srgb, var(--accent, #1b365d) 40%, var(--border, #d8d5c7));
}
.dsh-plugins-inspect-verdict { margin: 0; font: 600 var(--text-sm, 13px)/1.5 var(--font-sans, system-ui, sans-serif); }
.dsh-plugins-findings { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
.dsh-plugins-finding { font-size: var(--text-xs, 11px); line-height: 1.5; }
.dsh-plugins-finding-error { color: var(--danger, #8a3a30); }
.dsh-plugins-finding-warning { color: var(--fg-2, #3d3d3a); }
.dsh-plugins-finding-info { color: var(--muted, #504e49); }
/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden,reduced-motion
   停掉循环,保留静态点与静态开关。 */
@keyframes dsh-plugins-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
.dsh-plugins-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; }
.dsh-plugins-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: dsh-plugins-activity-pulse 1.4s var(--ease-smooth-out, ease) infinite; }
.dsh-plugins-dots i:nth-child(2) { animation-delay: .2s; }
.dsh-plugins-dots i:nth-child(3) { animation-delay: .4s; }
.dsh-plugins-switch.is-pending .dsh-plugins-switch-thumb { animation: dsh-plugins-activity-pulse 1.4s var(--ease-smooth-out, ease) infinite; }
@media (prefers-reduced-motion: reduce) {
  .dsh-plugins, .dsh-plugins *, .dsh-plugins *::before, .dsh-plugins *::after {
    animation: none !important; transition: none !important;
  }
}
`
