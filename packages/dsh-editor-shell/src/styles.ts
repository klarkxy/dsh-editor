/*
 * DSH Editor shell — three-layer visual system.
 *
 *   tokens    : paper/ink colour, type, space, radius, elev. Driven by
 *               :root[data-theme="paper"|"ink"]. Default is paper.
 *   base      : reset, typography, focus ring, scrollbar. Applies inside
 *               the .shell root so it never leaks onto DSH host chrome —
 *               with one deliberate exception: the ink-mode select
 *               background/color revert at the end of the block, a Chromium
 *               workaround for the host settings dialog's native popup.
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
/* ── Design tokens ───────────────────────────────────────
   paper 主题继续走"羊皮纸"语义:画布(--surface)是稍亮的米白,
   --bg-sunken 比画布略深 1-2 度,给侧栏/聊天下沉让位。
   ink 主题用对称思路,但底色更深,字色更柔。
   强调色 --accent 保留墨蓝;选中/激活态用 --accent-soft 而非灰底。
   hairline 用半透明,只在确实需要实色边框的地方用 --border。 */
:root,
:root[data-theme="paper"] {
  --bg: #f3f1e8;
  --bg-sunken: #ebe9df;
  --surface: #fdfcf6;
  --surface-warm: #e8e6dc;
  --fg: #141413;
  --fg-2: #3d3d3a;
  --muted: #504e49;
  --meta: #6b6a64;
  --border: #d8d5c7;
  --border-soft: #e5e3d8;
  --hairline: rgba(20, 20, 19, 0.08);
  --hairline-strong: rgba(20, 20, 19, 0.12);
  --accent: #1b365d;
  --accent-soft: rgba(27, 54, 93, 0.08);
  --accent-on: #faf9f5;
  --accent-active: #142a48;
  --ghost: #78756c;
  --selection: #e4e6dc;
  --danger: #8a3a30;
  --confirm: #4a6b3a;
  --elev-raised: 0 8px 24px rgba(20, 20, 19, 0.06);
  --elev-card: 0 10px 28px rgba(20, 20, 19, 0.08);
  --studio: #141413;
  color-scheme: light;
}
:root[data-theme="ink"] {
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
  --selection: #2e3547;
  --danger: #c4786a;
  --confirm: #8aaa70;
  --elev-raised: 0 8px 28px rgba(8, 7, 6, 0.45);
  --elev-card: 0 12px 32px rgba(0, 0, 0, 0.5);
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
  --radius-xs: 3px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --elev-flat: none;
  --elev-ring: 0 0 0 1px var(--hairline-strong);
  --elev-ring-accent: 0 0 0 1px var(--accent);
  --focus-ring: 0 0 0 2px var(--accent-active);
  --motion-fast: 150ms;
  --motion-base: 200ms;
  --motion-emphasis: 260ms;
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
  height: 100dvh;
  display: grid;
  grid-template-columns: var(--tree-w) minmax(0, 1fr) var(--chat-w);
  grid-template-rows: var(--topbar-h) minmax(0, 1fr);
  background: var(--bg);
  color: var(--fg);
  font: 400 var(--text-sm)/1.45 var(--font-sans);
  overflow: hidden;
}
.shell button, .shell input, .shell select, .shell textarea { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; }
.shell button { cursor: pointer; transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), transform var(--motion-base) var(--ease); }
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
.shell ::-webkit-scrollbar-thumb { background: var(--hairline-strong); border-radius: var(--radius-sm); }
.shell ::-webkit-scrollbar-thumb:hover { background: var(--meta); }
/* Host-chrome exception (deliberate leak): the DSH settings dialog styles its
   <select> with background: transparent, and any author-set background makes
   Chromium render the native popup white — with white-on-white options — even
   under color-scheme: dark. The author color is softer but still wrong: it
   leaks into the popup's option text, leaving the highlighted row washed out
   (gray on light blue). Reverting both restores the UA dark palette with
   proper highlight contrast, while keeping the host's border/radius/arrow on
   the closed control. Only needed in ink; paper's light popup matches already. */
:root[data-theme="ink"] select { background-color: revert !important; color: revert !important; }
`

export const componentStyles = `
/* ── Top bar ─────────────────────────────────────────────── */
/* 无框窗口:顶栏即标题栏,整体可拖拽,交互控件排除。 */
.shell > .chrome {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: var(--tree-w) minmax(0, 1fr) auto;
  align-items: center;
  height: var(--topbar-h);
  border-bottom: 1px solid var(--hairline);
  background: var(--bg);
  color: var(--fg-2);
  min-width: 0;
  -webkit-app-region: drag;
}
.shell > .chrome button, .shell > .chrome summary, .shell > .chrome input, .shell > .chrome a, .shell > .chrome .select, .shell > .chrome .workspace-menu-panel { -webkit-app-region: no-drag; }
.shell .window-controls { display: inline-flex; align-items: center; gap: 0; -webkit-app-region: no-drag; }
.shell .window-controls button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: var(--topbar-h); border: 0; border-radius: 0; background: transparent; color: var(--fg-2); cursor: pointer; font: 400 13px/1 var(--font-sans); }
.shell .window-controls button:hover { background: var(--surface-warm); color: var(--fg); }
.shell .window-controls button.window-close:hover { background: var(--danger); color: #fff; }
.shell > .chrome > * { min-width: 0; padding: 0 var(--space-4); }
.shell > .chrome > .topbar-actions { flex: none; }
.shell > .chrome > .workspace-chrome { border-left: 1px solid var(--hairline); border-right: 1px solid var(--hairline); padding: 0 var(--space-5); }
.shell > .chrome > .topbar-actions { justify-content: flex-end; gap: var(--space-4); }
.shell .brand-lockup { display: flex; align-items: center; gap: 8px; flex: none; font-size: var(--text-sm); letter-spacing: .08em; }
.shell .brand-mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-on); font-weight: 700; font-size: 12px; }
.shell .workspace-chrome { display: flex; align-items: center; gap: 2px; }
.shell .workspace-chrome .workspace-menu { position: relative; }
.shell .workspace-menu-divider { border: 0; border-top: 1px solid var(--hairline); margin: 4px 2px; }
.shell .workspace-chrome details > summary { display: flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 10px; border: 0; background: transparent; cursor: pointer; list-style: none; font-weight: 500; letter-spacing: .04em; color: var(--fg); border-radius: var(--radius-sm); white-space: nowrap; flex-shrink: 0; }
.shell .workspace-chrome details > summary::-webkit-details-marker { display: none; }
.shell .workspace-chrome details > summary > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-chrome details > summary::after { content: '⌄'; font-size: 11px; color: var(--meta); }
.shell .workspace-chrome details[open] > summary, .shell .workspace-chrome details > summary:hover { background: var(--surface); }
.shell .workspace-menu-panel { position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; width: 240px; max-height: min(360px, 70dvh); overflow: auto; padding: 6px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); }
.shell .workspace-menu-actions { display: grid; gap: 2px; }
.shell .workspace-menu-actions button { width: 100%; padding: 7px 9px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); }
.shell .workspace-menu-actions button:hover { background: var(--surface); color: var(--fg); }
.shell .workspace-menu-actions button[aria-current="true"] { color: var(--accent); font-weight: 600; }
.shell .file-context-menu { position: fixed; z-index: 30; min-width: 168px; padding: 6px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); }
.shell .file-context-menu button { width: 100%; padding: 7px 9px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); }
.shell .file-context-menu button:hover, .shell .file-context-menu button:focus-visible { background: var(--surface); color: var(--fg); }
.shell .path-fallback { display: grid; gap: 7px; margin: 7px 2px 2px; padding: 8px 2px 0; border-top: 1px solid var(--hairline); }
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
/* 侧栏整体下沉 1 度,与主区在纸/墨双主题下都形成温和的层级对比,
   同时把 1px 实色边框换为半透明 hairline,避免"上一代工具"的硬切感。 */
