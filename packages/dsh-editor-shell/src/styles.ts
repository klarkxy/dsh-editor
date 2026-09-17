/*
 * DSH Editor shell — residual CSS on top of Radix Themes.
 * Canonical usage: docs/ui.md.
 *
 * Hand-written CSS is only for grid / -webkit-app-region / CodeMirror /
 * cmdk / resizer / keyframes. Colours, space, radius, and type use Radix
 * variables. Semantic class names stay as e2e / panel hooks.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

export const themeStyles = `
.radix-themes {
  --default-font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --code-font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
}
.radix-themes.shell-theme {
  --topbar-h: 52px;
  --control-h: 34px;
  height: 100dvh;
  min-height: 0;
}
`

export const baseStyles = `
.shell, .shell *, .shell *::before, .shell *::after { box-sizing: border-box; }
.shell {
  width: 100%;
  height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--topbar-h) minmax(0, 1fr);
  background: var(--gray-2);
  color: var(--gray-12);
  font: 400 var(--font-size-2)/1.45 var(--default-font-family);
  overflow: hidden;
}
.shell button:not([class^="rt-"]):not([class*=" rt-"]),
.shell input:not([class^="rt-"]):not([class*=" rt-"]),
.shell select:not([class^="rt-"]):not([class*=" rt-"]),
.shell textarea:not([class^="rt-"]):not([class*=" rt-"]) { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; }
.shell button:not([class^="rt-"]):not([class*=" rt-"]) { cursor: pointer; transition: background-color 150ms ${EASE}, color 150ms ${EASE}, border-color 150ms ${EASE}, box-shadow 150ms ${EASE}; }
@keyframes shell-fade-in { from { opacity: 0; } }
@keyframes shell-message-in { from { opacity: 0; transform: translateY(var(--space-3)); } }
@keyframes shell-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes shell-activity-typing { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes shell-activity-shimmer { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
@keyframes shell-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
@keyframes shell-success-draw { from { stroke-dashoffset: 42; } }
.shell textarea:not([class^="rt-"]):not([class*=" rt-"]) { resize: none; outline: none; }
.shell :focus { outline: none; }
.shell :focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: 0 0 0 2px var(--accent-10); }
.shell button:not([class^="rt-"]):not([class*=" rt-"]):disabled { cursor: not-allowed; opacity: .55; }
.radix-themes .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.radix-themes .muted { color: var(--gray-11); }
.radix-themes .warning { color: var(--red-9); }
.shell ::-webkit-scrollbar { width: 8px; height: 8px; }
.shell ::-webkit-scrollbar-track { background: transparent; }
.shell ::-webkit-scrollbar-thumb { background: var(--gray-a6); border-radius: var(--radius-2); }
.shell ::-webkit-scrollbar-thumb:hover { background: var(--gray-a8); }
`

export const componentStyles = `
/* ── Top bar ─────────────────────────────────────────────── */
/* Residual: frameless title-bar drag region, fixed --topbar-h row,
   window-control hover colors, and the extensions dock placement contract
   (position:fixed + --dsh-ext-* variables). Visual chrome is Radix Themes. */
.shell > .chrome {
  grid-column: 1 / -1;
  height: var(--topbar-h);
  min-width: 0;
  border-bottom: 1px solid var(--gray-a5);
  background: var(--gray-2);
  -webkit-app-region: drag;
}
.shell > .chrome button, .shell > .chrome summary, .shell > .chrome input, .shell > .chrome a, .shell > .chrome .select, .shell > .chrome .workspace-menu-panel, .shell > .chrome [class^="rt-"], .shell > .chrome [class*=" rt-"] { -webkit-app-region: no-drag; }
.shell .window-controls { -webkit-app-region: no-drag; }
.shell .window-controls button { width: 40px; height: var(--topbar-h); border-radius: 0; }
.shell .window-controls button:hover { background: var(--gray-a3); }
.shell .window-controls button.window-close:hover { background: var(--red-9); color: var(--accent-contrast); }
.shell-extensions-dock {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  position: fixed;
  top: 0;
  right: var(--space-4);
  height: var(--topbar-h);
  z-index: 5;
  pointer-events: none;
  --dsh-ext-dock-position: relative;
  --dsh-ext-dock-right: auto;
  --dsh-ext-dock-bottom: auto;
  --dsh-ext-panel-top: calc(100% + 6px);
  --dsh-ext-panel-bottom: auto;
}
.shell > .chrome > .shell-extensions-dock { position: static; height: auto; padding: 0; margin-left: auto; }
.radix-themes .path-fallback { min-width: 0; }
.radix-themes .icon-button { display: grid; place-items: center; min-width: 32px; min-height: 32px; padding: 3px; border: 0; border-radius: var(--radius-2); background: transparent; cursor: pointer; color: var(--gray-10); }
.radix-themes .icon-button:hover { background: var(--gray-a3); color: var(--gray-12); }

