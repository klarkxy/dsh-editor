/*
 * DSH editor-core paper styles — for the standalone manuscript overlay.
 *
 * The shell reuses these slot DOMs with its own classes (`.shell .editor`,
 * `.shell .paper-input`, etc.) and never needs this file. The manuscript
 * plugin renders the same editor-core outside the `.shell` root, so it
 * injects this stylesheet on first apply to bridge the design tokens
 * (`:root[data-theme=paper|ink]`) onto the editor-core internals.
 *
 * The token block at the top is intentional duplication. The shell also
 * ships the same tokens via `redesignedStyles`, so when both run together
 * the last writer wins (same values, harmless). When manuscript runs alone
 * — e.g. inside the default DSH harness without the dsh-editor profile —
 * the shell's stylesheet is not present and this block keeps the overlay
 * readable instead of falling back to browser defaults.
 *
 * Selectors below the token block are anchored on the manuscript-prefixed
 * class names that the plugin passes via `slotClassName`, and on the
 * `data-testid` attributes editor-core already emits — so the same visual
 * rules travel with the slot DOM regardless of where it is mounted.
 *
 * `!important` is used sparingly, only where editor-core's inline default
 * styles would otherwise win (the paper surface typography and ghost
 * opacity). Everything else relies on class-name specificity.
 */

const editorCoreTokens = `
:root,
:root[data-theme="paper"] {
  --bg: #f3f1e8;
  --surface: #fdfcf6;
  --surface-warm: #e8e6dc;
  --fg: #141413;
  --fg-2: #3d3d3a;
  --muted: #504e49;
  --meta: #6b6a64;
  --border: #d8d5c7;
  --border-soft: #e5e3d8;
  --accent: #1b365d;
  --accent-on: #faf9f5;
  --accent-active: #142a48;
  --ghost: #78756c;
  --selection: #e4e6dc;
  --danger: #8a3a30;
  --confirm: #4a6b3a;
  --elev-raised: 0 8px 24px rgba(20, 20, 19, 0.06);
  --studio: #141413;
  color-scheme: light;
}
:root[data-theme="ink"] {
  --bg: #161310;
  --surface: #221e18;
  --surface-warm: #2c2820;
  --fg: #ede7d7;
  --fg-2: #cdc7b8;
  --muted: #a8a294;
  --meta: #8f897b;
  --border: #3d382f;
  --border-soft: #2a261f;
  --accent: #9db4d0;
  --accent-on: #161310;
  --accent-active: #b6c9e0;
  --ghost: #8f897b;
  --selection: #2e3547;
  --danger: #c4786a;
  --confirm: #8aaa70;
  --elev-raised: 0 8px 28px rgba(8, 7, 6, 0.45);
  --studio: #0c0b0a;
  color-scheme: dark;
}
:root {
  --font-serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", Georgia, serif;
  --font-sans: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, Monaco, monospace;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-md: 15px;
  --text-body: 17px;
  --leading-body: 1.9;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --elev-flat: none;
  --elev-ring: 0 0 0 1px var(--border);
  --elev-ring-accent: 0 0 0 1px var(--accent);
  --focus-ring: 0 0 0 2px var(--accent-active);
  --motion-fast: 150ms;
  --motion-base: 200ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --topbar-h: 40px;
  --tree-w: 220px;
  --chat-w: 360px;
}
`

