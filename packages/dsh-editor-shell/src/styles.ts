/*
 * DSH Editor shell — three-layer visual system.
 *
 *   tokens    : paper/ink colour, type, space, radius, elev. Driven by
 *               :root[data-theme="paper"|"ink"]. Default is paper.
 *   base      : reset, typography, focus ring, scrollbar. Applies inside
 *               the .shell root so it never leaks onto DSH host chrome.
 *   components: visual mapping of the Open Design draft onto the existing
 *               DOM class names. Removed features (snapshot/import/archive/
 *               export/search/shortcut/worldbook-panel) had no surviving
 *               class to map, so their CSS is gone too.
 *
 * Kept: prefers-reduced-motion, 1040px (chat collapse) and 760px
 * (sidebar collapse) responsive breakpoints, focus ring.
 *
 * Dropped: body[data-ds-dark-theme] — the new data-theme is the only
 * theme switch.
 */

export const tokenStyles = `
:root,
:root[data-theme="paper"] {
  --bg: #f5f4ed;
  --surface: #faf9f5;
  --surface-warm: #e8e6dc;
  --fg: #141413;
  --fg-2: #3d3d3a;
  --muted: #504e49;
  --meta: #6b6a64;
  --border: #e8e6dc;
  --border-soft: #e5e3d8;
  --accent: #1b365d;
  --accent-on: #faf9f5;
  --accent-active: #142a48;
  --ghost: #78756c;
  --selection: #e4e6dc;
  --danger: #8a3a30;
  --confirm: #4a6b3a;
  --elev-raised: 0 4px 24px rgba(20, 20, 19, 0.05);
  --studio: #141413;
  color-scheme: light;
}
:root[data-theme="ink"] {
  --bg: #1a1815;
  --surface: #24211c;
  --surface-warm: #2f2b25;
  --fg: #e8e4d6;
  --fg-2: #c8c3b5;
  --muted: #a39e90;
  --meta: #8e8a7c;
  --border: #3a362f;
  --border-soft: #2c2924;
  --accent: #8aa4c0;
  --accent-on: #1a1815;
  --accent-active: #6e8fb0;
  --ghost: #938e80;
  --selection: #2a3140;
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

export const baseStyles = `
.shell, .shell *, .shell *::before, .shell *::after { box-sizing: border-box; }
.shell {
  width: 100%;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: var(--tree-w) minmax(0, 1fr) var(--chat-w);
  grid-template-rows: var(--topbar-h) minmax(0, 1fr);
  background: var(--bg);
  color: var(--fg);
  font: 400 var(--text-sm)/1.45 var(--font-sans);
  overflow: hidden;
}
.shell button, .shell input, .shell select, .shell textarea { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; }
.shell button { cursor: pointer; }
.shell textarea { resize: none; outline: none; }
.shell :focus { outline: none; }
.shell :focus-visible { box-shadow: var(--focus-ring); }
.shell button:disabled { cursor: not-allowed; opacity: .55; }
.shell .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.shell .muted, .shell .local-state { color: var(--muted); }
.shell .warning { color: var(--danger); }
.shell .success { color: var(--confirm); }
.shell .pad { margin: 0; padding: 7px 10px; font-size: var(--text-sm); }
.shell ::-webkit-scrollbar { width: 8px; height: 8px; }
.shell ::-webkit-scrollbar-track { background: transparent; }
.shell ::-webkit-scrollbar-thumb { background: var(--border); border-radius: var(--radius-sm); }
`

export const componentStyles = `
/* ── Top bar ─────────────────────────────────────────────── */
.shell > .chrome {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: var(--tree-w) minmax(0, 1fr) var(--chat-w);
  align-items: center;
  height: var(--topbar-h);
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg-2);
  min-width: 0;
}
.shell > .chrome > * { min-width: 0; padding: 0 var(--space-4); }
.shell > .chrome > .workspace-chrome { border-left: 1px solid var(--border); border-right: 1px solid var(--border); padding: 0 var(--space-5); }
.shell > .chrome > .topbar-actions { justify-content: flex-end; gap: var(--space-4); }
.shell .brand-lockup { display: flex; align-items: center; gap: 8px; flex: none; font-size: var(--text-sm); letter-spacing: .08em; }
.shell .brand-mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-on); font-weight: 700; font-size: 12px; }
.shell .workspace-chrome { display: flex; align-items: center; gap: 2px; }
.shell .workspace-chrome .project-switcher, .shell .workspace-chrome .workspace-menu { position: relative; }
.shell .workspace-chrome details > summary { display: flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 10px; border: 0; background: transparent; cursor: pointer; list-style: none; font-weight: 500; letter-spacing: .04em; color: var(--fg); border-radius: var(--radius-sm); white-space: nowrap; flex-shrink: 0; }
.shell .workspace-chrome details > summary::-webkit-details-marker { display: none; }
.shell .workspace-chrome details > summary > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-chrome details > summary::after { content: '⌄'; font-size: 11px; color: var(--meta); }
.shell .workspace-chrome details[open] > summary, .shell .workspace-chrome details > summary:hover { background: var(--surface); }
.shell .workspace-menu-panel { position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; width: 240px; max-height: min(360px, 70dvh); overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); }
.shell .workspace-menu-actions { display: grid; gap: 2px; }
.shell .workspace-menu-actions button { width: 100%; padding: 7px 9px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); }
.shell .workspace-menu-actions button:hover { background: var(--surface); color: var(--fg); }
.shell .workspace-menu-actions button[aria-current="true"] { color: var(--accent); font-weight: 600; }
.shell .file-context-menu { position: fixed; z-index: 30; min-width: 168px; padding: 6px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); }
.shell .file-context-menu button { width: 100%; padding: 7px 9px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); }
.shell .file-context-menu button:hover, .shell .file-context-menu button:focus-visible { background: var(--surface); color: var(--fg); }
.shell .path-fallback { display: grid; gap: 7px; margin: 7px 2px 2px; padding: 8px 2px 0; border-top: 1px solid var(--border); }
.shell .path-fallback label { display: grid; gap: 4px; font-size: var(--text-sm); color: var(--muted); }
.shell .path-fallback input { min-width: 0; padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); }
.shell .path-fallback > div { display: flex; gap: 6px; }
.shell .path-fallback button { padding: 6px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: transparent; cursor: pointer; }
.shell .layout-controls { display: flex; align-items: center; gap: 2px; }
.shell .layout-controls button { display: flex; align-items: center; justify-content: center; min-width: 30px; height: 26px; padding: 0 8px; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--text-xs); letter-spacing: .1em; color: var(--meta); }
.shell .layout-controls button:hover, .shell .layout-controls button[aria-pressed="true"] { background: var(--surface); color: var(--fg); }
.shell .layout-controls button[aria-pressed="true"] { color: var(--accent); font-weight: 600; }
.shell .topbar-actions { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.shell .topbar-actions > span { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .icon-button { display: grid; place-items: center; min-width: 28px; min-height: 28px; padding: 3px; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; color: var(--meta); }
.shell .icon-button:hover { background: var(--surface); color: var(--fg); }
.shell .native-settings-control { display: flex; align-items: center; }
.shell .native-settings-control button { white-space: nowrap; padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; color: var(--fg); font-size: var(--text-sm); }

/* ── Theme switch ────────────────────────────────────────── */
.shell .theme-toggle {
  display: flex;
  align-items: stretch;
  height: 26px;
  background: var(--surface);
  box-shadow: var(--elev-ring);
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 500;
  letter-spacing: .14em;
  color: var(--meta);
  padding: 0 10px;
  line-height: 26px;
}
.shell .theme-toggle:hover { background: var(--surface-warm); color: var(--fg); }

/* ── Sidebar / tree ─────────────────────────────────────── */
.shell > .sidebar { grid-row: 2; min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg); }
.shell .side-title { display: flex; align-items: center; justify-content: space-between; padding: 14px 10px 8px; font-size: var(--text-xs); font-weight: 500; letter-spacing: .16em; color: var(--meta); }
.shell .side-title .icon-button { font-size: 14px; }
.shell .tree { flex: 1 1 auto; min-height: 72px; overflow: auto; padding: 4px 6px 20px; display: flex; flex-direction: column; gap: 14px; }
.shell .tree-static-groups, .shell .tree-manuscript { display: flex; flex-direction: column; gap: 14px; }
.shell .tree-static-group { display: flex; flex-direction: column; gap: 2px; }
.shell .tree-directory-row { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; padding: 4px 10px 6px; }
.shell .tree-static-row { font-size: var(--text-xs); font-weight: 500; letter-spacing: .16em; color: var(--meta); }
.shell .tree-marker { width: 12px; flex: none; color: var(--meta); text-align: center; font-size: 11px; }
.shell .tree-static-row .tree-marker { font-size: 14px; }
.shell .tree-manuscript-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px 6px; }
.shell .tree-manuscript-header > span { font-size: var(--text-xs); font-weight: 500; letter-spacing: .16em; color: var(--meta); }
/* Manuscript section header: same shape as the static group rows (大纲/人物卡/世界书)
   so the user can collapse 正文 to focus on docs/notes, but styled like a section
   divider — small caps, muted, no rounded background. The class is also picked
   up by the visual-audit selector that matches a tree-row containing 正文. */