/* ── Sidebar / tree ─────────────────────────────────────── */
.shell .sidebar {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  border-right: 1px solid var(--gray-a5);
  background: var(--gray-2);
}
.shell .sidebar .side-search {
  min-width: 0;
}
.shell .tree .tree-row {
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: var(--space-6);
  text-align: left;
  cursor: pointer;
  border: 0;
  border-radius: var(--radius-2);
  background: transparent;
  color: var(--gray-11);
}
.shell .tree .tree-row::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent-9);
  opacity: 0;
}
.shell .tree .tree-row:hover { background: var(--gray-a3); }
.shell .tree .tree-row[aria-current="page"] { background: var(--accent-a3); color: var(--accent-11); }
.shell .tree .tree-row[aria-current="page"]::before { opacity: 1; }
.shell .tree .tree-marker { width: 12px; flex: none; text-align: center; }
.shell .tree-row-actions { flex: none; visibility: hidden; }
.shell .tree-directory-row:hover .tree-row-actions,
.shell .tree-directory-row:focus-within .tree-row-actions { visibility: visible; }
.shell .snapshot-panel { margin: 0 var(--space-3) var(--space-2); max-height: 220px; overflow: auto; }
.shell .snapshot-row:hover { background: var(--gray-a3); border-radius: var(--radius-2); }
.shell .search-results,
.shell .search-results ul { margin: 0; padding: 0; list-style: none; }
.shell .search-file { display: grid; gap: var(--space-1); }
.shell .pinned-pane { min-width: 0; min-height: 0; overflow: hidden; }
.shell .pinned-header { border-bottom: 1px solid var(--gray-a5); }
.shell .pinned-body { min-height: 0; flex: 1 1 auto; }
.shell .pinned-markdown { min-width: 0; overflow-wrap: anywhere; }

.radix-themes .cards-badge { padding: 1px 6px; border-radius: 999px; background: var(--gray-3); color: var(--gray-11); font-style: normal; }
.radix-themes .archive-list { min-width: 0; }
.radix-themes .export-summary { min-width: 0; }
.radix-themes .export-chapters { max-height: 280px; }
.radix-themes .export-chapters ol { margin: 0; padding: 0; list-style: none; }
.radix-themes .rewrite-instruction { width: 100%; min-height: 88px; }
.radix-themes .editor-stack { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; }
.radix-themes .editor-stack .editor-pane { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }

.radix-themes .file-dialog.image-preview-dialog {
  width: max-content;
  max-width: min(90vw, 1184px);
  max-height: min(80dvh, 780px);
  padding: 0;
  overflow: visible;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.radix-themes .image-preview-dialog img {
  display: block;
  max-width: min(90vw, 1184px);
  max-height: min(80dvh, 780px);
  object-fit: contain;
  box-shadow: var(--shadow-4);
  border-radius: var(--radius-2);
  background: var(--color-panel-solid);
}
.radix-themes .file-dialog.image-preview-dialog .image-preview-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  padding: 0;
  font-size: 18px;
  color: var(--gray-11);
  background: var(--color-panel-solid);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--gray-a6);
}

.shell > .assistant-launcher { position: fixed; right: var(--space-5); bottom: var(--space-5); z-index: 12; display: grid; place-items: center; width: var(--space-8); height: var(--space-8); padding: 0; border: 1px solid var(--gray-a6); border-radius: 999px; background: var(--color-panel-solid); color: var(--gray-12); box-shadow: var(--shadow-4); cursor: pointer; }
.shell > .assistant-launcher:hover { background: var(--gray-3); }
.shell > .assistant-launcher .whale-mark { width: var(--space-4); height: var(--space-4); color: var(--accent-9); }
.shell > .assistant-launcher.capability-note { width: auto; height: auto; max-width: min(360px, calc(100vw - 32px)); display: block; padding: var(--space-3); border-radius: var(--radius-3); }