.shell > .sidebar { grid-row: 2; min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--hairline); background: var(--bg-sunken); }
.shell .side-title { display: flex; align-items: center; justify-content: space-between; padding: 14px 10px 8px; font-size: var(--text-xs); font-weight: 500; letter-spacing: .16em; color: var(--meta); }
.shell .side-title .icon-button { font-size: 14px; }
/* 今日字数小标:侧栏顶部单行,目标达成换强调色。变量 --confirm 与章节定稿同色。 */
.shell .writing-progress-chip { margin: 0 10px 6px; padding: 4px 10px; border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring); color: var(--meta); font: 500 var(--text-xs)/1.4 var(--font-sans); letter-spacing: .04em; font-variant-numeric: tabular-nums; }
.shell .writing-progress-chip.reached { color: var(--confirm); background: color-mix(in srgb, var(--confirm) 10%, var(--surface)); }
.shell .tree { flex: 1 1 auto; min-height: 72px; overflow: auto; padding: 4px 6px 20px; display: flex; flex-direction: column; }
.shell .tree-directory-row { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; padding: 2px 8px 2px 0; }
.shell .tree-static-row { font-size: var(--text-xs); font-weight: 500; letter-spacing: .16em; color: var(--meta); }
.shell .tree-marker { width: 12px; flex: none; color: var(--meta); text-align: center; font-size: 11px; }
.shell .tree-static-row .tree-marker { font-size: 14px; }
.shell .tree-directory-add { width: 18px; height: 18px; flex: none; display: grid; place-items: center; border: 0; border-radius: var(--radius-xs); background: transparent; cursor: pointer; opacity: .68; color: var(--meta); font-size: 14px; }
.shell .tree-directory-add:hover, .shell .tree-directory-add:focus-visible { opacity: 1; background: var(--surface); color: var(--fg); }
.shell .tree-row, .shell .tree-file-row { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; padding: 4px 8px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; color: var(--fg-2); font-size: var(--text-base); line-height: 1.35; letter-spacing: .04em; }
/* 章节状态徽标:行末单字胶囊,草/修/定三色。margin-left:auto 把它推到行末,
   文件名 span 仍按既有省略规则截断(用 :not(.chapter-status) 让规则跨两种结构都生效)。 */
.shell .tree-row .chapter-status { display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 6px; margin-left: auto; border-radius: 999px; box-shadow: var(--elev-ring); font-size: 10px; font-weight: 500; line-height: 1; letter-spacing: .04em; }
.shell .tree-row .chapter-status.draft { color: var(--muted); background: var(--surface-warm); }
.shell .tree-row .chapter-status.revising { color: var(--accent-on); background: var(--accent); }
.shell .tree-row .chapter-status.final { color: var(--surface); background: var(--confirm); }
.shell .tree-row > span:not(.chapter-status):last-child, .shell .tree-file-row > span:not(.chapter-status):last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .tree-row:hover, .shell .tree-file-row:hover { background: var(--surface); color: var(--fg); }
/* 选中态用 accent-soft(墨蓝淡底)替代原本的灰底,让"我现在在写哪一章"更醒目。 */
.shell .tree-row[aria-current="page"], .shell .tree-file-row[aria-current="page"] { background: var(--accent-soft); color: var(--fg); }
.shell .tree-row[aria-current="page"]::before, .shell .tree-file-row[aria-current="page"]::before { content: ''; width: 2px; align-self: stretch; margin: -2px 2px -2px -2px; background: var(--accent); border-radius: 2px; }
.shell .tree-row.danger, .shell .tree-file-row.danger { color: var(--danger); }

/* 图像预览 lightbox */
.shell .image-preview { position: fixed; z-index: 35; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--studio) 82%, transparent); cursor: zoom-out; }
.shell .image-preview img { max-width: 90vw; max-height: 90dvh; object-fit: contain; box-shadow: var(--elev-card); border-radius: var(--radius-sm); background: var(--surface); }
.shell .image-preview-close { position: fixed; top: 18px; right: 18px; width: 34px; height: 34px; font-size: 18px; color: var(--fg-2); background: var(--surface); border-radius: 50%; box-shadow: var(--elev-ring); }

/* 搭档面板关闭后的右下角浮动入口 */
.shell > .assistant-launcher { position: fixed; right: 24px; bottom: 24px; z-index: 12; display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--hairline-strong); border-radius: 999px; background: var(--surface); color: var(--fg); box-shadow: var(--elev-card); cursor: pointer; font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .06em; }
.shell > .assistant-launcher:hover { background: var(--surface-warm); box-shadow: var(--elev-card), var(--elev-ring-accent); }
.shell > .assistant-launcher .whale-mark { width: 18px; height: 18px; color: var(--accent); }

/* ── Columns / paper / chat ─────────────────────────────── */
.shell .panel-resizer { grid-row: 2; position: relative; z-index: 4; cursor: col-resize; background: var(--border); }
.shell .panel-resizer span { position: absolute; inset: 0; }
.shell .panel-resizer:hover, .shell .panel-resizer:focus-visible { background: var(--accent); }

/* ── Editor / paper ─────────────────────────────────────── */
/* 稿纸是视觉中心,保持 --surface 主色;底/顶栏 hairline 分隔。 */
.shell .editor { grid-row: 2; min-width: 0; min-height: 0; display: grid; grid-template-rows: var(--topbar-h) minmax(0, 1fr) auto; background: var(--surface); position: relative; z-index: 1; box-shadow: var(--elev-raised); }
.shell .editor-header { display: flex; align-items: center; gap: var(--space-4); min-width: 0; height: var(--topbar-h); padding: 0 28px 0 20px; border-bottom: 1px solid var(--hairline); background: var(--surface); color: var(--meta); font-size: var(--text-xs); letter-spacing: .1em; }
.shell .editor-header > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-family: var(--font-serif); font-size: var(--text-md); font-weight: 500; letter-spacing: .12em; }
.shell .editor-header > span:last-child { margin-left: auto; white-space: nowrap; }
.shell .editor-header > .editor-notice { margin-left: auto; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .chapter-navigation { display: flex; align-items: center; gap: 2px; }
.shell .chapter-navigation > span { font-size: 11px; color: var(--meta); padding: 0 4px; }
.shell .chapter-navigation button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; color: var(--meta); font-size: 16px; line-height: 1; }
.shell .chapter-navigation button:hover { background: var(--bg); color: var(--fg); }
.shell .chapter-status-control { display: flex; align-items: center; gap: 6px; }
.shell .chapter-status-control select { padding: 4px 8px; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: transparent; color: var(--muted); font-size: var(--text-xs); letter-spacing: .12em; transition: color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease); }
.shell .chapter-status-control select:hover, .shell .chapter-status-control select:focus-visible { color: var(--fg); border-color: var(--hairline-strong); }

