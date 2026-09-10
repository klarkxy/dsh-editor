export const pluginsClientStyles = `
.dsh-plugins {
  display: grid;
  gap: var(--space-4, 16px);
  min-height: 0;
  font-family: var(--font-sans, system-ui, sans-serif);
  color: var(--fg, #141413);
}
.dsh-plugins-intro {
  margin: 0;
  color: var(--muted, #504e49);
  font-size: var(--text-sm, 12px);
  line-height: 1.6;
}
.dsh-plugins-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-md, 8px);
  background: var(--bg-sunken, #ebe9df);
  box-shadow: var(--elev-ring, inset 0 0 0 1px var(--hairline, rgba(20,20,19,.08)));
  width: max-content;
}
.dsh-plugins-tabs button {
  min-height: 28px;
  padding: 0 var(--space-3, 12px);
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--fg-2, #3d3d3a);
  cursor: pointer;
  font: 500 var(--text-sm, 12px)/1 var(--font-sans, system-ui, sans-serif);
}
.dsh-plugins-tabs button[aria-selected="true"] {
  background: var(--surface, #fdfcf6);
  color: var(--fg, #141413);
}
.dsh-plugins-search, .dsh-plugins-spec {
  display: flex;
  gap: var(--space-2, 8px);
  min-width: 0;
}
.dsh-plugins-search input, .dsh-plugins-spec input {
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
.dsh-plugins-search input:focus-visible, .dsh-plugins-spec input:focus-visible, .dsh-plugins button:focus-visible {
  outline: 2px solid var(--accent, #1b365d);
  outline-offset: 1px;
}
.dsh-plugins-primary, .dsh-plugins-ghost {
  min-height: 32px;
  padding: 0 var(--space-3, 12px);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  font: 500 var(--text-sm, 12px)/1 var(--font-sans, system-ui, sans-serif);
}
.dsh-plugins-primary {
  border: 0;
  background: var(--accent, #1b365d);
  color: var(--accent-on, #faf9f5);
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
  font: 600 var(--text-sm, 12px)/1.4 var(--font-sans, system-ui, sans-serif);
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
}
.dsh-plugins-card-title { font: 600 var(--text-sm, 12px)/1.4 var(--font-sans, system-ui, sans-serif); }
.dsh-plugins-card-desc, .dsh-plugins-meta {
  color: var(--muted, #504e49);
  font-size: var(--text-xs, 11px);
  line-height: 1.5;
}
.dsh-plugins-actions { display: flex; align-items: start; gap: var(--space-2, 8px); }
.dsh-plugins-toggle {
  min-width: 44px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border, #d8d5c7);
  border-radius: 999px;
  background: var(--bg-sunken, #ebe9df);
  color: var(--fg-2, #3d3d3a);
  cursor: pointer;
  font: 500 11px/1 var(--font-sans, system-ui, sans-serif);
}
.dsh-plugins-toggle[aria-pressed="true"] {
  background: var(--accent-soft, rgba(27,54,93,.08));
  border-color: var(--accent, #1b365d);
  color: var(--accent, #1b365d);
}
.dsh-plugins-toggle:disabled { cursor: not-allowed; opacity: .7; }
.dsh-plugins-locked { color: var(--meta, #6b6a64); font-size: 11px; }
.dsh-plugins-status, .dsh-plugins-empty { color: var(--muted, #504e49); font-size: var(--text-sm, 12px); }
.dsh-plugins-error { color: var(--danger, #8a3a30); font-size: var(--text-sm, 12px); }
.dsh-plugins-note {
  margin: 0;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  border-radius: var(--radius-sm, 6px);
  background: var(--accent-soft, rgba(27,54,93,.08));
  color: var(--accent, #1b365d);
  font-size: var(--text-sm, 12px);
}
.dsh-plugins-stars { color: var(--meta, #6b6a64); }
.dsh-plugins a { color: var(--accent, #1b365d); }
.dsh-plugins-inspect {
  display: grid;
  gap: var(--space-2, 8px);
  padding: var(--space-3, 12px);
  border: 1px solid var(--border, #d8d5c7);
  border-radius: var(--radius-md, 8px);
  background: var(--surface, #fdfcf6);
}
.dsh-plugins-inspect-blocked { border-color: var(--danger, #8a3a30); }
.dsh-plugins-inspect-verdict { margin: 0; font: 600 var(--text-sm, 12px)/1.5 var(--font-sans, system-ui, sans-serif); }
.dsh-plugins-findings { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
.dsh-plugins-finding { font-size: var(--text-xs, 11px); line-height: 1.5; }
.dsh-plugins-finding-error { color: var(--danger, #8a3a30); }
.dsh-plugins-finding-warning { color: var(--fg-2, #3d3d3a); }
.dsh-plugins-finding-info { color: var(--muted, #504e49); }
`