.shell .tree-row.tree-manuscript-row {
  padding: 4px 10px 6px;
  border-radius: 0;
  font-size: var(--text-xs);
  font-weight: 500;
  letter-spacing: .16em;
  color: var(--meta);
}
.shell .tree-row.tree-manuscript-row:hover { background: transparent; color: var(--fg); }
.shell .tree-directory-add { width: 18px; height: 18px; flex: none; display: grid; place-items: center; border: 0; border-radius: var(--radius-xs); background: transparent; cursor: pointer; opacity: .68; color: var(--meta); font-size: 14px; }
.shell .tree-directory-add:hover, .shell .tree-directory-add:focus-visible { opacity: 1; background: var(--surface); color: var(--fg); }
.shell .tree-row, .shell .tree-file-row { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; color: var(--fg-2); font-size: var(--text-base); line-height: 1.35; letter-spacing: .04em; }
.shell .tree-row > span:last-child, .shell .tree-file-row > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .tree-row:hover, .shell .tree-file-row:hover { background: var(--surface); color: var(--fg); }
.shell .tree-row[aria-current="page"], .shell .tree-file-row[aria-current="page"] { background: var(--surface-warm); color: var(--fg); }
.shell .tree-row.danger, .shell .tree-file-row.danger { color: var(--danger); }