.shell .paper-input {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  color: var(--fg);
}
/* The CodeMirror paper mounts inside .paper-input. Typography (serif stack,
   padding, caret color) lives in editor-core's CM theme; these rules only
   anchor layout and the design tokens the theme reads. */
.shell .paper-input .cm-editor { height: 100%; background: transparent; }
.shell .paper-input .cm-scroller { font-family: var(--font-serif); }
.shell .paper-input .cm-placeholder { color: var(--meta); font-style: italic; }
.shell .paper-scroll { max-width: 36em; margin: 0 auto; }

/* Mirrored ghost suggestion. Same type, lower contrast. */
.shell .ghost { color: var(--ghost); font: inherit; letter-spacing: inherit; line-height: inherit; }
.shell .ghost.is-loading { color: transparent; background-image: linear-gradient(90deg, var(--ghost) 0%, var(--fg-2) 46%, var(--ghost) 100%); background-size: 180% 100%; background-clip: text; -webkit-background-clip: text; animation: ghost-shimmer 1.35s var(--ease) infinite; }

@keyframes ghost-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -80% 0; } }

.shell .editor-tools { display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 28px 0 24px; border-top: 1px solid var(--hairline); background: var(--surface); color: var(--meta); flex-shrink: 0; }
.shell .editor-tools button, .shell .primary-action, .shell .composer-actions button:not(.send), .shell .proposal button, .shell .pending-card button, .shell .file-dialog button { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 5px 12px; border-radius: var(--radius-md); font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .08em; transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease); border: 0; cursor: pointer; }
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

/* Selection patch proposal card. */
.shell .proposal { position: relative; padding: 12px 14px 10px; margin: 14px 0 8px 2em; max-width: 32em; background: var(--bg); box-shadow: var(--elev-ring); border-radius: var(--radius-md); display: grid; gap: 8px; }
.shell .proposal > strong { font: 500 var(--text-sm)/1.4 var(--font-sans); letter-spacing: .08em; color: var(--fg); }
.shell .proposal p { margin: 0; white-space: pre-wrap; font: 400 16px/1.85 var(--font-serif); letter-spacing: .03em; color: var(--fg-2); }
.shell .proposal p:last-child { color: var(--fg); }
.shell .proposal-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
.shell .selection-diff { display: grid; gap: 6px; }
.shell .selection-diff section { display: grid; gap: 4px; }
.shell .selection-diff section small { font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .12em; color: var(--meta); }
.shell .proposal-conflict { padding: 6px 10px; border-top: 1px solid var(--hairline); font-size: var(--text-xs); color: var(--danger); background: var(--surface); }

/* ── Chat ───────────────────────────────────────────────── */
/* 聊天下沉:与侧栏同 --bg-sunken,让写作者的目光始终回到稿纸。 */
.shell > .chat { grid-row: 2; min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; border-left: 1px solid var(--hairline); background: var(--bg-sunken); }
.shell > .chat[hidden] { display: none !important; }
/* 头部参考 Kimi Code 侧栏:单行布局,左侧会话切换药丸,右侧动作图标;
   不放品牌标志,避免占用写作空间。模型指示挪到输入区工具栏。 */
.shell .chat-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 6px var(--space-4); border-bottom: 1px solid var(--hairline); background: var(--bg-sunken); }
.shell .whale-mark { width: 18px; height: 18px; color: var(--accent); }
.shell .chat-status { color: var(--meta); font-size: var(--text-xs); }
.shell .chat-header-actions { display: flex; align-items: center; gap: 2px; }
.shell .compact-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
.shell .compact-control button { padding: 0; border: 0; background: none; color: var(--meta); font-size: var(--text-xs); cursor: pointer; text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; }
.shell .compact-control button:hover { color: var(--fg); }
.shell .conversation-select { min-width: 0; }
.shell .conversation-select .select { display: block; }
.shell .conversation-select .select-trigger { min-width: 0; max-width: 240px; min-height: 26px; padding: 0 var(--space-2); border-color: var(--hairline); color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .model-indicator { display: block; overflow: hidden; color: var(--meta); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }

.shell .chat-history { display: flex; flex-direction: column; gap: var(--space-5); min-height: 0; overflow: auto; padding: var(--space-5) var(--space-4) var(--space-4); }
.shell .chat-row { margin: 0; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .chat-row > .msg-role, .shell .chat-row > p:first-child, .shell .chat-row > strong:first-child { display: block; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .14em; color: var(--meta); margin-bottom: 8px; }
.shell .chat-row p { margin: 0; white-space: pre-wrap; line-height: 1.7; }
.shell .chat-row.user { margin-left: 20px; }
.shell .chat-row.user p { color: var(--fg-2); font-size: var(--text-base); }
.shell .chat-row.assistant p { font: 400 var(--text-md)/1.85 var(--font-serif); letter-spacing: .03em; color: var(--fg); }
.shell .chat-row.assistant .md { padding-left: 12px; border-left: 2px solid var(--accent); font: 400 var(--text-md)/1.85 var(--font-serif); letter-spacing: .03em; color: var(--fg); }
.shell .md > :first-child { margin-top: 0; }
.shell .md > :last-child { margin-bottom: 0; }
.shell .md h1, .shell .md h2, .shell .md h3, .shell .md h4, .shell .md h5, .shell .md h6 { margin: 12px 0 6px; font-family: var(--font-serif); font-weight: 600; line-height: 1.5; }
.shell .md h1 { font-size: 1.18em; }
.shell .md h2 { font-size: 1.1em; }
.shell .md h3, .shell .md h4, .shell .md h5, .shell .md h6 { font-size: 1em; }
.shell .md p { margin: 0 0 8px; }
.shell .chat-row.assistant .md p { line-height: 1.85; }
.shell .md ul, .shell .md ol { margin: 0 0 8px; padding-left: 22px; }
.shell .md li { margin: 2px 0; }
.shell .md blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--hairline); color: var(--fg-2); }
.shell .md hr { margin: 10px 0; border: 0; border-top: 1px solid var(--hairline); }
.shell .md code { padding: 0 4px; border-radius: var(--radius-sm); background: var(--bg); font: 400 .92em/1.5 var(--font-mono); }
.shell .md pre { max-height: 320px; overflow: auto; margin: 0 0 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg); white-space: pre-wrap; }
.shell .md pre code { padding: 0; background: transparent; }
.shell .md a { color: var(--accent); }
.shell .chat-row.tool, .shell .chat-row.notice, .shell .chat-row.unknown { color: var(--muted); font-size: var(--text-xs); }
.shell .chat-row.thinking { color: var(--muted); font-size: var(--text-xs); border-style: dashed; }
.shell details.chat-row summary { cursor: pointer; font: 500 var(--text-xs)/1.6 var(--font-sans); letter-spacing: .08em; color: var(--meta); }
.shell details.chat-row p { margin: 8px 0 0; white-space: pre-wrap; line-height: 1.7; }
.shell details.chat-row pre { max-height: 200px; overflow: auto; margin: 8px 0 0; padding: 8px; background: var(--bg); white-space: pre-wrap; border-radius: var(--radius-sm); font-size: var(--text-xs); line-height: 1.55; }
.shell details.chat-row small { display: block; margin-top: 6px; color: var(--meta); }