.shell .panel-resizer { position: relative; z-index: 4; width: 1px; cursor: col-resize; background: var(--gray-6); transition: background-color 150ms; }
.shell .panel-resizer:hover, .shell .panel-resizer:focus-visible, .shell .panel-resizer[data-separator="active"] { background: var(--accent-9); }

/* ── Editor / paper ─────────────────────────────────────── */
.radix-themes .editor { height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--color-background); position: relative; z-index: 1; }
.radix-themes .editor-header { display: flex; align-items: center; gap: var(--space-3); min-width: 0; min-height: var(--space-8); padding: 0 var(--space-4); border-bottom: 1px solid var(--gray-a5); background: var(--color-background); color: var(--gray-11); font-size: var(--font-size-2); }
.radix-themes .editor-header > [data-testid="paper-path"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.radix-themes .editor-doc-title { order: -1; flex: 1; min-width: 0; color: var(--gray-12); }
.radix-themes .editor-header > [data-testid="paper-wordcount"],
.radix-themes .editor-header > [data-testid="paper-save-state"] { margin-left: auto; white-space: nowrap; color: var(--gray-11); font-size: var(--font-size-1); }
.radix-themes .paper-experience-toggles { display: inline-flex; align-items: center; gap: var(--space-1); }
.radix-themes .editor-action-menu { z-index: 40; min-width: 220px; max-height: min(calc(100dvh - 24px), var(--radix-dropdown-menu-content-available-height, 90dvh)); overflow: auto; }
.radix-themes .editor-action-dialog { max-width: min(440px, calc(100vw - 32px)); }
.radix-themes .chapter-navigation { display: inline-flex; align-items: center; gap: var(--space-1); }
.radix-themes .chapter-navigation > span { font-size: var(--font-size-1); color: var(--gray-11); padding: 0 var(--space-1); }
.radix-themes .chapter-navigation button { width: var(--space-6); height: var(--space-6); display: grid; place-items: center; border: 0; border-radius: var(--radius-2); background: transparent; cursor: pointer; color: var(--gray-11); font-size: var(--font-size-3); line-height: 1; }
.radix-themes .chapter-navigation button:hover { background: var(--gray-a3); color: var(--gray-12); }

.radix-themes .paper-input {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  color: var(--gray-12);
}
.radix-themes .paper-input .cm-editor { height: 100%; background: transparent; }
.radix-themes .paper-input .cm-scroller { font-family: var(--paper-font-family, "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", Georgia, serif); }
.radix-themes .paper-input .cm-placeholder { color: var(--gray-10); font-style: italic; }
.radix-themes .paper-scroll { max-width: 36em; margin: 0 auto; }

.radix-themes .ghost { color: var(--gray-9); font: inherit; letter-spacing: inherit; line-height: inherit; }
.radix-themes .ghost.is-loading { color: transparent; background-image: linear-gradient(90deg, var(--gray-9) 0%, var(--gray-11) 46%, var(--gray-9) 100%); background-size: 180% 100%; background-clip: text; -webkit-background-clip: text; animation: ghost-shimmer 1.35s ${EASE} infinite; }
@keyframes ghost-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -80% 0; } }

.radix-themes .editor-tools { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: var(--space-8); padding: var(--space-2) var(--space-5); border-top: 1px solid var(--gray-a5); background: var(--color-background); color: var(--gray-11); flex-shrink: 0; }
.radix-themes .editor-tools button { display: inline-flex; align-items: center; justify-content: center; min-height: var(--space-6); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-2); background: var(--gray-a3); color: var(--gray-12); cursor: pointer; font-size: var(--font-size-1); }
.radix-themes .editor-ghost-tip { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-4); color: var(--gray-11); font-size: var(--font-size-1); }
.radix-themes .editor-tools .ghost-actions { display: flex; gap: var(--space-1); align-items: center; padding: 0 var(--space-1); }
.radix-themes .editor-tools .ghost-actions > small { font-size: var(--font-size-1); color: var(--gray-11); }
.radix-themes .editor-tools .ghost-actions .kbd { font-family: var(--code-font-family); font-size: var(--font-size-1); padding: 2px var(--space-1); border-radius: var(--radius-2); background: var(--gray-3); color: var(--gray-11); margin-right: var(--space-1); }
.radix-themes .editor-tools .ghost-actions .fim-sep { color: var(--gray-6); padding: 0 var(--space-1); user-select: none; }
.radix-themes .danger-action { color: var(--red-9); }

