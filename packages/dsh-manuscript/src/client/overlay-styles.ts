import { radixFallbackTokens, surfaceTokenAliases } from 'dsh-editor-seats/tokens'
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
 * Chrome reads `surfaceTokenAliases`: existing `--dsh-ui-*`, then official
 * `--dsw-*`, then the Radix names `radixFallbackTokens` supplies. The paper
 * surface and CodeMirror instance are not styled here.
 */

export const manuscriptOverlayStyles = `
/* Token block from dsh-editor-seats/tokens, inlined at build time so the
   portaled overlay stays readable when no .radix-themes ancestor exists. */
${radixFallbackTokens}
:root {
  --control-h: 34px;
  --duration-quick: 150ms;
  --motion-fast: var(--duration-quick);
  --motion-base: 200ms;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}

[data-testid="manuscript-overlay"] {
${surfaceTokenAliases}
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
[data-testid="manuscript-overlay"][data-state="closed"] {
  pointer-events: none;
}

button.manuscript-toggle {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--s-control);
  padding: 0 14px;
  border: 0;
  border-radius: var(--s-radius-md);
  background: var(--s-raised);
  color: var(--s-text);
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--s-font);
  letter-spacing: 0;
  box-shadow: var(--s-elevate);
  cursor: pointer;
  pointer-events: auto;
  transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease);
}
button.manuscript-toggle:hover { background: var(--s-hover); color: var(--s-text); }
button.manuscript-toggle:active { background: var(--s-selected); }

.manuscript-panel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  pointer-events: auto;
  display: grid;
  grid-template-rows: auto minmax(140px, 40%) minmax(0, 1fr);
  background: var(--s-raised);
  color: var(--s-text);
  border: 0;
  border-radius: 0 var(--s-radius-panel) var(--s-radius-panel) 0;
  box-shadow: var(--s-elevate);
  font-family: var(--s-font);
}

.manuscript-panel-header {
  display: grid;
  gap: 6px;
  min-height: 52px;
  padding: 12px 16px 14px;
  border-bottom: 0.5px solid var(--s-line);
  border-top-right-radius: var(--s-radius-panel);
  background: var(--s-raised);
}
.manuscript-panel-title {
  font: var(--font-weight-medium) var(--font-size-3)/1.2 var(--s-font);
  letter-spacing: 0;
  color: var(--s-text);
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
  min-height: var(--s-control-sm);
  padding: 0 10px;
  border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--s-text);
  font: var(--font-weight-medium) var(--font-size-1)/1 var(--s-font);
  letter-spacing: 0;
  cursor: pointer;
  transition: background var(--motion-fast) var(--ease);
}
.manuscript-panel-actions > button:hover { background: var(--s-hover); color: var(--s-text); }
.manuscript-panel-actions > button:active { background: var(--s-selected); }
.manuscript-panel-actions > button:disabled { opacity: .55; cursor: not-allowed; }
.manuscript-panel-actions > button[data-testid="manuscript-close"] {
  color: var(--s-danger);
  border-color: var(--s-danger);
}

.manuscript-panel-tree {
  border-bottom: 0.5px solid var(--s-line);
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--s-raised);
}
.manuscript-panel-tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: var(--font-size-2);
}
.manuscript-tree-empty {
  padding: 14px;
  color: var(--s-muted);
  font-size: var(--font-size-2);
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
  color: var(--s-muted);
  font: 400 var(--font-size-2)/1.4 var(--s-font);
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.manuscript-tree-button:hover,
.manuscript-tree-row:hover { background: var(--s-hover); color: var(--s-text); }
.manuscript-tree-row.is-active {
  background: var(--s-selected);
  color: var(--s-text);
  font-weight: var(--font-weight-medium);
}
.manuscript-tree-button[aria-expanded] { font-weight: var(--font-weight-medium); }

[data-testid="manuscript-create-row"] input {
  min-height: var(--s-control-sm);
  font-family: var(--s-font);
}
[data-testid="manuscript-rewrite-notice"] {
  color: var(--s-muted);
  font-family: var(--s-font);
}
[data-testid="manuscript-capability-error"] {
  color: var(--s-danger);
  font-weight: var(--font-weight-medium);
  font-family: var(--s-font);
  border-top: 1px solid var(--s-danger);
}

.manuscript-panel-main {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-bottom-right-radius: var(--s-radius-panel);
  background: var(--s-raised);
}
.manuscript-panel-main > .manuscript-paper,
.manuscript-panel-main > .manuscript-paper > .manuscript-paper-footer {
  border-bottom-right-radius: var(--s-radius-panel);
}
.manuscript-panel-empty {
  padding: 24px;
  color: var(--s-muted);
  font-size: var(--font-size-2);
  font-family: var(--s-font);
}

.manuscript-switch-guard {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 0.5px solid var(--s-line);
  border-bottom-right-radius: var(--s-radius-panel);
  background: var(--s-raised);
  color: var(--s-muted);
  font-size: var(--font-size-1);
  font-family: var(--s-font);
}
.manuscript-switch-guard > span { flex: 1; min-width: 0; }
.manuscript-switch-guard > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--s-control-sm);
  padding: 0 10px;
  border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--s-text);
  font: var(--font-weight-medium) var(--font-size-1)/1 var(--s-font);
  letter-spacing: 0;
  cursor: pointer;
}
.manuscript-switch-guard > button:first-of-type {
  border: 0;
  background: var(--s-brand);
  color: var(--s-on-brand);
}
.manuscript-switch-guard > button:last-of-type {
  color: var(--s-danger);
  border-color: var(--s-danger);
}
.manuscript-switch-guard > button:hover { background: var(--s-hover); color: var(--s-text); }
.manuscript-switch-guard > button:first-of-type:hover {
  background: var(--s-brand-hover);
  color: var(--s-on-brand);
}
.manuscript-switch-guard > button:last-of-type:hover {
  background: var(--s-hover);
  color: var(--s-danger);
}

button.manuscript-toggle:focus-visible,
.manuscript-panel button:focus-visible,
.manuscript-panel input:focus-visible {
  outline: 2px solid var(--s-accent);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .manuscript-panel { width: min(92vw, 380px); }
}

/* Reduced motion — the portaled drawers live outside .manuscript-paper,
   so the editor-core block does not cover them. */
@media (prefers-reduced-motion: reduce) {
  [data-testid="manuscript-overlay"],
  [data-testid="manuscript-overlay"] * { scroll-behavior: auto; transition: none; animation: none; }
  /* button.manuscript-toggle 与 .manuscript-panel-actions > button 的 transition
     声明是 (0,1,1)，通用选择器压不住，点名覆盖。 */
  [data-testid="manuscript-overlay"] button.manuscript-toggle,
  [data-testid="manuscript-overlay"] .manuscript-panel-actions > button { transition: none; }
}
`