.shell .composer { border-top: 1px solid var(--hairline); padding: 12px var(--space-4) 10px; background: var(--bg-sunken); display: grid; gap: var(--space-2); }
.shell .composer textarea { width: 100%; min-height: 64px; max-height: 120px; padding: 10px 12px; background: var(--surface); box-shadow: var(--elev-ring); border-radius: var(--radius-md); font-size: var(--text-base); line-height: 1.65; letter-spacing: .04em; color: var(--fg); resize: none; box-sizing: border-box; }
.shell .composer textarea::placeholder { color: var(--meta); }
.shell .composer-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.shell .composer-model { min-width: 0; }
/* 模型/思考强度选择器:输入区底部的紧凑药丸,弹层向上展开。 */
.shell .composer-model .model-picker { gap: 6px; }
.shell .composer-model .select-trigger { min-width: 0; max-width: 220px; min-height: 24px; padding: 0 var(--space-2); border-color: var(--hairline); background: transparent; color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .composer-model .select-trigger:hover:not(:disabled) { color: var(--fg); }
.shell .composer-model .select-list { top: auto; bottom: calc(100% + 4px); }
.shell .composer-actions { display: flex; align-items: center; gap: 6px; }
.shell .composer .send { flex: none; width: 32px; height: 32px; display: grid; place-items: center; color: var(--fg-2); border: 0; background: transparent; border-radius: var(--radius-md); cursor: pointer; }
.shell .composer .send:hover:not(:disabled) { background: var(--surface-warm); color: var(--fg); }
.shell .composer .send:disabled { opacity: .4; cursor: default; }
.shell .composer .send svg { display: block; }

.shell .pending-card { display: grid; gap: var(--space-3); padding: 10px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .init-guide-card { border-color: var(--accent); }
.shell .init-guide-card > div { display: flex; gap: 8px; }
.shell .pending-card fieldset { display: grid; gap: 5px; margin: 0; padding: 0; border: 0; }
.shell .pending-card input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg); }
.shell .proposal-card { display: grid; gap: var(--space-3); padding: 10px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .proposal-card header, .shell .proposal-card footer { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.shell .proposal-card pre { max-height: 180px; overflow: auto; padding: 8px; background: var(--bg); white-space: pre-wrap; border-radius: var(--radius-sm); margin: 0; font: 400 var(--text-sm)/1.55 var(--font-serif); color: var(--fg-2); }
/* 章节拆分/合并/批量改名:走同一张提案卡,只补少量结构;主外观继续走 .proposal-card 的 spacing。 */
.shell .proposal-card .proposal-split-summary, .shell .proposal-card .proposal-merge-summary, .shell .proposal-card .proposal-renames { display: grid; gap: 6px; }
.shell .proposal-card .proposal-renames ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.shell .proposal-card .proposal-renames code { font-size: var(--text-xs); }

/* ── Empty / home ───────────────────────────────────────── */
.shell .empty-paper { grid-row: 2; display: grid; place-items: center; min-width: 0; min-height: 0; padding: 32px; background: var(--surface); }
.shell .empty-paper.home-stage { background: var(--bg); }
/* ── Home (空白稿纸) 空状态 ────────────────────────────────
   整体走 Linear/Notion 风格的现代空态模板:
   1. home-card 去掉实色边框,改用半透明 hairline + 较大的圆角,
      给整张"空白稿纸"留出宽松的呼吸感。
   2. home-actions 改为 2 列网格,每格一张大入口卡(按钮角色),
      hover 浮起 + 边框着色,与 1.1 强调色呼应。 */
.shell .home-card { width: min(720px, 100%); padding: clamp(28px, 4vw, 44px); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); text-align: left; box-shadow: var(--elev-raised); display: grid; gap: 18px; }
.shell .home-card h1 { margin: 0; font: 500 clamp(32px, 4.4vw, 44px)/1.1 var(--font-serif); letter-spacing: -.04em; color: var(--fg); }
.shell .home-eyebrow { margin: 0; color: var(--muted); font-size: var(--text-xs); font-weight: 500; letter-spacing: .16em; text-transform: uppercase; }
.shell .home-hint { margin: 0; color: var(--muted); line-height: 1.7; font-size: var(--text-base); max-width: 42em; }
/* 入口卡:整张按钮 + 居上的图标块 + serif 标题 + muted 描述。 */
.shell .home-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 4px; }
.shell .home-entry-card { display: grid; grid-template-rows: auto 1fr auto; align-items: start; gap: 10px; padding: 18px 18px 16px; text-align: left; background: var(--bg-sunken); border: 1px solid var(--hairline); border-radius: var(--radius-lg); cursor: pointer; color: var(--fg); transition: background-color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), box-shadow var(--motion-base) var(--ease), transform var(--motion-base) var(--ease); }
.shell .home-entry-card:hover { background: var(--surface); border-color: var(--accent-soft); box-shadow: var(--elev-card); transform: translateY(-2px); }
.shell .home-entry-card:active { transform: translateY(-1px); }
.shell .home-entry-card .home-entry-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--accent-soft); color: var(--accent); transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease); }
.shell .home-entry-card:hover .home-entry-icon { background: var(--accent); color: var(--accent-on); }
.shell .home-entry-card .home-entry-icon svg { display: block; width: 20px; height: 20px; }
.shell .home-entry-card .home-entry-title { display: block; font: 500 var(--text-md)/1.2 var(--font-serif); letter-spacing: .02em; color: var(--fg); }
.shell .home-entry-card .home-entry-desc { display: block; font: 400 var(--text-sm)/1.55 var(--font-sans); letter-spacing: .02em; color: var(--muted); }
/* 最近作品区:卡片化,hover 浮起。 */
.shell .home-recent { display: grid; gap: 10px; margin-top: 8px; padding-top: 20px; border-top: 1px solid var(--hairline); }
.shell .home-recent > header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.shell .home-recent h2 { margin: 0; font: 500 var(--text-md)/1.2 var(--font-serif); letter-spacing: .02em; color: var(--fg); }
.shell .home-recent header small { color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .home-recent-empty { margin: 0; color: var(--meta); font-size: var(--text-sm); padding: 12px 14px; border: 1px dashed var(--hairline-strong); border-radius: var(--radius-md); }
.shell .workspace-list { display: grid; gap: 8px; }
.shell .workspace-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); transition: background-color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease), box-shadow var(--motion-base) var(--ease); }
.shell .workspace-row:hover { border-color: var(--accent-soft); transform: translateY(-1px); box-shadow: var(--elev-raised); }
.shell .workspace-row .tree-row { display: grid; gap: 3px; padding: 4px; text-align: left; }
.shell .workspace-row .tree-row strong { font: 500 var(--text-base)/1.35 var(--font-sans); letter-spacing: .02em; color: var(--fg); }
.shell .workspace-row .tree-row small { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-row .workspace-time { color: var(--meta); font-size: var(--text-xs); letter-spacing: .04em; white-space: nowrap; align-self: center; }
.shell .workspace-row .workspace-manage { align-self: start; }
.shell .workspace-relocation { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--hairline); color: var(--danger); font-size: var(--text-xs); }
.shell .workspace-intent-prompt { display: grid; gap: 8px; margin-top: var(--space-4); padding: 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .workspace-intent-prompt p, .shell .workspace-intent-prompt code { margin: 0; }
.shell .workspace-intent-prompt code { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-intent-prompt > div { display: flex; gap: 7px; flex-wrap: wrap; }
.shell .workspace-intent-prompt button { padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; color: var(--fg); }
.shell .workspace-checking { grid-column: 1 / -1; display: grid; place-content: center; gap: 8px; padding: 40px; text-align: center; }
.shell .workspace-checking h1, .shell .workspace-checking p { margin: 0; }
.shell .workspace-checking code { max-width: min(680px, 80vw); color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Dialogs ────────────────────────────────────────────── */
.shell .file-dialog-overlay { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 24px; background: color-mix(in srgb, var(--studio) 36%, transparent); }
.shell .file-dialog { width: min(520px, 100%); max-height: min(680px, calc(100dvh - 48px)); overflow: auto; padding: 18px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-card); }
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
.shell.layout-shell.focus-mode .paper-input { padding: 56px 64px; max-width: 880px; margin-inline: auto; }
.shell.layout-shell.focus-mode .editor-tools { justify-content: center; }

.shell.no-session { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.no-session > .chrome { grid-column: 1; }
/* no-session(首页)整体放在画布色上,留出大段顶部空间让卡片居中偏上。 */
.shell.no-session > .empty-paper { grid-column: 1; grid-row: 2; place-items: start center; overflow: auto; padding: clamp(40px, 8vw, 112px) 24px; background: var(--bg); }
.shell.no-session .home-card { padding: clamp(28px, 4.5vw, 48px) clamp(28px, 4.5vw, 52px); }
.shell.no-session .home-card h1 { font-size: clamp(34px, 4.4vw, 48px); }
.shell.no-session .home-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }

/* ── Command palette (Cmd/Ctrl+K) ──────────────────────────
   cmdk 内部对所有元素不附加样式,只用 data-attribute 表示 selected/disabled。
   Radix Dialog 的 Portal 会把 Overlay/Content 渲染到 document.body —— 因此
   面板相关的选择器不能带 .shell 前缀(否则匹配不到),只 trigger 按钮的样式
   留在 .shell 命名空间下(它挂在 chrome 上,仍是 .shell 后代)。 */
.palette-overlay { position: fixed; z-index: 40; inset: 0; background: color-mix(in srgb, var(--studio) 36%, transparent); animation: palette-overlay-in var(--motion-fast) var(--ease); }
.palette-content { position: fixed; z-index: 41; top: 20vh; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); max-height: min(540px, 64dvh); display: flex; flex-direction: column; padding: 0; border: 1px solid var(--hairline-strong); border-radius: var(--radius-lg); background: var(--bg); box-shadow: var(--elev-card); overflow: hidden; animation: palette-content-in var(--motion-base) var(--ease); }
@keyframes palette-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes palette-content-in { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translateX(-50%); } }

