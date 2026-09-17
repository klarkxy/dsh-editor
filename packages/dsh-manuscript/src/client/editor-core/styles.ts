import { radixFallbackTokens } from 'dsh-editor-seats/tokens'
/*
 * DSH editor-core paper styles — for the standalone manuscript overlay.
 *
 * The shell reuses these slot DOMs with its own classes (`.shell .editor`,
 * `.shell .paper-input`, etc.) and never needs this file. The manuscript
 * plugin renders the same editor-core outside the `.shell` root, so it
 * injects this stylesheet on first apply. Colors use Radix Themes variables
 * available under `.radix-themes`.
 *
 * The token block comes from dsh-editor-seats/tokens (`radixFallbackTokens`)
 * and is inlined at build time so a bare host stays readable when no
 * `.radix-themes` ancestor is present.
 *
 * Selectors below the token block are anchored on the manuscript-prefixed
 * class names that the plugin passes via `slotClassName`, and on the
 * `data-testid` attributes editor-core already emits.
 *
 * `!important` is used sparingly, only where editor-core's inline default
 * styles would otherwise win (the paper surface typography and ghost
 * opacity). Everything else relies on class-name specificity.
 *
 * Writing settings drive `--paper-font-size`, `--paper-line-height`,
 * `--paper-font-family`, `--paper-paragraph-spacing`, `--paper-max-width`.
 * Serif / mono stacks stay author-selectable; sans chrome falls back to
 * `--default-font-family`.
 */

const editorCoreTokens = `
${radixFallbackTokens}
:root {
  --paper-serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", Georgia, serif;
  --paper-sans: var(--default-font-family);
  --paper-mono: var(--code-font-family);
  --paper-font-size: 17px;
  --paper-line-height: 1.9;
  --paper-font-family: var(--paper-serif);
  --paper-paragraph-spacing: 0em;
  --paper-max-width: none;
  --paper-dim-opacity: 0.35;
  --topbar-h: 52px;
  --control-h: 34px;
  --duration-quick: 150ms;
  --motion-fast: var(--duration-quick);
  --motion-base: 200ms;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}
`