/* ── Columns / paper / chat ─────────────────────────────── */
.shell .panel-resizer { grid-row: 2; position: relative; z-index: 4; cursor: col-resize; background: var(--border); }
.shell .panel-resizer span { position: absolute; inset: 0; }
.shell .panel-resizer:hover, .shell .panel-resizer:focus-visible { background: var(--accent); }

/* ── Editor / paper ─────────────────────────────────────── */
.shell .editor { grid-row: 2; min-width: 0; min-height: 0; display: grid; grid-template-rows: var(--topbar-h) minmax(0, 1fr) auto; background: var(--surface); position: relative; z-index: 1; box-shadow: var(--elev-raised); }
.shell .editor-header { display: flex; align-items: center; gap: var(--space-4); min-width: 0; height: var(--topbar-h); padding: 0 28px 0 20px; border-bottom: 1px solid var(--border-soft); background: var(--surface); color: var(--meta); font-size: var(--text-xs); letter-spacing: .1em; }
.shell .editor-header > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-family: var(--font-serif); font-size: var(--text-md); font-weight: 500; letter-spacing: .12em; }
.shell .editor-header > span:last-child { margin-left: auto; white-space: nowrap; }
.shell .editor-header > .editor-notice { margin-left: auto; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .chapter-navigation { display: flex; align-items: center; gap: 2px; }
.shell .chapter-navigation > span { font-size: 11px; color: var(--meta); padding: 0 4px; }
.shell .chapter-navigation button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; color: var(--meta); font-size: 16px; line-height: 1; }
.shell .chapter-navigation button:hover { background: var(--bg); color: var(--fg); }
.shell .chapter-status-control { display: flex; align-items: center; gap: 6px; }
.shell .chapter-status-control select { padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg); font-size: var(--text-xs); letter-spacing: .12em; }