.palette-command { display: flex; flex-direction: column; min-height: 0; }
.palette-search { display: flex; align-items: center; gap: var(--space-3); padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
.palette-search-icon { display: grid; place-items: center; color: var(--meta); }
.palette-input { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; outline: 0; color: var(--fg); font: 500 18px/1.3 var(--font-sans); letter-spacing: .02em; }
.palette-input::placeholder { color: var(--meta); font-weight: 400; }
.palette-kbd { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 5px; font: 500 10px/1 var(--font-mono); letter-spacing: .04em; color: var(--meta); background: var(--surface); border-radius: var(--radius-xs); box-shadow: var(--elev-ring); }
.palette-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px; }
.palette-empty { padding: 24px 12px; text-align: center; color: var(--muted); font-size: var(--text-sm); letter-spacing: .04em; }
.palette-group { padding: 6px 0; }
.palette-group + .palette-group { border-top: 1px solid var(--hairline); margin-top: 4px; padding-top: 10px; }
.palette-group [cmdk-group-heading] { padding: 4px 12px 6px; font: 500 11px/1 var(--font-sans); letter-spacing: .14em; color: var(--meta); text-transform: uppercase; }
.palette-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 10px; border-radius: var(--radius-md); cursor: pointer; color: var(--fg-2); }
.palette-item[data-selected="true"] { background: var(--accent-soft); color: var(--fg); }
.palette-item[data-disabled="true"] { opacity: .5; cursor: not-allowed; }
.palette-item-icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--radius-sm); background: var(--surface); color: var(--accent); flex: none; }
.palette-item[data-selected="true"] .palette-item-icon { background: var(--accent); color: var(--accent-on); }
.palette-item-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.palette-item-label { font: 500 var(--text-base)/1.3 var(--font-sans); letter-spacing: .02em; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-item-hint { font-size: var(--text-xs); color: var(--muted); letter-spacing: .04em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-footer { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-top: 1px solid var(--hairline); color: var(--meta); font-size: var(--text-xs); letter-spacing: .04em; background: var(--bg-sunken); }
.palette-footer > span { display: inline-flex; align-items: center; gap: 5px; }

/* 顶栏触发按钮:放在 chrome 右上、设置按钮左侧,视觉权重比"设置"略轻
   (它是导航辅助,不是核心控制)。trigger 留在 .shell 命名空间下,因为
   它渲染在 chrome 内部,仍是 .shell 的后代。 */
.shell .palette-trigger { display: inline-flex; align-items: center; gap: 8px; min-height: 26px; padding: 0 8px 0 9px; border: 0; border-radius: var(--radius-sm); background: var(--surface); color: var(--fg-2); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; box-shadow: var(--elev-ring); transition: background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease); }
.shell .palette-trigger:hover { background: var(--surface-warm); color: var(--fg); }
.shell .palette-trigger-icon { display: grid; place-items: center; color: var(--meta); }
.shell .palette-trigger:hover .palette-trigger-icon { color: var(--fg); }
.shell .palette-trigger-label { white-space: nowrap; }
.shell .palette-trigger-kbd { display: inline-grid; place-items: center; min-width: 22px; height: 18px; padding: 0 4px; font: 500 10px/1 var(--font-mono); letter-spacing: .04em; color: var(--meta); background: var(--bg); border-radius: var(--radius-xs); box-shadow: var(--elev-ring); }
.shell .palette-trigger:hover .palette-trigger-kbd { color: var(--fg-2); }

/* 760px 折叠:trigger 的文字 label 隐藏,只保留放大镜 + kbd。 */
@media (max-width: 760px) {
  .shell .palette-trigger-label { display: none; }
  .palette-content { top: 12vh; max-height: 70dvh; }
}

/* ── Writing settings (宿主设置弹窗里的"写作"一节) ──────────────
   这段 DOM 由 shell 渲染进宿主设置弹窗,宿主样式不认识它,而 .shell 的
   input/textarea reset 会剥掉原生控件外观,所以这里自带完整样式。 */
.shell .writing-settings { display: grid; gap: var(--space-4); max-width: 560px; align-content: start; color: var(--fg-2); font-size: var(--text-sm); }
.shell .writing-settings h2 { margin: 0; font: 600 var(--text-md)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .writing-settings p { margin: 0; color: var(--meta); }
.shell .writing-settings fieldset { display: grid; gap: var(--space-2); margin: 0; padding: var(--space-3) var(--space-4) var(--space-4); border: 1px solid var(--border-soft); border-radius: var(--radius-md); }
.shell .writing-settings legend { padding: 0 var(--space-1); font-weight: 500; color: var(--fg-2); }
.shell .writing-settings fieldset label { display: flex; align-items: center; gap: var(--space-2); color: var(--fg-2); cursor: pointer; }
.shell .writing-settings fieldset input[type="radio"] { margin: 0; accent-color: var(--accent-active); }
.shell .writing-settings .author-preferences { display: grid; gap: var(--space-2); }
.shell .writing-settings .author-preferences > span { font-weight: 500; color: var(--fg-2); }
.shell .writing-settings .author-preferences textarea { width: 100%; box-sizing: border-box; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-sm)/1.7 var(--font-sans); resize: vertical; }
.shell .writing-settings .author-preferences textarea:focus-visible { box-shadow: var(--focus-ring); }
.shell .writing-settings .author-preferences small { color: var(--meta); }
/* 每日目标:与作者约定一致的输入风格;宽度收窄给数字用。 */
.shell .writing-settings .writing-progress-settings .goal-input { display: grid; gap: var(--space-2); }
.shell .writing-settings .writing-progress-settings .goal-input > span { font-weight: 500; color: var(--fg-2); }
.shell .writing-settings .writing-progress-settings .goal-input input { width: 9em; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-sm)/1.4 var(--font-sans); font-variant-numeric: tabular-nums; }
.shell .writing-settings .writing-progress-settings .goal-input input:focus-visible { box-shadow: var(--focus-ring); }
.shell .writing-settings .writing-progress-settings .goal-input small { color: var(--meta); }
.shell .writing-settings > button { justify-self: start; min-height: 30px; padding: 5px 12px; border: 0; border-radius: var(--radius-md); background: var(--accent); color: var(--accent-on); font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .08em; cursor: pointer; box-shadow: var(--elev-ring-accent); transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease); }
.shell .writing-settings > button:hover:not(:disabled) { background: var(--accent-active); }
.shell .writing-settings > button:disabled { opacity: .55; cursor: not-allowed; }
.shell .writing-settings p[role="alert"] { color: var(--danger); }