export const editorCoreStyles = `
${editorCoreTokens}
.manuscript-paper {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-background);
  color: var(--gray-12);
  font-family: var(--default-font-family);
  --paper-pad-inline: 64px;
  --paper-pad-block: 36px;
}

/* Header row inside the paper. */
.manuscript-paper-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  min-height: var(--topbar-h);
  padding: 0 var(--paper-pad-inline);
  border-bottom: 1px solid var(--gray-a5);
  background: var(--color-background);
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: .06em;
}
.manuscript-paper-header [data-testid$="-path"] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--gray-12);
  font: var(--font-weight-medium) var(--font-size-3)/1.2 var(--paper-serif);
  letter-spacing: .12em;
}
.manuscript-paper-header [data-testid$="-fim"],
.manuscript-paper-header [data-testid$="-rewrite"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-h, 34px);
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-3);
  background: transparent;
  box-shadow: 0 0 0 1px var(--gray-a5);
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: .08em;
  cursor: pointer;
  transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease);
}
.manuscript-paper-header [data-testid$="-fim"]:hover,
.manuscript-paper-header [data-testid$="-rewrite"]:hover { background: var(--gray-a3); color: var(--gray-12); }
.manuscript-paper-header [data-testid$="-fim"]:active,
.manuscript-paper-header [data-testid$="-rewrite"]:active { background: var(--gray-a4); }
.manuscript-paper-header [data-testid$="-wordcount"],
.manuscript-paper-header [data-testid$="-save-state"] {
  font-size: var(--font-size-1);
  color: var(--gray-11);
  letter-spacing: .04em;
}
.manuscript-paper-header select {
  padding: 4px 8px;
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  background: var(--color-background);
  color: var(--gray-12);
  font: var(--font-weight-medium) var(--font-size-1)/1 var(--default-font-family);
  letter-spacing: .12em;
}
/* Paper surface — CodeMirror mounts inside the wrapper div. Layout only;
   typography lives in the CM theme (editor-core/codemirror.ts) so the same
   rules apply whether the editor runs in the shell or standalone here. */
.manuscript-paper-textarea {
  position: relative;
  flex: 1;
  min-height: 0;
}
.manuscript-paper-textarea [data-testid$="-editor"] {
  position: absolute;
  inset: 0;
}
.manuscript-paper-textarea .cm-editor {
  height: 100%;
  background: transparent;
  color: var(--gray-12);
  font-size: var(--paper-font-size);
  line-height: var(--paper-line-height);
  font-family: var(--paper-font-family);
}
.manuscript-paper-textarea .cm-editor .cm-scroller {
  align-items: flex-start !important;
  justify-content: flex-start;
  font-family: inherit;
}
.manuscript-paper-textarea .cm-content {
  width: 100%;
  max-width: var(--paper-max-width, none);
  margin-inline: auto;
  box-sizing: border-box;
  text-align: start;
  caret-color: var(--accent-9);
}
.manuscript-paper-textarea .cm-line {
  padding-bottom: var(--paper-paragraph-spacing, 0em);
}
.manuscript-paper-textarea .cm-paper-dim {
  opacity: var(--paper-dim-opacity, 0.35);
}
.manuscript-paper-textarea .cm-editor .cm-placeholder {
  color: var(--gray-9);
  font-style: italic;
}
.manuscript-paper-textarea .cm-cursor,
.manuscript-paper-textarea .cm-dropCursor {
  border-left-color: var(--accent-9);
}
.manuscript-paper-textarea .cm-selectionBackground,
.manuscript-paper-textarea .cm-editor.cm-focused .cm-selectionBackground {
  background: var(--accent-a4);
}
.manuscript-paper-textarea .cm-activeLine {
  background: var(--gray-a2);
}
.manuscript-paper-textarea .cm-gutters {
  background: var(--color-background);
  color: var(--gray-11);
  border-right: 1px solid var(--gray-a5);
}
.manuscript-paper-textarea .cm-lp-h1,
.manuscript-paper-textarea .cm-lp-h2,
.manuscript-paper-textarea .cm-lp-h3,
.manuscript-paper-textarea .cm-lp-h4,
.manuscript-paper-textarea .cm-lp-h5,
.manuscript-paper-textarea .cm-lp-h6 {
  color: var(--gray-12);
}
.manuscript-paper-textarea .cm-paper-search {
  background: var(--color-background);
  color: var(--gray-12);
  font-family: var(--default-font-family);
}
.manuscript-paper-textarea .cm-paper-search input {
  background: var(--color-background);
  color: var(--gray-12);
  border-color: var(--gray-6);
}
.manuscript-paper-textarea .cm-searchMatch {
  background: var(--amber-a4);
}
.manuscript-paper-textarea .cm-searchMatch-selected {
  background: var(--amber-a6);
}
.manuscript-paper-ghost,
.manuscript-paper-textarea [data-testid$="-ghost"],
.manuscript-paper-textarea .cm-ghost {
  color: var(--gray-9);
}

/* Ghost tip, proposal patch, conflict guard, status note. */
.manuscript-paper-ghost-tip {
  padding: 4px 20px !important;
  font-size: var(--font-size-1) !important;
  color: var(--gray-11) !important;
  opacity: 1 !important;
  background: var(--color-background);
}
.manuscript-paper-proposal {
  margin: 14px 0 8px 2em;
  padding: 12px 14px 10px !important;
  background: var(--color-panel-solid) !important;
  box-shadow: var(--shadow-2) !important;
  border: 0 !important;
  border-radius: var(--radius-3) !important;
  display: grid;
  gap: 8px;
  color: var(--gray-12) !important;
  font-family: var(--paper-serif);
}
.manuscript-paper-proposal > strong {
  font: var(--font-weight-medium) var(--font-size-2)/1.4 var(--default-font-family);
  letter-spacing: .08em;
  color: var(--gray-12);
}
.manuscript-paper-proposal .selection-diff,
.manuscript-paper-proposal > div:not([class]) {
  display: grid;
  gap: 7px;
}
.manuscript-paper-proposal .selection-diff section,
.manuscript-paper-proposal > div:not([class]) section {
  display: grid;
  gap: 4px;
}
.manuscript-paper-proposal .selection-diff-original small,
.manuscript-paper-proposal .selection-diff section small,
.manuscript-paper-proposal > div:not([class]) section small {
  font: var(--font-weight-medium) var(--font-size-1)/1 var(--default-font-family);
  letter-spacing: .12em;
  color: var(--gray-11);
}
.manuscript-paper-proposal .selection-diff-revised p {
  color: var(--gray-12);
}
.manuscript-paper-proposal p {
  margin: 0;
  white-space: pre-wrap;
  font: 400 16px/1.85 var(--paper-serif);
  letter-spacing: .03em;
  color: var(--gray-11);
}
.manuscript-paper-proposal p:last-child { color: var(--gray-12); }
.manuscript-paper-proposal .proposal-actions,
.manuscript-paper-proposal > div:last-child {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.manuscript-paper-proposal .proposal-actions button,
.manuscript-paper-proposal > div:last-child button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-3);
  background: transparent;
  box-shadow: 0 0 0 1px var(--gray-a5);
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-paper-proposal .proposal-actions button:hover,
.manuscript-paper-proposal > div:last-child button:hover { background: var(--gray-a3); color: var(--gray-12); }
.manuscript-paper-proposal .proposal-actions .primary-action,
.manuscript-paper-proposal > div:last-child button:first-child {
  background: var(--accent-9);
  color: var(--accent-contrast);
  box-shadow: 0 0 0 1px var(--accent-9);
}
.manuscript-paper-proposal .proposal-actions .primary-action:hover,
.manuscript-paper-proposal > div:last-child button:first-child:hover {
  box-shadow: 0 0 0 1px var(--accent-9), var(--shadow-2);
}

.manuscript-paper-conflict {
  padding: 6px 10px !important;
  border-top: 1px solid var(--gray-a5) !important;
  font-size: var(--font-size-1) !important;
  color: var(--red-9) !important;
  background: var(--color-background) !important;
  font-family: var(--default-font-family);
}
.manuscript-paper-notice {
  padding: 4px 10px !important;
  font-size: var(--font-size-1) !important;
  color: var(--gray-11) !important;
  background: var(--color-background) !important;
  font-family: var(--default-font-family);
}

/* Footer with action buttons. */
.manuscript-paper-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 20px !important;
  border-top: 1px solid var(--gray-a5);
  background: var(--color-background);
  color: var(--gray-11);
  font-family: var(--default-font-family);
  font-size: var(--font-size-1);
  letter-spacing: .04em;
  flex-shrink: 0;
}
.manuscript-paper-footer > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-3);
  background: transparent;
  box-shadow: 0 0 0 1px var(--gray-a5);
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-paper-footer > button:hover { background: var(--gray-a3); color: var(--gray-12); }
.manuscript-paper-footer > div {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  padding: 0 4px;
}
.manuscript-paper-footer > div strong { font-weight: var(--font-weight-medium); letter-spacing: .04em; }
.manuscript-paper-footer > div small { font-size: var(--font-size-1); color: var(--gray-11); }
.manuscript-paper-footer > div > button {
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
.manuscript-paper-footer > div > button:hover { background: var(--gray-a3); color: var(--gray-12); }
.manuscript-paper-footer > nav { display: flex; gap: 4px; }
.manuscript-paper-footer > nav button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-2);
  background: transparent;
  color: var(--gray-11);
  font: var(--font-weight-medium) var(--font-size-1)/1 var(--default-font-family);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-paper-footer > nav button:hover { background: var(--gray-a3); color: var(--gray-12); }

/* Reduced motion. */
@media (prefers-reduced-motion: reduce) {
  .manuscript-paper * { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`