.radix-themes .proposal { position: relative; padding: var(--space-3); margin: var(--space-3) 0 var(--space-2); max-width: 100%; background: var(--color-panel-solid); box-shadow: inset 0 0 0 1px var(--gray-a5); border-radius: var(--radius-3); display: grid; gap: var(--space-2); }
.radix-themes .proposal > strong { font: 500 var(--font-size-2)/1.4 var(--default-font-family); color: var(--gray-12); }
.radix-themes .proposal p { margin: 0; white-space: pre-wrap; color: var(--gray-11); }
.radix-themes .proposal-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.radix-themes .selection-diff { display: grid; gap: var(--space-2); }
.radix-themes .selection-diff section small { font-size: var(--font-size-1); color: var(--gray-11); }
.radix-themes .proposal-conflict { padding: var(--space-2) var(--space-3); border-top: 1px solid var(--gray-a5); font-size: var(--font-size-1); color: var(--red-9); }

/* ── Chat ───────────────────────────────────────────────── */
.shell .chat {
  height: 100%;
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--color-panel-solid);
}
.shell .chat > * { min-width: 0; max-width: 100%; }
.shell .chat[hidden] { display: none !important; pointer-events: none; }
.shell .chat.chat-overlay:not([hidden]) {
  position: fixed;
  top: var(--topbar-h);
  right: 0;
  bottom: 0;
  width: min(24rem, 100vw);
  max-width: 100vw;
  z-index: 36;
  display: grid;
  box-shadow: var(--shadow-5);
}
.shell > .chat-overlay-dismiss {
  position: fixed;
  inset: var(--topbar-h) 0 0 0;
  z-index: 35;
  margin: 0;
  padding: 0;
  border: 0;
  background: var(--gray-a6);
  cursor: pointer;
}
.shell .chat-history { min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.shell .conversation-select .select { display: block; min-width: 0; max-width: 100%; }
.radix-themes .chat-row { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.shell .proposal-card pre { max-height: 12rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.radix-themes .chat-row.chat-row-enter { animation: shell-message-in 200ms both; }
.shell .chat-markdown > :first-child { margin-top: 0; }
.shell .chat-markdown > :last-child { margin-bottom: 0; }
.shell .chat-markdown h1, .shell .chat-markdown h2, .shell .chat-markdown h3,
.shell .chat-markdown h4, .shell .chat-markdown h5, .shell .chat-markdown h6 { margin: var(--space-3) 0 var(--space-2); font-weight: 600; line-height: var(--line-height-2); }
.shell .chat-markdown p { margin: 0 0 var(--space-3); }
.shell .chat-markdown ul, .shell .chat-markdown ol { margin: 0 0 var(--space-2); padding-left: var(--space-5); }
.shell .chat-markdown li { margin: var(--space-1) 0; }
.shell .chat-markdown blockquote {
  margin: 0 0 var(--space-2);
  padding-left: var(--space-3);
  border-left: 2px solid var(--gray-a5);
  color: var(--gray-11);
}
.shell .chat-markdown hr { margin: var(--space-3) 0; border: 0; border-top: 1px solid var(--gray-a5); }
.shell .chat-markdown code {
  padding: 0 var(--space-1);
  border-radius: var(--radius-2);
  background: var(--gray-3);
  font-family: var(--code-font-family);
}
.shell .chat-markdown pre {
  max-height: 15rem;
  overflow: auto;
  margin: 0 0 var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-2);
  background: var(--gray-2);
  white-space: pre-wrap;
  max-width: 100%;
  font-family: var(--code-font-family);
}
.shell .chat-markdown pre code { padding: 0; background: transparent; }
.shell .chat-markdown a { color: var(--accent-11); }
.shell .chat-markdown table { border-collapse: collapse; width: 100%; margin: 0 0 var(--space-2); }
.shell .chat-markdown th, .shell .chat-markdown td { border: 1px solid var(--gray-5); padding: var(--space-1) var(--space-2); }

.radix-themes .workspace-checking { grid-column: 1 / -1; grid-row: 1 / -1; }

.radix-themes .file-dialog { max-width: min(520px, calc(100vw - 32px)); }
.radix-themes .confirm-dialog { z-index: 56; }
.radix-themes .file-dialog.chapter-ops-dialog { max-width: min(680px, calc(100vw - 32px)); }
.radix-themes .file-dialog.export-preview-dialog { max-width: min(640px, calc(100vw - 32px)); }
.radix-themes .chapter-ops-card { min-width: 0; }
.radix-themes .chapter-ops-dialog .proposal-card .proposal-actions { display: flex; width: auto; justify-content: flex-end; }
.radix-themes .chapter-ops-dialog .proposal-card .proposal-actions button { width: auto; }
.radix-themes .file-dialog-actions { max-height: clamp(160px, calc(100dvh - 300px), 520px); }
.radix-themes .preset-picker-dialog .file-dialog-actions button { width: 100%; text-align: left; }

/* ── Focus mode / layout toggles ────────────────────────── */
.shell.layout-shell { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.layout-shell > .chrome { grid-column: 1; grid-row: 1; }
.shell .shell-panels { grid-column: 1; grid-row: 2; min-height: 0; display: flex; }
.shell .shell-panels [data-panel] { min-width: 0; min-height: 0; }
.shell .shell-panels [data-panel] > div { height: 100%; min-width: 0; }
.shell .shell-panel { height: 100%; min-height: 0; background: var(--gray-2); }
.shell .shell-panel.editor-cell { background: var(--color-background); }
.shell .shell-panel > .sidebar, .shell .shell-panel > .editor, .shell .shell-panel > .editor-stack, .shell .shell-panel > .empty-paper, .shell .shell-panel > .chat, .shell .shell-panel > .pinned-pane { height: 100%; }
.shell.assistant-overlay .shell-panels,
.shell.assistant-overlay #assistant,
.shell.assistant-overlay #assistant > div {
  overflow: visible !important;
}
.shell.assistant-overlay #assistant > div {
  max-width: none !important;
}
.shell .editor-cell { position: relative; background: var(--color-background); }
.shell .editor-cell > .center-overlays { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.shell .center-overlays [data-dsh-center-overlay] { height: 100%; min-width: 0; min-height: 0; overflow: auto; background: var(--color-panel-solid); pointer-events: auto; }
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .editor,
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .editor-stack,
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .empty-paper { display: none !important; }
.shell.layout-shell.focus-mode .editor-header { justify-content: center; }
.shell.layout-shell.focus-mode .editor-header .chapter-navigation { display: none; }
.shell.layout-shell.focus-mode .editor-header [data-testid="paper-wordcount"],
.shell.layout-shell.focus-mode .editor-header [data-testid="paper-save-state"] { opacity: .45; }
.shell.layout-shell.focus-mode .paper-input { padding: 56px 64px; max-width: 880px; margin-inline: auto; }
.shell.layout-shell.focus-mode .editor-tools { justify-content: center; }

.shell.no-session { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.no-session > .chrome { grid-column: 1; }
.shell.no-session > .empty-paper { grid-column: 1; grid-row: 2; overflow: auto; padding: clamp(40px, 8vw, 112px) var(--space-5); }

/* ── Command palette (Cmd/Ctrl+K) ────────────────────────── */
.palette-overlay { position: fixed; z-index: 40; inset: 0; background: var(--gray-a6); }
.palette-overlay[data-state="open"] { animation: palette-overlay-in 150ms ${EASE}; }
.palette-overlay[data-state="closed"] { animation: palette-overlay-out 150ms ${EASE}; }
.palette-content { position: fixed; z-index: 41; top: 20vh; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); max-height: min(540px, 64dvh); display: flex; flex-direction: column; padding: 0; border: 1px solid var(--gray-a6); border-radius: var(--radius-4); background: var(--color-panel-solid); box-shadow: var(--shadow-5); overflow: hidden; }
.palette-content[data-state="open"] { animation: palette-content-in 250ms ${EASE}; }
.palette-content[data-state="closed"] { animation: palette-content-out 150ms ${EASE} forwards; }
@keyframes palette-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes palette-overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes palette-content-in { from { opacity: 0; transform: translate(-50%, -16px) scale(.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes palette-content-out { from { opacity: 1; transform: translate(-50%, 0) scale(1); } to { opacity: 0; transform: translate(-50%, 8px) scale(.98); } }

.palette-command { display: flex; flex-direction: column; min-height: 0; }
.palette-search { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--gray-a5); }
.palette-search:focus-within { border-bottom-color: var(--accent-9); }
.palette-search-icon { display: grid; place-items: center; color: var(--gray-10); }
.palette-input, input[cmdk-input] { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; outline: 0; color: var(--gray-12); font: 500 var(--font-size-4)/1.3 var(--default-font-family); }
.palette-input::placeholder, input[cmdk-input]::placeholder { color: var(--gray-10); font-weight: 400; }
.palette-kbd { display: inline-grid; place-items: center; }
.palette-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--space-2); }
.palette-empty { padding: var(--space-5) var(--space-3); text-align: center; color: var(--gray-11); font-size: var(--font-size-2); }
.palette-group { padding: var(--space-1) 0; }
.palette-group + .palette-group { border-top: 1px solid var(--gray-a4); margin-top: var(--space-1); padding-top: var(--space-2); }
.palette-group [cmdk-group-heading], [cmdk-group-heading] { padding: var(--space-1) var(--space-3); font-size: var(--font-size-1); letter-spacing: .08em; color: var(--gray-11); text-transform: uppercase; }
.palette-item, [cmdk-item] { display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-2); border-radius: var(--radius-3); cursor: pointer; color: var(--gray-11); }
.palette-item[data-selected="true"], [cmdk-item][data-selected="true"] { background: var(--accent-a3); color: var(--gray-12); }
.palette-item[data-disabled="true"], [cmdk-item][data-disabled="true"] { opacity: .5; cursor: not-allowed; }
.palette-item-icon { display: grid; place-items: center; width: var(--space-6); height: var(--space-6); border-radius: var(--radius-2); background: var(--gray-3); color: var(--accent-9); flex: none; }
.palette-item[data-selected="true"] .palette-item-icon { background: var(--accent-9); color: var(--accent-contrast); }
.palette-item-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.palette-item-label { font: 500 var(--font-size-2)/1.3 var(--default-font-family); color: var(--gray-12); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-item-hint { font-size: var(--font-size-1); color: var(--gray-11); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-footer { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--gray-a5); color: var(--gray-10); font-size: var(--font-size-1); background: var(--gray-2); }
.palette-footer > span { display: inline-flex; align-items: center; gap: var(--space-1); }

@media (max-width: 760px) {
  .palette-content { top: 12vh; max-height: 70dvh; }
}

/* ── Writing settings ───────────────────────────────────── */
.radix-themes .writing-settings { display: flex; flex-direction: column; gap: var(--space-4); max-width: 560px; }
.radix-themes .writing-settings fieldset { margin: 0; padding: 0; border: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.radix-themes .writing-settings legend { padding: 0; }
.radix-themes .writing-settings .paper-typography .slider-row { display: grid; gap: var(--space-1); }

/* ── Settings dialog ────────────────────────────────────── */
.radix-themes .settings-dialog {
  width: min(960px, calc(100vw - 96px));
  max-width: 960px;
  height: min(720px, calc(100dvh - 64px));
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  padding: 0;
  overflow: hidden;
}
.radix-themes .settings-tabs { display: contents; }
.radix-themes .settings-nav {
  display: flex; flex-direction: column; min-height: 0; overflow: auto;
  padding: var(--space-4) var(--space-3);
  border-right: 1px solid var(--gray-a5);
  background: var(--gray-2);
}
.radix-themes .settings-nav [role="tablist"] {
  display: flex; flex-direction: column; width: 100%;
}
.radix-themes .settings-nav .settings-tab {
  justify-content: flex-start; width: 100%;
}
.radix-themes .settings-body { min-width: 0; min-height: 0; overflow: hidden; }
.radix-themes .settings-header { flex: none; border-bottom: 1px solid var(--gray-a5); }
.radix-themes .settings-page { min-width: 0; }
.radix-themes .settings-pages {
  position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; outline: none;
}
.radix-themes .settings-content { min-height: 0; overflow: visible; padding: var(--space-4) var(--space-5); }
.radix-themes .settings-content[hidden] { display: none; }
.radix-themes .settings-content.is-active { position: relative; z-index: 1; display: block; }
.radix-themes .settings-content:has(.dsh-plugins) { padding-right: var(--space-4); }

.radix-themes .accent-swatch {
  width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
  box-shadow: 0 0 0 1px var(--gray-a6);
}
.radix-themes .accent-swatch[data-swatch="indigo"] { background: var(--indigo-9); }
.radix-themes .accent-swatch[data-swatch="pine"] { background: var(--green-9); }
.radix-themes .accent-swatch[data-swatch="ochre"] { background: var(--amber-9); }
.radix-themes .accent-swatch[data-swatch="violet"] { background: var(--violet-9); }
.radix-themes .accent-swatch.active {
  box-shadow: 0 0 0 2px var(--color-panel-solid), 0 0 0 4px var(--gray-11);
}

.radix-themes .select { position: relative; display: inline-block; min-width: 0; }
.radix-themes .settings-dialog .select-trigger { min-width: 160px; }

.radix-themes .models-writing-route-controls > .select { flex: 0 1 18rem; min-width: 12rem; max-width: 100%; }
.radix-themes .models-writing-route .model-effort .select-trigger { width: auto; }
.shell .sidebar-tools { min-width: 0; }
@keyframes shell-panel-enter { from { opacity: 0; transform: translateY(6px); } }
.shell .sidebar-tools > *:not(.memory-panel):not(.proofread-panel) { animation: shell-panel-enter 200ms ${EASE}; }
.radix-themes .models-rows { margin: 0; padding: 0; list-style: none; }
.radix-themes .models-add-card { border-style: dashed; }
.radix-themes .models-editor { display: grid; gap: var(--space-3); }
.radix-themes .models-input-id { flex: 1 1 200px; }
.radix-themes .models-input-name { flex: 1 1 200px; }
.radix-themes .models-field-row { display: grid; grid-template-columns: 120px minmax(0, 1fr); align-items: center; gap: var(--space-3); }
.radix-themes .models-credential-dot { width: 8px; height: 8px; flex: none; border-radius: 999px; }
.radix-themes .models-credential-dot-configured { background: var(--green-9); }
.radix-themes .models-credential-dot-missing { background: var(--red-9); }
.radix-themes .models-button-add { align-self: flex-start; }
.radix-themes .models-customized > summary { cursor: pointer; list-style: none; }
.radix-themes .models-customized > summary::-webkit-details-marker { display: none; }
.radix-themes .models-overlay { z-index: 50; }
.radix-themes .models-candidate-dialog { width: min(560px, 100%); max-height: min(640px, calc(100dvh - 48px)); }
.radix-themes .models-candidate-list { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; max-height: 360px; overflow: auto; }
.radix-themes .models-candidate-dialog .models-candidate-label { display: flex; align-items: center; gap: var(--space-2); }

.radix-themes .about-release-body { white-space: pre-wrap; max-height: 220px; overflow: auto; }
.radix-themes .preset-badge { display: inline-flex; align-items: center; margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: var(--accent-a3); color: var(--accent-11); font: 500 var(--font-size-1)/1.4 var(--default-font-family); }
.radix-themes .update-toast { position: fixed; right: var(--space-4); bottom: var(--space-4); z-index: 40; }

.radix-themes .usage-chart-plot { width: 100%; height: 200px; min-height: 160px; max-height: 220px; }
.usage-chart-tooltip { max-width: min(280px, calc(100vw - 32px)); white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.radix-themes .usage-chart-legend { margin: 0; padding: 0; list-style: none; }
.radix-themes .usage-chart-legend li { display: inline-flex; align-items: center; gap: var(--space-2); }
.radix-themes .usage-chart-chip { width: 10px; height: 10px; flex: none; border-radius: var(--radius-2); }
.radix-themes .usage-chart-table > summary { cursor: pointer; color: var(--gray-11); }
.radix-themes .usage-chart-table table { width: 100%; margin-top: var(--space-2); border-collapse: collapse; }
.radix-themes .usage-chart-table th, .radix-themes .usage-chart-table td {
  padding: var(--space-1) var(--space-2); text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid var(--gray-a4);
}
.radix-themes .usage-chart-table th:first-child, .radix-themes .usage-chart-table td:first-child { text-align: left; }

@media (max-width: 1040px) {
  .radix-themes .editor-header { padding-inline: 20px; }
}
@media (max-width: 760px) {
  .editor-header { padding-inline: 12px; }
  .paper-input { padding: 28px 22px; font-size: 16px; }
}

/* ── 活动反馈(ui/activity.tsx + 面板共享类) ─────────────── */
.radix-themes .activity-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; }
.radix-themes .activity-text .activity-dots { margin-inline-end: 0; }
.radix-themes button .activity-dots:only-child { margin-inline-end: 0; }
.radix-themes .activity-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; }
.radix-themes .activity-dots.is-pulse i { animation: shell-activity-pulse 1.4s ${EASE} infinite; }
.radix-themes .activity-dots.is-typing i { animation: shell-activity-typing .6s ease-in-out infinite; }
.radix-themes .activity-dots.is-pulse i:nth-child(2) { animation-delay: .2s; }
.radix-themes .activity-dots.is-pulse i:nth-child(3) { animation-delay: .4s; }
.radix-themes .activity-dots.is-typing i:nth-child(2) { animation-delay: .15s; }
.radix-themes .activity-dots.is-typing i:nth-child(3) { animation-delay: .3s; }
.radix-themes .activity-ring { display: inline-block; vertical-align: middle; color: var(--accent-9); }
.radix-themes .activity-shimmer { position: relative; display: block; width: 96px; height: 3px; border-radius: 999px; background: var(--gray-a6); overflow: hidden; }
.radix-themes .activity-shimmer i { position: absolute; top: 0; bottom: 0; left: 0; width: 33%; border-radius: inherit; background: var(--accent-9); opacity: .5; animation: shell-activity-shimmer 1.5s ease-in-out infinite; }
.radix-themes .activity-skeleton { display: grid; gap: 8px; }
.radix-themes .panel-activity-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; }
.radix-themes .panel-activity-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: shell-activity-pulse 1.4s ${EASE} infinite; }
.radix-themes .panel-activity-dots i:nth-child(2) { animation-delay: .2s; }
.radix-themes .panel-activity-dots i:nth-child(3) { animation-delay: .4s; }
.radix-themes .panel-skeleton { display: grid; gap: var(--space-2); }
.radix-themes .panel-skeleton i { position: relative; display: block; height: 10px; border-radius: var(--radius-2); background: var(--gray-a5); overflow: hidden; }
.radix-themes .panel-skeleton i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--gray-a3), transparent); animation: shell-activity-sheen 1.5s linear infinite; }
.radix-themes .activity-text { display: inline-flex; align-items: center; gap: 6px; animation: shell-fade-in 250ms ${EASE} both; }
.radix-themes .success-mark { display: inline-block; width: 1.1em; height: 1.1em; color: var(--green-9); vertical-align: -.15em; }
.radix-themes .success-mark path { stroke: currentColor; stroke-dasharray: 42; stroke-dashoffset: 0; animation: shell-success-draw 250ms ${EASE}; }
.radix-themes .import-working { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--gray-11); }
.radix-themes .activity-reveal { animation: shell-fade-in 250ms ${EASE} both; }
.radix-themes .models-loading { max-width: 480px; margin-top: 12px; }
.radix-themes .usage-loading { max-width: 420px; margin-top: 12px; }
.radix-themes .models-writing-route .route-saving { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; color: var(--gray-10); }
.radix-themes .models-writing-route .route-saving .activity-dots { margin-inline-end: 0; }
.radix-themes .export-loading { display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-5) 0 var(--space-2); color: var(--gray-11); }
.radix-themes .export-loading .activity-skeleton { width: min(320px, 100%); }
.radix-themes .writing-progress-settings .goal-saving { display: inline-flex; align-items: center; margin-inline-start: 6px; color: var(--gray-10); vertical-align: middle; }
.radix-themes .writing-progress-settings .goal-saving .activity-dots { margin-inline-end: 0; }

@media (prefers-reduced-motion: reduce) {
  .shell *, .shell *::before, .shell *::after,
  .palette-overlay, .palette-overlay::before, .palette-overlay::after,
  .palette-content, .palette-content *, .palette-content *::before, .palette-content *::after,
  .select-list, .select-list *, .select-list *::before, .select-list *::after,
  [data-radix-popper-content-wrapper], [data-radix-popper-content-wrapper] * {
    scroll-behavior: auto !important;
    transition: none !important;
    animation: none !important;
    filter: none !important;
  }
  .shell *:hover, .shell *:active { transform: none !important; }
  .radix-themes .settings-page { opacity: 1 !important; transform: none !important; }
  .radix-themes .ghost.is-loading { animation: none; color: var(--gray-9); background: none; }
  .radix-themes .panel-activity-dots i,
  .radix-themes .panel-skeleton i::after { animation: none !important; }
}
`

export const redesignedStyles = `${themeStyles}${baseStyles}${componentStyles}`
