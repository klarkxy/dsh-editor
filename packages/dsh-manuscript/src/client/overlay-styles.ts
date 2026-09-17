import { radixFallbackTokens } from 'dsh-editor-seats/tokens'
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
 * Colors use Radix Themes variables. No font CDNs; system / theme stacks only.
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
  min-height: var(--control-h, 34px);
  padding: 5px 14px;
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-3);
  background: var(--color-panel-solid);
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: .14em;
  box-shadow: var(--shadow-4);
  cursor: pointer;
  pointer-events: auto;
  transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease);
}
.manuscript-toggle:hover { background: var(--gray-a3); color: var(--gray-12); box-shadow: var(--shadow-4); }
.manuscript-toggle:active { background: var(--gray-a4); }

.manuscript-panel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 380px;
  pointer-events: auto;
  display: grid;
  grid-template-rows: auto minmax(140px, 40%) minmax(0, 1fr);
  background: var(--color-panel-solid);
  color: var(--gray-12);
  border-right: 1px solid var(--gray-6);
  box-shadow: var(--shadow-4);
  font-family: var(--default-font-family);
}

.manuscript-panel-header {
  display: grid;
  gap: 6px;
  min-height: 52px;
  padding: 12px 16px 14px;
  border-bottom: 1px solid var(--gray-a5);
  background: var(--color-panel-solid);
}
.manuscript-panel-title {
  font: var(--font-weight-medium) var(--font-size-3)/1.2 var(--default-font-family);
  letter-spacing: .12em;
  color: var(--gray-12);
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
  border-radius: var(--radius-2);
  background: transparent;
  box-shadow: 0 0 0 1px var(--gray-a5);
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-1)/1 var(--default-font-family);
  letter-spacing: .12em;
  cursor: pointer;
  transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease);
}
.manuscript-panel-actions > button:hover { background: var(--gray-a3); color: var(--gray-12); }
.manuscript-panel-actions > button:active { background: var(--gray-a4); }
.manuscript-panel-actions > button:disabled { opacity: .55; cursor: not-allowed; }

.manuscript-panel-tree {
  border-bottom: 1px solid var(--gray-a5);
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--color-panel-solid);
}
.manuscript-panel-tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: var(--font-size-2);
}
.manuscript-tree-empty {
  padding: 14px;
  color: var(--gray-11);
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
  color: var(--gray-11);
  font: 400 var(--font-size-2)/1.4 var(--default-font-family);
  letter-spacing: .04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.manuscript-tree-button:hover,
.manuscript-tree-row:hover { background: var(--gray-a3); color: var(--gray-12); }
.manuscript-tree-row.is-active { background: var(--accent-a3); color: var(--accent-11); }
.manuscript-tree-button[aria-expanded] { font-weight: var(--font-weight-medium); }

.manuscript-panel-main {
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-panel-solid);
}
.manuscript-panel-empty {
  padding: 24px;
  color: var(--gray-11);
  font-size: var(--font-size-2);
  font-family: var(--default-font-family);
}

.manuscript-switch-guard {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--gray-a5);
  background: var(--color-panel-solid);
  color: var(--gray-11);
  font-size: var(--font-size-1);
  font-family: var(--default-font-family);
}
.manuscript-switch-guard > span { flex: 1; min-width: 0; }
.manuscript-switch-guard > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-2);
  background: transparent;
  box-shadow: 0 0 0 1px var(--gray-a5);
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-1)/1 var(--default-font-family);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-switch-guard > button:first-of-type {
  background: var(--accent-9);
  color: var(--accent-contrast);
  box-shadow: 0 0 0 1px var(--accent-9);
}
.manuscript-switch-guard > button:hover { background: var(--gray-a3); color: var(--gray-12); }
.manuscript-switch-guard > button:first-of-type:hover {
  background: var(--accent-10);
  color: var(--accent-contrast);
}

@media (max-width: 760px) {
  .manuscript-panel { width: min(92vw, 380px); }
}

/* Reduced motion — the portaled drawers live outside .manuscript-paper,
   so the editor-core block does not cover them. */
@media (prefers-reduced-motion: reduce) {
  [data-testid="manuscript-overlay"],
  [data-testid="manuscript-overlay"] * { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`