/* ── 设置弹窗(自建,纸/墨风格) ──────────────────────────────
   替代上游 DSH 设置弹窗;overlay 复用 .file-dialog-overlay 的遮罩。
   原生 <select> 一律不用(见 baseStyles 尾部的 Chromium 弹层说明),
   下拉用 .select 自制组件。 */
.shell .settings-trigger { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--fg-2); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; }
.shell .settings-trigger:hover { background: var(--surface-warm); color: var(--fg); }
.shell .settings-trigger-icon { display: grid; place-items: center; font-size: 13px; color: var(--meta); }
.shell .settings-trigger:hover .settings-trigger-icon { color: var(--fg); }
.shell .settings-dialog { width: min(760px, calc(100vw - 96px)); height: min(720px, calc(100dvh - 64px)); display: grid; grid-template-columns: 168px minmax(0, 1fr); padding: 0; overflow: hidden; }
.shell .settings-nav { display: flex; flex-direction: column; gap: 2px; padding: var(--space-4) var(--space-3); border-right: 1px solid var(--hairline); background: var(--bg-sunken); }
.shell .settings-nav h2 { margin: 0 0 var(--space-3); padding: 0 var(--space-2); font: 600 var(--text-md)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
/* 左侧导航是纯净列表:无框无底,hover 淡底,active 用 accent 淡底 + 强调色。
   width 100% 显式撑满(Chromium 的 button 默认收缩到内容宽度),并压过 .file-dialog button 的 inline-flex/justify-content。 */
.shell .settings-nav .settings-tab { display: flex; align-items: center; justify-content: flex-start; width: 100%; min-height: 32px; padding: 0 var(--space-3); border: 0; box-shadow: none; border-radius: var(--radius-sm); background: transparent; color: var(--fg-2); cursor: pointer; font: 500 var(--text-sm)/1.2 var(--font-sans); letter-spacing: .04em; text-align: left; }
.shell .settings-nav .settings-tab:hover { background: var(--surface-warm); color: var(--fg); }
.shell .settings-nav .settings-tab.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.shell .settings-body { display: grid; grid-template-rows: auto auto minmax(0, 1fr); min-width: 0; min-height: 0; }
.shell .settings-header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--hairline); }
.shell .settings-header-title { font: 600 var(--text-md)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .settings-open-config { margin-left: auto; min-height: 26px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-sm); background: var(--surface); color: var(--fg-2); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; box-shadow: var(--elev-ring); }
.shell .settings-open-config:hover { background: var(--surface-warm); color: var(--fg); }
.shell .settings-header .settings-close { margin-left: auto; }
.shell .settings-header .settings-open-config + .settings-close { margin-left: 0; }
.shell .settings-content { min-height: 0; overflow: auto; padding: var(--space-4) var(--space-5); }

/* 通用设置行 */
.shell .settings-general { display: grid; gap: var(--space-4); max-width: 560px; align-content: start; }
.shell .settings-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) 0; border-bottom: 1px solid var(--hairline); }
.shell .settings-row-text { display: grid; gap: 2px; min-width: 0; }
.shell .settings-row-title { font: 500 var(--text-sm)/1.5 var(--font-sans); color: var(--fg); }
.shell .settings-row-description { color: var(--meta); font-size: var(--text-xs); }
.shell .settings-segmented { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--radius-md); background: var(--bg-sunken); box-shadow: var(--elev-ring); }
.shell .settings-segmented button { min-height: 24px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--fg-2); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); }
.shell .settings-segmented button:hover { color: var(--fg); }
.shell .settings-segmented button.active { background: var(--surface); color: var(--fg); box-shadow: var(--elev-ring); }