.shell .paper-input {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 36px 64px 32px;
  border: 0;
  resize: none;
  background: transparent;
  color: var(--fg);
  caret-color: var(--accent);
  font: 400 var(--text-body)/var(--leading-body) var(--font-serif);
  letter-spacing: .03em;
  outline: 0;
  display: block;
}
/* The paper <textarea> lives inside the .paper-input wrapper and ships with
   an inline font-family from editor-core's PAPER_SURFACE default. Inline styles
   outrank the wrapper rule above, so the descendant selector with !important
   forces the shell's serif stack onto the editable surface. */
.shell .paper-input [data-testid$="-editor"] {
  font: 400 var(--text-body)/var(--leading-body) var(--font-serif) !important;
  letter-spacing: .03em !important;
  color: var(--fg) !important;
  background: transparent !important;
  caret-color: var(--accent) !important;
}
.shell .paper-input::placeholder { color: var(--meta); font-style: italic; }
.shell .paper-scroll { max-width: 36em; margin: 0 auto; }

/* Mirrored ghost suggestion. Same type, lower contrast. */
.shell .ghost { color: var(--ghost); font: inherit; letter-spacing: inherit; line-height: inherit; }
.shell .ghost.is-loading { color: transparent; background-image: linear-gradient(90deg, var(--ghost) 0%, var(--fg-2) 46%, var(--ghost) 100%); background-size: 180% 100%; background-clip: text; -webkit-background-clip: text; animation: ghost-shimmer 1.35s var(--ease) infinite; }

@keyframes ghost-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -80% 0; } }

.shell .editor-tools { display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 28px 0 24px; border-top: 1px solid var(--border-soft); background: var(--surface); color: var(--meta); flex-shrink: 0; }
.shell .editor-tools button, .shell .primary-action, .shell .composer button, .shell .proposal button, .shell .pending-card button, .shell .file-dialog button { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 5px 12px; border-radius: var(--radius-md); font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .08em; transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease); border: 0; cursor: pointer; }
.shell .editor-tools button, .shell .pending-card button, .shell .file-dialog button { box-shadow: var(--elev-ring); background: transparent; color: var(--fg-2); }
.shell .editor-tools button:hover, .shell .pending-card button:hover, .shell .file-dialog button:hover { background: var(--surface); color: var(--fg); }
.shell .editor-tools button:active, .shell .pending-card button:active, .shell .file-dialog button:active { background: var(--surface-warm); }
.shell .primary-action { background: var(--accent); color: var(--accent-on); box-shadow: var(--elev-ring-accent); }
.shell .primary-action:hover { box-shadow: var(--elev-ring-accent), var(--elev-raised); }
.shell .primary-action:active { background: var(--accent-active); }
.shell .danger-action { color: var(--danger) !important; box-shadow: 0 0 0 1px var(--danger) !important; }
.shell .danger-link { color: var(--danger) !important; }
.shell .editor-tools .ghost-actions { display: flex; gap: 4px; align-items: center; padding: 0 4px; }
.shell .editor-tools .ghost-actions > strong { font-weight: 500; letter-spacing: .04em; }
.shell .editor-tools .ghost-actions > small { font-size: 11px; color: var(--meta); }
.shell .editor-tools .ghost-actions .kbd { font-family: var(--font-mono); font-size: 10px; padding: 2px 5px; border-radius: var(--radius-xs); background: var(--bg); box-shadow: var(--elev-ring); color: var(--fg-2); margin-right: 4px; }
.shell .editor-tools .ghost-actions .fim-sep { color: var(--border); padding: 0 4px; user-select: none; }
.shell .editor-notice { font-size: var(--text-xs); color: var(--muted); padding: 4px 8px; opacity: .85; }

