// One-shot stylesheet for the proofread dock. Colors come from the host
// `:root[data-theme]` tokens (paper/ink); fallbacks keep the panel readable in
// a bare host. Placement follows the host's --dsh-ext-* contract: a launcher
// rail pulls the dock inline and drops the open panel below the toggle; a
// bare host gets the legacy bottom-right dock with the panel opening upward.
// Host Dialog portals content outside .shell; those rules also target .dsh-ui.
export const proofreadClientStyles = `
.dsh-proofread-dock {
  position: var(--dsh-ext-dock-position, absolute);
  right: var(--dsh-ext-dock-right, var(--space-4, 16px));
  bottom: var(--dsh-ext-dock-bottom, var(--space-4, 16px));
  pointer-events: auto;
}
.dsh-proofread-toggle {
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
.dsh-proofread-toggle:hover { border-color: var(--accent, #1b365d); color: var(--accent, #1b365d); }
.dsh-proofread-toggle:focus-visible, .dsh-proofread-panel button:focus-visible, .dsh-proofread-input:focus-visible,
.dsh-ui.dsh-proofread-panel button:focus-visible, .dsh-ui.dsh-proofread-panel .dsh-proofread-input:focus-visible {
  outline: 2px solid var(--accent, #1b365d);
  outline-offset: 1px;
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
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-chrome, 13px);
  color: var(--fg, #141413);
  background: var(--surface, #fdfcf6);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-md, 8px);
  box-shadow: var(--elev-card, 0 10px 28px rgba(20, 20, 19, 0.08));
  overflow: hidden;
}
.dsh-ui.dsh-proofread-panel, .dsh-ui .dsh-proofread-panel {
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-chrome, 13px);
  color: var(--fg, #141413);
  background: var(--surface, #fdfcf6);
}
.dsh-proofread-panel-header, .dsh-ui .dsh-proofread-panel-header, .dsh-ui.dsh-proofread-panel .dsh-proofread-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  border-bottom: 1px solid var(--border-soft, #e5e3d8);
}
.dsh-proofread-panel-title, .dsh-ui .dsh-proofread-panel-title { margin: 0; font-size: var(--text-base, 14px); font-weight: 600; }
.dsh-proofread-panel-close, .dsh-ui .dsh-proofread-panel-close {
  font: inherit; font-size: var(--text-chrome, 13px); min-height: 32px; color: var(--meta, #6b6a64); background: none; border: none;
  border-radius: var(--radius-xs, 3px); padding: 0 8px; cursor: pointer;
}
.dsh-proofread-panel-close:hover, .dsh-ui .dsh-proofread-panel-close:hover { color: var(--fg, #141413); background: var(--surface-warm, #e8e6dc); }
.dsh-proofread-panel-close:disabled, .dsh-ui .dsh-proofread-panel-close:disabled { opacity: 0.5; cursor: default; }
.dsh-proofread-panel-body, .dsh-ui .dsh-proofread-panel-body {
  padding: var(--space-3, 12px);
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  overflow-y: auto;
}
.dsh-proofread-input, .dsh-ui .dsh-proofread-input {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  box-sizing: border-box;
  font: inherit;
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-chrome, 13px);
  line-height: 1.7;
  color: var(--fg, #141413);
  background: var(--bg, #f3f1e8);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
}
.dsh-proofread-panel-footer, .dsh-ui .dsh-proofread-panel-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
}
.dsh-proofread-check, .dsh-ui .dsh-proofread-check {
  font: inherit;
  font-size: var(--text-chrome, 13px);
  min-height: var(--control-h, 34px);
  color: var(--accent-on, #faf9f5);
  background: var(--accent, #1b365d);
  border: 1px solid var(--accent, #1b365d);
  border-radius: var(--radius-sm, 6px);
  padding: 0 14px;
  cursor: pointer;
}
.dsh-proofread-check:hover:not(:disabled), .dsh-ui .dsh-proofread-check:hover:not(:disabled) { background: var(--accent-active, #142a48); }
.dsh-proofread-check:disabled, .dsh-ui .dsh-proofread-check:disabled { opacity: 0.5; cursor: default; }
.dsh-proofread-cancel, .dsh-ui .dsh-proofread-cancel {
  font: inherit; font-size: var(--text-chrome, 13px); min-height: var(--control-h, 34px); color: var(--fg-2, #3d3d3a); background: none;
  border: 1px solid var(--border, #d8d5c7); border-radius: var(--radius-sm, 6px);
  padding: 0 12px; cursor: pointer;
}
.dsh-proofread-hint, .dsh-ui .dsh-proofread-hint { color: var(--meta, #6b6a64); font-size: var(--text-chrome, 13px); margin-left: auto; }
.dsh-proofread-hint.dsh-proofread-is-over, .dsh-ui .dsh-proofread-hint.dsh-proofread-is-over { color: var(--danger, #8a3a30); }
.dsh-proofread-status, .dsh-ui .dsh-proofread-status { color: var(--meta, #6b6a64); padding: var(--space-2, 8px) 0; }
.dsh-proofread-error, .dsh-ui .dsh-proofread-error { color: var(--danger, #8a3a30); padding: var(--space-2, 8px) 0; }
.dsh-proofread-stale, .dsh-ui .dsh-proofread-stale {
  color: var(--meta, #6b6a64);
  background: var(--surface-warm, #e8e6dc);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
}
.dsh-proofread-result, .dsh-ui .dsh-proofread-result { display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.dsh-proofread-result-summary, .dsh-ui .dsh-proofread-result-summary { color: var(--fg-2, #3d3d3a); font-weight: 600; }
.dsh-proofread-habits, .dsh-ui .dsh-proofread-habits { display: flex; flex-wrap: wrap; gap: var(--space-1, 4px); }
.dsh-proofread-habit, .dsh-ui .dsh-proofread-habit {
  color: var(--meta, #6b6a64);
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: var(--text-chrome, 13px);
}
.dsh-proofread-findings, .dsh-ui .dsh-proofread-findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.dsh-proofread-finding, .dsh-ui .dsh-proofread-finding {
  border: 1px solid var(--border-soft, #e5e3d8);
  border-radius: var(--radius-sm, 6px);
  padding: var(--space-2, 8px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-proofread-finding-head, .dsh-ui .dsh-proofread-finding-head { display: flex; align-items: baseline; gap: var(--space-2, 8px); }
.dsh-proofread-finding-kind, .dsh-ui .dsh-proofread-finding-kind { font-weight: 600; color: var(--fg-2, #3d3d3a); }
.dsh-proofread-finding-pos, .dsh-ui .dsh-proofread-finding-pos { color: var(--meta, #6b6a64); font-size: var(--text-chrome, 13px); margin-left: auto; font-family: var(--font-mono, monospace); }
.dsh-proofread-severity, .dsh-ui .dsh-proofread-severity { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
.dsh-proofread-severity-error, .dsh-ui .dsh-proofread-severity-error { background: var(--danger, #8a3a30); }
.dsh-proofread-severity-warning, .dsh-ui .dsh-proofread-severity-warning { background: var(--accent, #1b365d); }
.dsh-proofread-severity-info, .dsh-ui .dsh-proofread-severity-info { background: var(--ghost, #78756c); }
.dsh-proofread-finding-message, .dsh-ui .dsh-proofread-finding-message { color: var(--fg, #141413); }
.dsh-proofread-finding-excerpt, .dsh-ui .dsh-proofread-finding-excerpt {
  color: var(--meta, #6b6a64);
  font-size: var(--text-chrome, 13px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-proofread-finding-suggestion, .dsh-ui .dsh-proofread-finding-suggestion {
  color: var(--fg-2, #3d3d3a);
  background: var(--bg-sunken, #ebe9df);
  border-radius: var(--radius-xs, 3px);
  padding: 4px 8px;
}
.dsh-proofread-scope, .dsh-ui .dsh-proofread-scope { color: var(--meta, #6b6a64); font-size: var(--text-chrome, 13px); }
.dsh-proofread-finding-actions, .dsh-ui .dsh-proofread-finding-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.dsh-proofread-locate, .dsh-proofread-ignore,
.dsh-ui .dsh-proofread-locate, .dsh-ui .dsh-proofread-ignore,
.dsh-ui.file-dialog .dsh-proofread-locate, .dsh-ui.file-dialog .dsh-proofread-ignore {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-sm, 6px);
  background: var(--surface, #fdfcf6);
  color: var(--fg-2, #3d3d3a);
  cursor: pointer;
  font: 500 var(--text-xs, 11px)/1 var(--font-sans, system-ui, sans-serif);
  letter-spacing: 0;
  box-shadow: none;
}
.dsh-proofread-locate, .dsh-ui .dsh-proofread-locate, .dsh-ui.file-dialog .dsh-proofread-locate {
  background: var(--accent, #1b365d);
  border-color: var(--accent, #1b365d);
  color: var(--accent-on, #faf9f5);
}
@media (prefers-reduced-motion: reduce) {
  .dsh-proofread-dock, .dsh-proofread-dock *, .dsh-proofread-panel, .dsh-proofread-panel *,
  .dsh-ui.dsh-proofread-panel, .dsh-ui.dsh-proofread-panel * {
    animation: none !important; transition: none !important;
  }
}
/* Ordinary DSH dark: body[data-ds-dark-theme] (ui-theme). Scoped ink tokens inherit to all children.
   html:not([data-theme]) keeps desktop :root paper/ink in charge. prefers-color-scheme must not override explicit light. */
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-dock,
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-toggle,
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-panel,
html:not([data-theme]) body[data-ds-dark-theme] .dsh-ui.dsh-proofread-panel {
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