export const editorCoreStyles = `
${editorCoreTokens}
.manuscript-paper {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-sans);
}

/* Header row inside the paper. */
.manuscript-paper-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  min-height: var(--topbar-h);
  padding: 0 20px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface);
  color: var(--meta);
  font: 500 var(--text-xs)/1 var(--font-sans);
  letter-spacing: .1em;
}
.manuscript-paper-header [data-testid$="-path"] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font: 500 var(--text-md)/1.2 var(--font-serif);
  letter-spacing: .12em;
}
.manuscript-paper-header [data-testid$="-fim"],
.manuscript-paper-header [data-testid$="-rewrite"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  box-shadow: var(--elev-ring);
  color: var(--fg-2);
  font: 500 var(--text-sm)/1 var(--font-sans);
  letter-spacing: .08em;
  cursor: pointer;
  transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease);
}
.manuscript-paper-header [data-testid$="-fim"]:hover,
.manuscript-paper-header [data-testid$="-rewrite"]:hover { background: var(--bg); color: var(--fg); }
.manuscript-paper-header [data-testid$="-fim"]:active,
.manuscript-paper-header [data-testid$="-rewrite"]:active { background: var(--surface-warm); }
.manuscript-paper-header [data-testid$="-wordcount"],
.manuscript-paper-header [data-testid$="-save-state"] {
  font-size: 11px;
  color: var(--muted);
  letter-spacing: .04em;
}
.manuscript-paper-header select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--fg);
  font: 500 var(--text-xs)/1 var(--font-sans);
  letter-spacing: .12em;
}
.manuscript-paper-chapter-nav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.manuscript-paper-chapter-nav > button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  color: var(--meta);
  font-size: 16px;
  line-height: 1;
}
.manuscript-paper-chapter-nav > button:hover { background: var(--bg); color: var(--fg); }
.manuscript-paper-chapter-nav > span { font-size: 11px; color: var(--meta); padding: 0 4px; }

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
  color: var(--fg);
}
.manuscript-paper-textarea .cm-editor .cm-scroller {
  font-family: var(--font-serif);
}
.manuscript-paper-textarea .cm-editor .cm-placeholder {
  color: var(--meta);
  font-style: italic;
}
.manuscript-paper-ghost,
.manuscript-paper-textarea [data-testid$="-ghost"] {
  color: var(--ghost);
}

/* Ghost tip, proposal patch, conflict guard, status note. */
.manuscript-paper-ghost-tip {
  padding: 4px 20px !important;
  font-size: var(--text-xs) !important;
  color: var(--muted) !important;
  opacity: 1 !important;
  background: var(--surface);
}
.manuscript-paper-proposal {
  margin: 14px 0 8px 2em;
  padding: 12px 14px 10px !important;
  background: var(--bg) !important;
  box-shadow: var(--elev-ring) !important;
  border: 0 !important;
  border-radius: var(--radius-md) !important;
  display: grid;
  gap: 8px;
  color: var(--fg) !important;
  font-family: var(--font-serif);
}
.manuscript-paper-proposal > strong {
  font: 500 var(--text-sm)/1.4 var(--font-sans);
  letter-spacing: .08em;
  color: var(--fg);
}
.manuscript-paper-proposal > div:not([class]) {
  display: grid;
  gap: 7px;
}
.manuscript-paper-proposal > div:not([class]) section {
  display: grid;
  gap: 4px;
}
.manuscript-paper-proposal > div:not([class]) section small {
  font: 500 var(--text-xs)/1 var(--font-sans);
  letter-spacing: .12em;
  color: var(--meta);
}
.manuscript-paper-proposal p {
  margin: 0;
  white-space: pre-wrap;
  font: 400 16px/1.85 var(--font-serif);
  letter-spacing: .03em;
  color: var(--fg-2);
}
.manuscript-paper-proposal p:last-child { color: var(--fg); }
.manuscript-paper-proposal > div:last-child {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.manuscript-paper-proposal > div:last-child button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  box-shadow: var(--elev-ring);
  color: var(--fg-2);
  font: 500 var(--text-sm)/1 var(--font-sans);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-paper-proposal > div:last-child button:hover { background: var(--bg); color: var(--fg); }
.manuscript-paper-proposal > div:last-child button:first-child {
  background: var(--accent);
  color: var(--accent-on);
  box-shadow: var(--elev-ring-accent);
}
.manuscript-paper-proposal > div:last-child button:first-child:hover {
  box-shadow: var(--elev-ring-accent), var(--elev-raised);
}

.manuscript-paper-conflict {
  padding: 6px 10px !important;
  border-top: 1px solid var(--border-soft) !important;
  font-size: var(--text-xs) !important;
  color: var(--danger) !important;
  background: var(--surface) !important;
  font-family: var(--font-sans);
}
.manuscript-paper-notice {
  padding: 4px 10px !important;
  font-size: var(--text-xs) !important;
  color: var(--muted) !important;
  background: var(--surface) !important;
  font-family: var(--font-sans);
}

/* Footer with action buttons. */
.manuscript-paper-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0 20px !important;
  border-top: 1px solid var(--border-soft);
  background: var(--surface);
  color: var(--meta);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
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
  border-radius: var(--radius-md);
  background: transparent;
  box-shadow: var(--elev-ring);
  color: var(--fg-2);
  font: 500 var(--text-sm)/1 var(--font-sans);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-paper-footer > button:hover { background: var(--bg); color: var(--fg); }
.manuscript-paper-footer > div {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  padding: 0 4px;
}
.manuscript-paper-footer > div strong { font-weight: 500; letter-spacing: .04em; }
.manuscript-paper-footer > div small { font-size: 11px; color: var(--meta); }
.manuscript-paper-footer > div > button {
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
.manuscript-paper-footer > div > button:hover { background: var(--bg); color: var(--fg); }
.manuscript-paper-footer > nav { display: flex; gap: 4px; }
.manuscript-paper-footer > nav button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--meta);
  font: 500 var(--text-xs)/1 var(--font-sans);
  letter-spacing: .08em;
  cursor: pointer;
}
.manuscript-paper-footer > nav button:hover { background: var(--bg); color: var(--fg); }

/* Reduced motion. */
@media (prefers-reduced-motion: reduce) {
  .manuscript-paper * { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`
