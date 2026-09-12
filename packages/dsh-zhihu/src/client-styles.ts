// One-shot stylesheet for the zhihu dock. Colors come from the host
// `:root[data-theme]` tokens (paper/ink); fallbacks keep the panel readable in
// a bare host. Placement follows the host's --dsh-ext-* contract. Host Dialog
// portals content outside .shell; those rules also target .dsh-ui.
export const zhihuClientStyles = `
.zhihu-dock {
  position: var(--dsh-ext-dock-position, absolute);
  right: var(--dsh-ext-dock-right, var(--space-4, 16px));
  bottom: var(--dsh-ext-dock-bottom, calc(var(--space-4, 16px) + 44px));
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
  padding: 0 0 var(--space-2, 8px);
}
.zhihu-settings-embed .zhihu-panel-body {
  padding: var(--space-3, 12px) 0 0;
  overflow: visible;
}
.zhihu-toggle {
  pointer-events: auto;
  font: inherit;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-chrome, 13px);
  min-height: var(--control-h, 34px);
  color: var(--fg-2, #3d3d3a);
  background: var(--surface, #fdfcf6);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: 999px;
  padding: 0 14px;
  cursor: pointer;
  box-shadow: var(--elev-raised, 0 8px 24px rgba(20, 20, 19, 0.06));
}
.zhihu-toggle:hover { border-color: var(--accent, #1b365d); color: var(--accent, #1b365d); }
.zhihu-toggle:focus-visible, .zhihu-panel button:focus-visible, .zhihu-panel input:focus-visible,
.zhihu-panel select:focus-visible, .zhihu-panel a:focus-visible,
.dsh-ui.zhihu-panel button:focus-visible, .dsh-ui.zhihu-panel input:focus-visible,
.dsh-ui.zhihu-panel select:focus-visible, .dsh-ui.zhihu-panel a:focus-visible {
  outline: 2px solid var(--accent, #1b365d);
  outline-offset: 1px;
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
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-chrome, 13px);
  color: var(--fg, #141413);
  background: var(--surface, #fdfcf6);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-md, 8px);
  box-shadow: var(--elev-card, 0 10px 28px rgba(20, 20, 19, 0.08));
  overflow: hidden;
}
.dsh-ui.zhihu-panel, .dsh-ui .zhihu-panel {
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-chrome, 13px);
  color: var(--fg, #141413);
  background: var(--surface, #fdfcf6);
}
.zhihu-panel-header, .dsh-ui .zhihu-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  border-bottom: 1px solid var(--border-soft, #e5e3d8);
}
.zhihu-panel-title, .dsh-ui .zhihu-panel-title { margin: 0; font-size: var(--text-base, 14px); font-weight: 600; }
.zhihu-panel-close, .dsh-ui .zhihu-panel-close {
  font: inherit; font-size: var(--text-chrome, 13px); min-height: 32px; color: var(--meta, #6b6a64); background: none; border: none;
  border-radius: var(--radius-xs, 3px); padding: 0 8px; cursor: pointer;
}
.zhihu-panel-close:hover, .dsh-ui .zhihu-panel-close:hover { color: var(--fg, #141413); background: var(--surface-warm, #e8e6dc); }
.zhihu-panel-close:disabled, .dsh-ui .zhihu-panel-close:disabled { opacity: 0.5; cursor: default; }
.zhihu-tabs, .dsh-ui .zhihu-tabs {
  display: flex;
  gap: var(--space-1, 4px);
  padding: var(--space-2, 8px) var(--space-3, 12px) 0;
  border-bottom: 1px solid var(--border-soft, #e5e3d8);
}
.zhihu-tab, .dsh-ui .zhihu-tab {
  font: inherit;
  font-size: var(--text-chrome, 13px);
  min-height: 32px;
  color: var(--meta, #6b6a64);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 4px 8px;
  cursor: pointer;
}
.zhihu-tab:hover, .dsh-ui .zhihu-tab:hover { color: var(--fg, #141413); }
.zhihu-tab[aria-selected="true"], .dsh-ui .zhihu-tab[aria-selected="true"] { color: var(--accent, #1b365d); border-bottom-color: var(--accent, #1b365d); font-weight: 600; }
.zhihu-panel-body, .dsh-ui .zhihu-panel-body {
  padding: var(--space-3, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  overflow-y: auto;
}
.zhihu-field, .dsh-ui .zhihu-field { display: flex; flex-direction: column; gap: 4px; }
.zhihu-field-label, .dsh-ui .zhihu-field-label { color: var(--fg-2, #3d3d3a); font-weight: 600; }
.zhihu-input, .zhihu-select, .dsh-ui .zhihu-input, .dsh-ui .zhihu-select {
  width: 100%;
  min-height: var(--control-h, 34px);
  box-sizing: border-box;
  font: inherit;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-chrome, 13px);
  color: var(--fg, #141413);
  background: var(--bg, #f3f1e8);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-sm, 6px);
  padding: 0 8px;
}
.zhihu-row, .dsh-ui .zhihu-row { display: flex; align-items: center; gap: var(--space-2, 8px); }
.zhihu-button, .dsh-ui .zhihu-button {
  font: inherit; font-size: var(--text-chrome, 13px); min-height: var(--control-h, 34px); color: var(--fg-2, #3d3d3a); background: none;
  border: 1px solid var(--border, #d8d5c7); border-radius: var(--radius-sm, 6px);
  padding: 0 12px; cursor: pointer;
}
.zhihu-button:disabled, .dsh-ui .zhihu-button:disabled { opacity: 0.5; cursor: default; }
.zhihu-button-primary, .dsh-ui .zhihu-button-primary {
  color: var(--accent-on, #faf9f5);
  background: var(--accent, #1b365d);
  border-color: var(--accent, #1b365d);
}
.zhihu-button-primary:hover:not(:disabled), .dsh-ui .zhihu-button-primary:hover:not(:disabled) { background: var(--accent-active, #142a48); }
.zhihu-button-danger, .dsh-ui .zhihu-button-danger { color: var(--danger, #8a3a30); }
.zhihu-hint, .dsh-ui .zhihu-hint { color: var(--meta, #6b6a64); font-size: var(--text-chrome, 13px); margin: 0; }
.zhihu-status, .dsh-ui .zhihu-status { color: var(--meta, #6b6a64); margin: 0; padding: var(--space-2, 8px) 0; }
.zhihu-error, .dsh-ui .zhihu-error { color: var(--danger, #8a3a30); margin: 0; padding: var(--space-2, 8px) 0; }
.zhihu-warning, .dsh-ui .zhihu-warning { color: var(--danger, #8a3a30); margin: 0; }
.zhihu-saved, .dsh-ui .zhihu-saved { color: var(--accent, #1b365d); margin: 0; }
.zhihu-link, .dsh-ui .zhihu-link { color: var(--accent, #1b365d); }
.zhihu-stale, .dsh-ui .zhihu-stale {
  color: var(--meta, #6b6a64);
  background: var(--surface-warm, #e8e6dc);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
}
.zhihu-results, .dsh-ui .zhihu-results { display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.zhihu-results-summary, .dsh-ui .zhihu-results-summary { color: var(--fg-2, #3d3d3a); font-weight: 600; margin: 0; }
.zhihu-result-list, .dsh-ui .zhihu-result-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.zhihu-result-item, .dsh-ui .zhihu-result-item {
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.zhihu-result-title, .dsh-ui .zhihu-result-title { font-weight: 600; color: var(--fg, #141413); }
.zhihu-result-meta, .dsh-ui .zhihu-result-meta { color: var(--meta, #6b6a64); font-size: var(--text-chrome, 13px); }
.zhihu-result-summary, .dsh-ui .zhihu-result-summary { color: var(--fg-2, #3d3d3a); }
.zhihu-result-snippet, .dsh-ui .zhihu-result-snippet {
  color: var(--fg-2, #3d3d3a);
  background: var(--bg-sunken, #ebe9df);
  border-radius: var(--radius-xs, 3px);
  padding: 4px 8px;
}
.zhihu-ask-content, .dsh-ui .zhihu-ask-content { white-space: pre-wrap; line-height: 1.7; color: var(--fg, #141413); }
.zhihu-ask-reasoning, .dsh-ui .zhihu-ask-reasoning { color: var(--meta, #6b6a64); font-size: var(--text-chrome, 13px); }
.zhihu-status-grid, .dsh-ui .zhihu-status-grid { display: flex; gap: var(--space-2, 8px); margin: 0; align-items: baseline; }
.zhihu-status-label, .dsh-ui .zhihu-status-label { color: var(--fg-2, #3d3d3a); font-weight: 600; }
.zhihu-status-value, .dsh-ui .zhihu-status-value { margin: 0; display: flex; align-items: center; gap: 6px; }
.zhihu-dot, .dsh-ui .zhihu-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.zhihu-dot-configured, .dsh-ui .zhihu-dot-configured { background: var(--accent, #1b365d); }
.zhihu-dot-missing, .dsh-ui .zhihu-dot-missing { background: var(--ghost, #78756c); }
.zhihu-dot-locked, .dsh-ui .zhihu-dot-locked { background: var(--danger, #8a3a30); }
.zhihu-guide, .dsh-ui .zhihu-guide {
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
}
.zhihu-guide-title, .dsh-ui .zhihu-guide-title { margin: 0 0 4px; font-size: var(--text-chrome, 13px); font-weight: 600; }
.zhihu-guide-steps, .dsh-ui .zhihu-guide-steps { margin: 0; padding-left: 18px; color: var(--fg-2, #3d3d3a); }
.zhihu-scopes, .dsh-ui .zhihu-scopes { display: flex; gap: var(--space-3, 12px); flex-wrap: wrap; }
.zhihu-scope, .dsh-ui .zhihu-scope { display: flex; align-items: center; gap: 4px; color: var(--fg-2, #3d3d3a); }
.zhihu-chart, .dsh-ui .zhihu-chart { width: 100%; height: auto; display: block; }
.zhihu-chart-bar-ok, .dsh-ui .zhihu-chart-bar-ok { fill: var(--accent, #1b365d); }
.zhihu-chart-bar-fail, .dsh-ui .zhihu-chart-bar-fail { fill: var(--danger, #8a3a30); }
.zhihu-chart-tick, .dsh-ui .zhihu-chart-tick { fill: var(--meta, #6b6a64); font-size: 13px; font-family: var(--font-mono, monospace); }
.zhihu-file, .dsh-ui .zhihu-file {
  font: inherit;
  font-size: var(--text-chrome, 13px);
  color: var(--fg-2, #3d3d3a);
}
.zhihu-upload-confirm, .dsh-ui .zhihu-upload-confirm {
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
  color: var(--fg-2, #3d3d3a);
}
@media (prefers-reduced-motion: reduce) {
  .zhihu-dock, .zhihu-dock *, .zhihu-panel, .zhihu-panel *,
  .dsh-ui.zhihu-panel, .dsh-ui.zhihu-panel * {
    animation: none !important; transition: none !important;
  }
}
/* Ordinary DSH dark: body[data-ds-dark-theme] (ui-theme). Scoped ink tokens inherit to all children.
   html:not([data-theme]) keeps desktop :root paper/ink in charge. prefers-color-scheme must not override explicit light. */
html:not([data-theme]) body[data-ds-dark-theme] .zhihu-dock,
html:not([data-theme]) body[data-ds-dark-theme] .zhihu-toggle,
html:not([data-theme]) body[data-ds-dark-theme] .zhihu-panel,
html:not([data-theme]) body[data-ds-dark-theme] .dsh-ui.zhihu-panel {
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
  color-scheme: dark;
}
`