/* Selection patch (paper-input mirror state). */
.shell .proposal { position: relative; padding: 12px 14px 10px; margin: 14px 0 8px 2em; max-width: 32em; background: var(--bg); box-shadow: var(--elev-ring); border-radius: var(--radius-md); display: grid; gap: 8px; }
.shell .proposal > strong { font: 500 var(--text-sm)/1.4 var(--font-sans); letter-spacing: .08em; color: var(--fg); }
.shell .proposal p { margin: 0; white-space: pre-wrap; font: 400 16px/1.85 var(--font-serif); letter-spacing: .03em; color: var(--fg-2); }
.shell .proposal p:last-child { color: var(--fg); }
.shell .proposal-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
.shell .selection-diff { display: grid; gap: 6px; }
.shell .selection-diff section { display: grid; gap: 4px; }
.shell .selection-diff section small { font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .12em; color: var(--meta); }
.shell .proposal-conflict { padding: 6px 10px; border-top: 1px solid var(--border-soft); font-size: var(--text-xs); color: var(--danger); background: var(--surface); }

/* ── Chat ───────────────────────────────────────────────── */
.shell > .chat { grid-row: 2; min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; border-left: 1px solid var(--border); background: var(--bg); }
.shell > .chat[hidden] { display: none !important; }
/* Header holds four children (brand / conversation select / model controls /
   actions). Two grid rows: row 1 = brand + select + actions, row 2 = the
   model indicator line. A fixed topbar height here overflowed and overlapped
   the history below. */
