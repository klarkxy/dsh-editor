/*
 * Manuscript overlay chrome styles — the ManuscriptFrame root, its panel
 * (header, action row, tree, switch guard) and the collapsed toggle.
 *
 * The editor-core internals (paper editor, header, footer, ghost, proposal)
 * are styled by `editorCoreStyles` re-exported from editor-core. This file
 * only covers the bits the manuscript plugin owns directly.
 *
 * Anchors: `[data-testid="manuscript-overlay"]` (root), `.manuscript-panel`,
 * `.manuscript-panel-header`, `.manuscript-panel-title`, `.manuscript-panel-actions`,
 * `.manuscript-panel-tree`, `.manuscript-tree-button`, `.manuscript-tree-row`,
 * `.manuscript-panel-main`, `.manuscript-panel-empty`, `.manuscript-switch-guard`,
 * `.manuscript-toggle`.
 *
 * All visual properties come from the same paper/ink tokens the shell
 * injects on `:root[data-theme=...]`. No font CDNs; system font stack only.
 */

export const manuscriptOverlayStyles = `
[data-testid="manuscript-overlay"] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
[data-testid="manuscript-overlay"][data-state="closed"] {
  pointer-events: none;
}

.manuscript-toggle {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--fg-2);
  font: 500 var(--text-sm)/1 var(--font-sans);
  letter-spacing: .14em;
  box-shadow: var(--elev-ring);
  cursor: pointer;
  pointer-events: auto;
  transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease);
}
.manuscript-toggle:hover { background: var(--bg); color: var(--fg); box-shadow: var(--elev-raised); }
.manuscript-toggle:active { background: var(--surface-warm); }

.manuscript-panel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  pointer-events: auto;
  display: grid;
  grid-template-rows: auto minmax(140px, 40%) minmax(0, 1fr);
  background: var(--bg);
  color: var(--fg);
  border-right: 1px solid var(--border);
  box-shadow: 4px 0 24px color-mix(in srgb, var(--studio) 16%, transparent);
  font-family: var(--font-sans);
}

.manuscript-panel-header {
  display: grid;
  gap: 6px;
  padding: 10px 14px 12px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg);
}
.manuscript-panel-title {
  font: 500 var(--text-md)/1.2 var(--font-serif);
  letter-spacing: .12em;
  color: var(--fg);
  margin: 0;
}
.manuscript-panel-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.manuscript-panel-actions > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  box-shadow: var(--elev-ring);
  color: var(--fg-2);
  font: 500 var(--text-xs)/1 var(--font-sans);
  letter-spacing: .12em;
  cursor: pointer;
  transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease);
}
.manuscript-panel-actions > button:hover { background: var(--surface); color: var(--fg); }
.manuscript-panel-actions > button:active { background: var(--surface-warm); }
.manuscript-panel-actions > button:disabled { opacity: .55; cursor: not-allowed; }

.manuscript-panel-tree {
  border-bottom: 1px solid var(--border-soft);
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.manuscript-panel-tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: var(--text-sm);
}
.manuscript-tree-empty {
  padding: 14px;
  color: var(--muted);
  font-size: var(--text-sm);
}
.manuscript-tree-button,
.manuscript-tree-row {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 5px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--fg-2);
  font: 400 var(--text-sm)/1.4 var(--font-sans);
  letter-spacing: .04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.manuscript-tree-button:hover,
.manuscript-tree-row:hover { background: var(--surface); color: var(--fg); }
.manuscript-tree-row.is-active { background: var(--surface-warm); color: var(--fg); }
.manuscript-tree-button[aria-expanded] { font-weight: 500; }

.manuscript-panel-main {
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}
.manuscript-panel-empty {
  padding: 24px;
  color: var(--muted);
  font-size: var(--text-sm);
  font-family: var(--font-serif);
}

.manuscript-switch-guard {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-soft);
  background: var(--surface);
  color: var(--muted);
  font-size: var(--text-xs);
  font-family: var(--font-sans);
}
.manuscript-switch-guard > span { flex: 1; min-width: 0; }
.manuscript-switch-guard > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  box-shadow: var(--elev-ring);
  color: var(--fg-2);
  font: 500 var(--text-xs)/1 var(--font-sans);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-switch-guard > button:first-of-type {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: var(--elev-ring-accent);
}
.manuscript-switch-guard > button:hover { background: var(--bg); color: var(--fg); }
.manuscript-switch-guard > button:first-of-type:hover {
  background: var(--accent-active);
  color: var(--accent-on);
}

@media (max-width: 760px) {
  .manuscript-panel { width: min(92vw, 380px); }
}
`