/* 自制下拉 */
.shell .select { position: relative; display: inline-block; min-width: 0; }
.shell .select-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 160px; min-height: 28px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 400 var(--text-sm)/1.4 var(--font-sans); }
.shell .select-trigger:hover:not(:disabled) { border-color: var(--hairline-strong); }
.shell .select-trigger:disabled { opacity: .55; cursor: not-allowed; }
.shell .select-trigger:focus-visible { box-shadow: var(--focus-ring); }
.shell .select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .select-value.placeholder { color: var(--meta); }
.shell .select-caret { color: var(--meta); font-size: 11px; }
.shell .select-list { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; min-width: 100%; max-height: min(320px, 50dvh); overflow: auto; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-card); }
.shell .select-option { padding: 6px var(--space-3); border-radius: var(--radius-sm); color: var(--fg-2); font-size: var(--text-sm); cursor: pointer; white-space: nowrap; }
.shell .select-option.active { background: var(--accent-soft); color: var(--accent); }
.shell .select-option[aria-selected="true"] { font-weight: 600; }

/* 模型设置 */
.shell .models-page { max-width: 720px; display: flex; flex-direction: column; gap: var(--space-3); }
.shell .models-header { display: grid; gap: 4px; }
.shell .models-title { margin: 0; font: 600 var(--text-md)/1.3 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .models-intro { margin: 0; color: var(--meta); font-size: var(--text-xs); }
.shell .models-notice, .shell .models-status, .shell .models-warning, .shell .models-hint { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .models-warning { color: var(--danger); }
.shell .models-saved { margin: 0; font-size: var(--text-xs); color: var(--confirm); }
.shell .models-status { color: var(--muted); }
.shell .models-error { display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); font-size: var(--text-xs); }
.shell .models-rows { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.shell .models-row-card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .models-row-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.shell .models-row-identity { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.shell .models-row-name { font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); }
.shell .models-row-tag { padding: 2px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.shell .models-row-actions { display: inline-flex; align-items: center; gap: var(--space-2); }
.shell .models-row-state { width: 14px; height: 14px; flex: none; }
.shell .models-credential-dot { width: 8px; height: 8px; flex: none; border-radius: 999px; }
.shell .models-credential-dot-configured { background: var(--confirm); }
.shell .models-credential-dot-missing { background: var(--danger); }
.shell .models-button { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease); }
.shell .models-button:hover:not(:disabled) { background: var(--surface-warm); color: var(--fg); border-color: var(--hairline-strong); }
.shell .models-button:disabled { opacity: .55; cursor: not-allowed; }
.shell .models-button:focus-visible { box-shadow: var(--focus-ring); }
.shell .models-button-primary { background: var(--accent); color: var(--accent-on); border-color: transparent; }
.shell .models-button-primary:hover:not(:disabled) { background: var(--accent-active); color: var(--accent-on); }
.shell .models-button-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.shell .models-button-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 8%, var(--surface)); }
.shell .models-button-icon { min-width: 28px; padding: 0 8px; }
.shell .models-button-add { align-self: flex-start; }
.shell .models-add-card { display: grid; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .models-add-picker { display: grid; gap: var(--space-2); }
.shell .models-add-actions { display: inline-flex; gap: var(--space-2); }
.shell .models-editor { display: grid; gap: var(--space-3); padding: var(--space-3); border-top: 1px solid var(--hairline); }
.shell .models-row-card > .models-editor { border-top: 1px solid var(--hairline); margin-top: var(--space-2); }
.shell .models-editor-header { display: flex; align-items: baseline; gap: var(--space-2); }
.shell .models-editor-title { font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); }
.shell .models-editor-route { font-size: var(--text-xs); color: var(--meta); font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.shell .models-editor-actions { display: inline-flex; gap: var(--space-2); justify-content: flex-end; }
.shell .models-field { display: grid; gap: 6px; min-width: 0; }
.shell .models-field-label { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); letter-spacing: .04em; }
.shell .models-field-row { grid-template-columns: 120px minmax(0, 1fr); align-items: center; gap: var(--space-3); }
.shell .models-input { width: 100%; min-height: 28px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-sm)/1.4 var(--font-sans); box-shadow: none; }
.shell .models-input:hover:not(:disabled) { border-color: var(--hairline-strong); }
.shell .models-input:focus-visible { border-color: var(--accent-active); box-shadow: var(--focus-ring); }
.shell .models-input:disabled { opacity: .6; cursor: not-allowed; }
.shell .models-input::placeholder { color: var(--meta); }
.shell .models-input-id { flex: 1 1 200px; }
.shell .models-input-name { flex: 1 1 200px; }
.shell .models-customized { border: 1px solid var(--hairline); border-radius: var(--radius-sm); }
.shell .models-customized > summary { cursor: pointer; padding: 8px var(--space-3); font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); list-style: none; }
.shell .models-customized > summary::-webkit-details-marker { display: none; }
.shell .models-customized[open] > summary { border-bottom: 1px solid var(--hairline); }
.shell .models-customized-body { display: grid; gap: var(--space-3); padding: var(--space-3); }
.shell .models-catalog { display: grid; gap: var(--space-2); }
.shell .models-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.shell .models-catalog-title { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); letter-spacing: .04em; }
.shell .models-catalog-entry { display: grid; gap: 6px; padding: var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--bg); }
.shell .models-catalog-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.shell .models-catalog-advanced { display: grid; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--hairline); }
.shell .models-empty { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .models-overlay { z-index: 50; }
.shell .models-candidate-dialog { width: min(560px, 100%); max-height: min(640px, calc(100dvh - 48px)); }
.shell .models-candidate-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; max-height: 360px; overflow: auto; }
/* 提级到 dialog 作用域:压过 .file-dialog label 的 grid 和 .file-dialog input 的文本框样式,
   否则勾选框和模型名会被竖向堆叠、勾选框被撑成文本框。 */