.shell .chat-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 6px var(--space-4); border-bottom: 1px solid var(--border-soft); background: var(--bg); }
.shell .chat-brand { display: flex; align-items: center; gap: 6px; font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .08em; color: var(--fg); }
.shell .whale-mark { width: 18px; height: 18px; color: var(--accent); }
.shell .chat-header-actions { display: flex; gap: 2px; }
.shell .chat-controls { grid-column: 1 / -1; grid-row: 2; min-width: 0; }
.shell .compact-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
.shell .compact-control button { padding: 0; border: 0; background: none; color: var(--meta); font-size: var(--text-xs); cursor: pointer; text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; }
.shell .compact-control button:hover { color: var(--fg); }
.shell .conversation-select { min-width: 0; display: flex; align-items: center; gap: 4px; }
.shell .conversation-select select { min-width: 0; max-width: 180px; border: 0; background: transparent; color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .model-indicator { display: block; overflow: hidden; color: var(--meta); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }

.shell .chat-history { display: flex; flex-direction: column; gap: var(--space-5); min-height: 0; overflow: auto; padding: var(--space-5) var(--space-4) var(--space-4); }
.shell .chat-row { margin: 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.shell .chat-row > .msg-role, .shell .chat-row > p:first-child, .shell .chat-row > strong:first-child { display: block; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .14em; color: var(--meta); margin-bottom: 8px; }
.shell .chat-row p { margin: 0; white-space: pre-wrap; line-height: 1.7; }
.shell .chat-row.user { margin-left: 20px; }
.shell .chat-row.user p { color: var(--fg-2); font-size: var(--text-base); }
.shell .chat-row.assistant p { font: 400 var(--text-md)/1.85 var(--font-serif); letter-spacing: .03em; color: var(--fg); padding-left: 12px; border-left: 2px solid var(--accent); }
.shell .chat-row.tool, .shell .chat-row.notice, .shell .chat-row.unknown { color: var(--muted); font-size: var(--text-xs); }
.shell .chat-guide { display: grid; gap: var(--space-3); }
.shell .chat-guide-examples { display: grid; gap: 4px; }
.shell .chat-guide-examples button { padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; color: var(--fg-2); font-size: var(--text-sm); }
.shell .chat-guide-examples button:hover { background: var(--surface); color: var(--fg); }

.shell .composer { border-top: 1px solid var(--border); padding: 12px var(--space-4) 14px; background: var(--bg); display: flex; align-items: flex-end; gap: var(--space-2); }
.shell .composer textarea { flex: 1; min-height: 64px; max-height: 120px; padding: 10px 12px; background: var(--surface); box-shadow: var(--elev-ring); border-radius: var(--radius-md); font-size: var(--text-base); line-height: 1.65; letter-spacing: .04em; color: var(--fg); resize: none; }
.shell .composer textarea::placeholder { color: var(--meta); }
.shell .composer .send { flex: none; width: 36px; height: 36px; display: grid; place-items: center; color: var(--fg-2); border: 0; background: transparent; border-radius: var(--radius-md); cursor: pointer; }
.shell .composer .send:hover { background: var(--surface-warm); color: var(--fg); }
.shell .composer .send svg { display: block; }

.shell .pending-card { display: grid; gap: var(--space-3); padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.shell .pending-card fieldset { display: grid; gap: 5px; margin: 0; padding: 0; border: 0; }
.shell .pending-card input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg); }
.shell .proposal-card { display: grid; gap: var(--space-3); padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.shell .proposal-card header, .shell .proposal-card footer { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.shell .proposal-card pre { max-height: 180px; overflow: auto; padding: 8px; background: var(--bg); white-space: pre-wrap; border-radius: var(--radius-sm); margin: 0; font: 400 var(--text-sm)/1.55 var(--font-serif); color: var(--fg-2); }

/* ── Empty / home ───────────────────────────────────────── */
.shell .empty-paper { grid-row: 2; display: grid; place-items: center; min-width: 0; min-height: 0; padding: 32px; background: var(--surface); }
.shell .empty-paper.home-stage { background: var(--bg); }
.shell .home-card { max-width: 520px; padding: 40px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); text-align: center; }
.shell .home-card h1 { margin: 0 0 12px; font: 500 34px/1.1 var(--font-serif); letter-spacing: -.04em; color: var(--fg); }
.shell .home-eyebrow { margin: 0 0 8px; color: var(--muted); font-size: var(--text-xs); font-weight: 500; letter-spacing: .14em; }
.shell .home-hint { max-width: 37em; margin: 0 auto 22px; color: var(--muted); line-height: 1.7; font-size: var(--text-base); }
.shell .home-actions { display: flex; justify-content: center; gap: 8px; }
.shell .home-recent { display: grid; gap: 10px; margin-top: 36px; padding-top: 18px; border-top: 1px solid var(--border); }
.shell .home-recent > header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.shell .home-recent h2 { margin: 0; font: 500 15px/1.2 var(--font-sans); letter-spacing: .04em; }
.shell .home-recent header small { color: var(--muted); font-size: var(--text-xs); }
.shell .home-recent-empty { color: var(--meta); font-size: var(--text-sm); }
.shell .workspace-list { display: grid; gap: 6px; }
.shell .workspace-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; padding: 7px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.shell .workspace-row .tree-row { display: grid; gap: 3px; padding: 4px; text-align: left; }
.shell .workspace-row .tree-row small { color: var(--muted); font-size: var(--text-xs); }
.shell .workspace-row .workspace-manage { align-self: start; }
.shell .workspace-relocation { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--border); color: var(--danger); font-size: var(--text-xs); }
.shell .workspace-intent-prompt { display: grid; gap: 8px; margin-top: var(--space-4); padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg); }
.shell .workspace-intent-prompt p, .shell .workspace-intent-prompt code { margin: 0; }
.shell .workspace-intent-prompt code { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-intent-prompt > div { display: flex; gap: 7px; flex-wrap: wrap; }
.shell .workspace-intent-prompt button { padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; color: var(--fg); }
.shell .workspace-checking { grid-column: 1 / -1; display: grid; place-content: center; gap: 8px; padding: 40px; text-align: center; }
.shell .workspace-checking h1, .shell .workspace-checking p { margin: 0; }
.shell .workspace-checking code { max-width: min(680px, 80vw); color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Dialogs ────────────────────────────────────────────── */
.shell .file-dialog-overlay { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 24px; background: color-mix(in srgb, var(--studio) 36%, transparent); }
.shell .file-dialog { width: min(520px, 100%); max-height: min(680px, calc(100dvh - 48px)); overflow: auto; padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); }
.shell .file-dialog header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: 14px; }
.shell .file-dialog h2 { margin: 0; font: 500 20px/1.2 var(--font-serif); letter-spacing: -.02em; }
.shell .file-dialog form, .shell .file-dialog label { display: grid; gap: 7px; }
.shell .file-dialog input, .shell .file-dialog select { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); }
.shell .file-dialog footer { display: flex; justify-content: flex-end; gap: 7px; flex-wrap: wrap; margin-top: 16px; }
.shell .file-dialog-actions { display: grid; gap: 6px; }
.shell .file-dialog-actions button { text-align: left; }

