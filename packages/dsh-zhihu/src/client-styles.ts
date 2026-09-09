// One-shot stylesheet for the zhihu dock. Colors come from the host
// `:root[data-theme]` tokens (paper/ink, light and dark); fallbacks keep the
// panel readable in a bare host. Placement follows the host's --dsh-ext-*
// contract: a launcher rail pulls the dock inline and drops the open panel
// below the toggle; a bare host keeps the legacy bottom-right dock (offset
// above the proofread dock) with the panel opening upward.
export const zhihuClientStyles = `
.zhihu-dock {
  position: var(--dsh-ext-dock-position, absolute);
  right: var(--dsh-ext-dock-right, var(--space-4, 16px));
  bottom: var(--dsh-ext-dock-bottom, calc(var(--space-4, 16px) + 44px));
  pointer-events: auto;
}
.zhihu-toggle {
  pointer-events: auto;
  font: inherit;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-sm, 12px);
  color: var(--fg-2, #3d3d3a);
  background: var(--surface, #fdfcf6);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
  box-shadow: var(--elev-raised, 0 8px 24px rgba(20, 20, 19, 0.06));
}
.zhihu-toggle:hover { border-color: var(--accent, #1b365d); color: var(--accent, #1b365d); }
.zhihu-toggle:focus-visible, .zhihu-panel button:focus-visible, .zhihu-panel input:focus-visible,
.zhihu-panel select:focus-visible, .zhihu-panel a:focus-visible {
  outline: 2px solid var(--accent, #1b365d);
  outline-offset: 1px;
}
.zhihu-panel {
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
  font-size: var(--text-sm, 12px);
  color: var(--fg, #141413);
  background: var(--surface, #fdfcf6);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-md, 8px);
  box-shadow: var(--elev-card, 0 10px 28px rgba(20, 20, 19, 0.08));
  overflow: hidden;
}
.zhihu-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  border-bottom: 1px solid var(--border-soft, #e5e3d8);
}
.zhihu-panel-title { margin: 0; font-size: var(--text-base, 14px); font-weight: 600; }
.zhihu-panel-close {
  font: inherit; color: var(--meta, #6b6a64); background: none; border: none;
  border-radius: var(--radius-xs, 3px); padding: 2px 8px; cursor: pointer;
}
.zhihu-panel-close:hover { color: var(--fg, #141413); background: var(--surface-warm, #e8e6dc); }
.zhihu-tabs {
  display: flex;
  gap: var(--space-1, 4px);
  padding: var(--space-2, 8px) var(--space-3, 12px) 0;
  border-bottom: 1px solid var(--border-soft, #e5e3d8);
}
.zhihu-tab {
  font: inherit;
  color: var(--meta, #6b6a64);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 4px 8px;
  cursor: pointer;
}
.zhihu-tab:hover { color: var(--fg, #141413); }
.zhihu-tab[aria-selected="true"] { color: var(--accent, #1b365d); border-bottom-color: var(--accent, #1b365d); font-weight: 600; }
.zhihu-panel-body {
  padding: var(--space-3, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  overflow-y: auto;
}
.zhihu-field { display: flex; flex-direction: column; gap: 4px; }
.zhihu-field-label { color: var(--fg-2, #3d3d3a); font-weight: 600; }
.zhihu-input, .zhihu-select {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--fg, #141413);
  background: var(--bg, #f3f1e8);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-sm, 6px);
  padding: 6px 8px;
}
.zhihu-row { display: flex; align-items: center; gap: var(--space-2, 8px); }
.zhihu-button {
  font: inherit; color: var(--fg-2, #3d3d3a); background: none;
  border: 1px solid var(--border, #d8d5c7); border-radius: var(--radius-sm, 6px);
  padding: 5px 12px; cursor: pointer;
}
.zhihu-button:disabled { opacity: 0.5; cursor: default; }
.zhihu-button-primary {
  color: var(--accent-on, #faf9f5);
  background: var(--accent, #1b365d);
  border-color: var(--accent, #1b365d);
}
.zhihu-button-primary:hover:not(:disabled) { background: var(--accent-active, #142a48); }
.zhihu-button-danger { color: var(--danger, #8a3a30); }
.zhihu-hint { color: var(--meta, #6b6a64); font-size: var(--text-xs, 11px); margin: 0; }
.zhihu-status { color: var(--meta, #6b6a64); margin: 0; padding: var(--space-2, 8px) 0; }
.zhihu-error { color: var(--danger, #8a3a30); margin: 0; padding: var(--space-2, 8px) 0; }
.zhihu-warning { color: var(--danger, #8a3a30); margin: 0; }
.zhihu-saved { color: var(--accent, #1b365d); margin: 0; }
.zhihu-link { color: var(--accent, #1b365d); }
.zhihu-stale {
  color: var(--meta, #6b6a64);
  background: var(--surface-warm, #e8e6dc);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
}
.zhihu-results { display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.zhihu-results-summary { color: var(--fg-2, #3d3d3a); font-weight: 600; margin: 0; }
.zhihu-result-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.zhihu-result-item {
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.zhihu-result-title { font-weight: 600; color: var(--fg, #141413); }
.zhihu-result-meta { color: var(--meta, #6b6a64); font-size: var(--text-xs, 11px); }
.zhihu-result-summary { color: var(--fg-2, #3d3d3a); }
.zhihu-result-snippet {
  color: var(--fg-2, #3d3d3a);
  background: var(--bg-sunken, #ebe9df);
  border-radius: var(--radius-xs, 3px);
  padding: 4px 8px;
}
.zhihu-ask-content { white-space: pre-wrap; line-height: 1.7; color: var(--fg, #141413); }
.zhihu-ask-reasoning { color: var(--meta, #6b6a64); font-size: var(--text-xs, 11px); }
.zhihu-status-grid { display: flex; gap: var(--space-2, 8px); margin: 0; align-items: baseline; }
.zhihu-status-label { color: var(--fg-2, #3d3d3a); font-weight: 600; }
.zhihu-status-value { margin: 0; display: flex; align-items: center; gap: 6px; }
.zhihu-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.zhihu-dot-configured { background: var(--accent, #1b365d); }
.zhihu-dot-missing { background: var(--ghost, #78756c); }
.zhihu-dot-locked { background: var(--danger, #8a3a30); }
.zhihu-guide {
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
}
.zhihu-guide-title { margin: 0 0 4px; font-size: var(--text-sm, 12px); font-weight: 600; }
.zhihu-guide-steps { margin: 0; padding-left: 18px; color: var(--fg-2, #3d3d3a); }
.zhihu-scopes { display: flex; gap: var(--space-3, 12px); flex-wrap: wrap; }
.zhihu-scope { display: flex; align-items: center; gap: 4px; color: var(--fg-2, #3d3d3a); }
.zhihu-chart { width: 100%; height: auto; display: block; }
.zhihu-chart-bar-ok { fill: var(--accent, #1b365d); }
.zhihu-chart-bar-fail { fill: var(--danger, #8a3a30); }
.zhihu-chart-tick { fill: var(--meta, #6b6a64); font-size: 9px; font-family: var(--font-mono, monospace); }
.zhihu-file {
  font: inherit;
  color: var(--fg-2, #3d3d3a);
}
.zhihu-upload-confirm {
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
  color: var(--fg-2, #3d3d3a);
}
`