.shell .models-candidate-dialog .models-candidate-label { display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-2); border-radius: var(--radius-sm); cursor: pointer; }
.shell .models-candidate-dialog .models-candidate-label:hover { background: var(--surface); }
.shell .models-candidate-dialog .models-candidate-label input[type="checkbox"] { width: 14px; height: 14px; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); accent-color: var(--accent-active); cursor: pointer; }
.shell .models-candidate-id { font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); }
.shell .models-candidate-name { color: var(--meta); font-size: var(--text-xs); }
.shell .models-candidate-description { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .models-candidate-actions { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 8px; }

/* 知乎设置:单凭据编辑卡,沿用 .models-* 的输入/按钮节奏,只换前缀避免和 .models- 互踩。 */
.shell .zhihu-page { max-width: 560px; display: flex; flex-direction: column; gap: var(--space-4); }
.shell .zhihu-header { display: grid; gap: 4px; }
.shell .zhihu-title { margin: 0; font: 600 var(--text-md)/1.3 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .zhihu-intro { margin: 0; color: var(--meta); font-size: var(--text-sm); line-height: 1.7; }
.shell .zhihu-guide { display: grid; gap: var(--space-2); margin: 0; padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .zhihu-guide-title { margin: 0; font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); letter-spacing: .04em; }
.shell .zhihu-guide-steps { display: grid; gap: 6px; margin: 0; padding-left: 18px; font-size: var(--text-xs); line-height: 1.7; color: var(--meta); }
.shell .zhihu-link { color: var(--accent-active); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-size: inherit; }
.shell .zhihu-link:hover { color: var(--accent); }
.shell .zhihu-link:focus-visible { box-shadow: var(--focus-ring); outline: none; }
.shell .zhihu-status { margin: 0; font-size: var(--text-xs); color: var(--muted); }
.shell .zhihu-error { display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); font-size: var(--text-xs); }
.shell .zhihu-notice { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .zhihu-status-grid { display: flex; align-items: center; gap: var(--space-3); margin: 0; padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .zhihu-status-label { margin: 0; font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); letter-spacing: .04em; }
.shell .zhihu-status-value { display: inline-flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-sm); color: var(--fg); }
.shell .zhihu-dot { width: 8px; height: 8px; flex: none; border-radius: 999px; }
.shell .zhihu-dot-configured { background: var(--confirm); }
.shell .zhihu-dot-missing { background: var(--danger); }
.shell .zhihu-dot-locked { background: var(--meta); }
.shell .zhihu-field { display: grid; gap: 6px; }
.shell .zhihu-field-label { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); letter-spacing: .04em; }
.shell .zhihu-input { width: 100%; min-height: 32px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-sm)/1.4 var(--font-sans); }
.shell .zhihu-input:hover:not(:disabled) { border-color: var(--hairline-strong); }
.shell .zhihu-input:focus-visible { border-color: var(--accent-active); box-shadow: var(--focus-ring); }
.shell .zhihu-input:disabled { opacity: .6; cursor: not-allowed; }
.shell .zhihu-input::placeholder { color: var(--meta); }
.shell .zhihu-hint { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .zhihu-warning { margin: 0; font-size: var(--text-xs); color: var(--danger); }
.shell .zhihu-saved { margin: 0; font-size: var(--text-xs); color: var(--confirm); }
.shell .zhihu-actions { display: inline-flex; justify-content: flex-end; gap: var(--space-2); }
.shell .zhihu-button { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease); }
.shell .zhihu-button:hover:not(:disabled) { background: var(--surface-warm); color: var(--fg); border-color: var(--hairline-strong); }
.shell .zhihu-button:disabled { opacity: .55; cursor: not-allowed; }
.shell .zhihu-button:focus-visible { box-shadow: var(--focus-ring); }
.shell .zhihu-button-primary { background: var(--accent); color: var(--accent-on); border-color: transparent; }
.shell .zhihu-button-primary:hover:not(:disabled) { background: var(--accent-active); color: var(--accent-on); }
.shell .zhihu-button-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.shell .zhihu-button-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 8%, var(--surface)); }

/* 知乎用量:近 30 天 SVG 柱状图(成功/失败堆叠)。 */
.shell .zhihu-usage { display: grid; gap: var(--space-3); margin-top: var(--space-2); padding-top: var(--space-4); border-top: 1px solid var(--hairline); }
.shell .zhihu-usage-title { margin: 0; font: 500 var(--text-sm)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg-2); }
.shell .zhihu-usage-intro { margin: 0; color: var(--meta); font-size: var(--text-xs); line-height: 1.7; }
.shell .zhihu-chart { display: block; width: 100%; height: 120px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .zhihu-chart-bar-ok { fill: var(--confirm); }
.shell .zhihu-chart-bar-fail { fill: var(--danger); }
.shell .zhihu-chart-tick { fill: var(--meta); font: 400 9px/1 var(--font-sans); }

/* 知乎知识库:列库 + 手动上传。 */
.shell .zhihu-kb { display: grid; gap: var(--space-3); margin-top: var(--space-2); padding-top: var(--space-4); border-top: 1px solid var(--hairline); }
.shell .zhihu-kb-base-row { display: flex; gap: var(--space-2); align-items: center; }
.shell .zhihu-kb-base-row .zhihu-input { flex: 1; }
.shell .zhihu-kb-file { font-size: var(--text-xs); color: var(--meta); }
.shell .zhihu-kb-file::file-selector-button { margin-right: var(--space-2); padding: 4px var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 500 var(--text-xs)/1 var(--font-sans); cursor: pointer; }
.shell .zhihu-kb-file::file-selector-button:hover { background: var(--surface-warm); }

/* 用量设置:今日 4 卡 + 近 7 日表 + 底部说明。 */
.shell .usage-page { max-width: 720px; display: flex; flex-direction: column; gap: var(--space-5); }
.shell .usage-header { display: grid; gap: 4px; }
.shell .usage-title { margin: 0; font: 600 var(--text-md)/1.3 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .usage-intro { margin: 0; color: var(--meta); font-size: var(--text-sm); line-height: 1.7; }
.shell .usage-status { margin: 0; font-size: var(--text-xs); color: var(--muted); }
.shell .usage-error { display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); font-size: var(--text-xs); }
.shell .usage-section-title { margin: 0 0 var(--space-3); font: 500 var(--text-sm)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg-2); }
.shell .usage-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.shell .usage-card { display: grid; gap: 6px; padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .usage-card-label { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--meta); letter-spacing: .04em; }
.shell .usage-card-value { font: 600 var(--text-md)/1.2 var(--font-sans); color: var(--fg); font-variant-numeric: tabular-nums; }
.shell .usage-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); color: var(--fg-2); }
.shell .usage-table th, .shell .usage-table td { padding: 8px 10px; border-bottom: 1px solid var(--hairline); text-align: right; font-variant-numeric: tabular-nums; }
.shell .usage-table thead th { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--meta); letter-spacing: .04em; text-align: right; }
.shell .usage-table tbody th { text-align: left; font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); font-variant-numeric: tabular-nums; }
.shell .usage-table tbody tr:hover { background: var(--surface); }
.shell .usage-empty { margin: 0; padding: var(--space-4); text-align: center; color: var(--meta); font-size: var(--text-sm); border: 1px dashed var(--hairline-strong); border-radius: var(--radius-md); }
.shell .usage-footnote { margin: 0; color: var(--meta); font-size: var(--text-xs); }
.shell .usage-button { display: inline-flex; align-items: center; justify-content: center; min-height: 24px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; }
.shell .usage-button:hover { background: var(--surface-warm); border-color: var(--hairline-strong); }
@media (max-width: 560px) { .shell .usage-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

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
  .no-session .home-card { padding: 24px 18px; }
  .no-session .home-actions { grid-template-columns: minmax(0, 1fr); }
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