/* ── Focus mode / layout toggles ────────────────────────── */
.shell.layout-shell { grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.layout-shell > .sidebar, .shell.layout-shell > .editor, .shell.layout-shell > .empty-paper, .shell.layout-shell > .chat, .shell.layout-shell > .panel-resizer { grid-row: 2; }
.shell.layout-shell.focus-mode { grid-template-columns: minmax(0, 1fr) !important; }
.shell.layout-shell.focus-mode .editor-header { justify-content: center; }
.shell.layout-shell.focus-mode .editor-header > *:not(:first-child):not(:last-child) { display: none; }
.shell.layout-shell.focus-mode .paper-input { padding: 56px 64px; }
.shell.layout-shell.focus-mode .editor-tools { justify-content: center; }

.shell .no-session { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell .no-session > .chrome { grid-column: 1; }
.shell .no-session > .empty-paper { grid-column: 1; grid-row: 2; place-items: start center; overflow: auto; padding: clamp(40px, 8vw, 112px) 24px; }
.shell .no-session .home-card { width: min(760px, 100%); padding: clamp(32px, 5vw, 56px); text-align: left; }
.shell .no-session .home-card h1 { font-size: clamp(34px, 5vw, 56px); margin-bottom: 12px; }
.shell .no-session .home-actions { justify-content: flex-start; }

/* ── Responsive collapse ────────────────────────────────── */
@media (max-width: 1040px) {
  .shell { grid-template-columns: 196px minmax(0, 1fr); }
  .shell > .chat, .shell > .panel-resizer.right { display: none; }
  .shell > .chrome { grid-template-columns: 196px minmax(0, 1fr); }
  .shell > .chrome > .workspace-chrome { display: none; }
  .shell > .chrome > .topbar-actions { padding-right: var(--space-4); }
  .shell .editor-header { padding-inline: 20px; }
}
@media (max-width: 760px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .shell > .sidebar, .shell > .panel-resizer.left { display: none; }
  .shell > .chrome { grid-template-columns: minmax(0, 1fr); }
  .shell > .chrome > .workspace-chrome, .shell > .chrome > .layout-controls, .shell > .chrome > .topbar-actions > .settings-link { display: none; }
  .editor-header { padding-inline: 12px; }
  .paper-input { padding: 28px 22px; font-size: 16px; }
  .no-session .home-card { padding: 28px 20px; }
}

/* ── Reduced motion ─────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .shell * { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
  .shell .ghost.is-loading { animation: none; color: var(--ghost); background: none; }
}
`

/* Single concatenated string for the runtime to drop into a <style> element.
   Kept as a string so existing call sites keep working — splitting is purely
   for editorial readability above. */
export const redesignedStyles = `${tokenStyles}${baseStyles}${componentStyles}`
