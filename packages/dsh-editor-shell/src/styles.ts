/*
 * DSH Editor shell — three-layer visual system.
 * Canonical token table and constraints: docs/ui.md.
 *
 *   tokens    : paper/ink colour, type, space, radius, elev. Driven by
 *               :root[data-theme="paper"|"ink"]. Default is paper.
 *   base      : reset, typography, focus ring, scrollbar. Applies inside
 *               the .shell root so it never leaks onto DSH host chrome —
 *               with one deliberate exception: the ink-mode select
 *               background/color revert at the end of the block, a Chromium
 *               workaround for the host settings dialog's native popup.
 *   components: paper/ink mapping onto existing DOM class names. Workbench
 *               panels (search, export preview, import, archive, worldbook
 *               settings) keep their original class names and are styled here.
 *
 * Kept: prefers-reduced-motion, 1040px (chat collapse) and 760px
 * (sidebar collapse) responsive breakpoints, focus ring.
 *
 * Theme switch is :root[data-theme] only.
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
  --chrome-bg: #e6e5e0;
  --chrome-raised: #f2f1ec;
  --chrome-sunken: #dddbd4;
  --chrome-fg: #1c1c1b;
  --chrome-muted: #5c5b57;
  --elev-raised: 0 1px 2px rgba(20, 20, 19, 0.05), 0 8px 24px rgba(20, 20, 19, 0.07);
  --elev-card: 0 2px 6px rgba(20, 20, 19, 0.06), 0 14px 36px rgba(20, 20, 19, 0.1);
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
  --chrome-bg: #1c1b18;
  --chrome-raised: #25231f;
  --chrome-sunken: #171612;
  --chrome-fg: #e9e4d9;
  --chrome-muted: #aaa397;
  --elev-raised: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 28px rgba(8, 7, 6, 0.45);
  --elev-card: 0 2px 8px rgba(0, 0, 0, 0.42), 0 16px 40px rgba(0, 0, 0, 0.55);
  --studio: #0c0b0a;
  color-scheme: dark;
}
:root {
  --font-serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", Georgia, serif;
  --font-sans: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, Monaco, monospace;
  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-md: 15px;
  --text-body: 17px;
  --text-chrome: 13px;
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
  /* 轻微回弹:入场/弹层专用,幅度克制,不做循环装饰动画。 */
  --ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  --topbar-h: 52px;
  --control-h: 34px;
  --tree-w: 220px;
  --chat-w: 360px;
}
`

export const baseStyles = `
.shell, .shell *, .shell *::before, .shell *::after,
.dsh-ui, .dsh-ui *, .dsh-ui *::before, .dsh-ui *::after { box-sizing: border-box; }
.shell {
  width: 100%;
  height: 100dvh;
  display: grid;
  grid-template-columns: var(--tree-w) minmax(0, 1fr) var(--chat-w);
  grid-template-rows: var(--topbar-h) minmax(0, 1fr);
  background: var(--chrome-bg);
  color: var(--fg);
  font: 400 var(--text-chrome)/1.45 var(--font-sans);
  overflow: hidden;
}
.dsh-ui {
  color: var(--fg);
  font: 400 var(--text-chrome)/1.45 var(--font-sans);
}
.shell button, .shell input, .shell select, .shell textarea,
.dsh-ui button, .dsh-ui input, .dsh-ui select, .dsh-ui textarea { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; }
.shell button, .dsh-ui button { cursor: pointer; transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease), transform var(--motion-base) var(--ease); }
/* 按压反馈:整壳统一的 1px 下沉,配合上面的 transform 过渡形成"按下-回弹"。
   特例(如 .home-entry-card 的 -1px)由更高优先级选择器覆盖。 */
.shell button:active, .dsh-ui button:active { transform: translateY(1px); }
/* 入场关键帧:只用于一次性进场(home 卡、菜单、侧栏面板、对话框),稿纸/编辑器
   正文不参与,避免打字时重排动画。 */
@keyframes shell-fade-in { from { opacity: 0; } }
@keyframes shell-rise-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes shell-pop-in { from { opacity: 0; transform: translateY(-3px) scale(.97); } }
@keyframes shell-slide-in-right { from { opacity: 0; transform: translateX(12px); } }
@keyframes shell-dialog-in { from { opacity: 0; transform: translateY(10px) scale(.98); } }
.shell textarea, .dsh-ui textarea { resize: none; outline: none; }
.shell :focus, .dsh-ui :focus { outline: none; }
.shell :focus-visible, .dsh-ui :focus-visible { box-shadow: var(--focus-ring); }
.shell button:disabled, .dsh-ui button:disabled { cursor: not-allowed; opacity: .55; }
.shell .sr-only, .dsh-ui .sr-only, .dsh-ui-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.shell .muted, .shell .local-state, .dsh-ui .muted { color: var(--muted); }
.shell .warning, .dsh-ui .warning { color: var(--danger); }
.shell .success, .dsh-ui .success { color: var(--confirm); }
.shell .pad, .dsh-ui .pad { margin: 0; padding: 7px 10px; font-size: var(--text-sm); }
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
  grid-template-columns: var(--tree-w) minmax(0, 1fr) auto auto;
  align-items: center;
  height: var(--topbar-h);
  border-bottom: 1px solid var(--hairline);
  background: var(--chrome-bg);
  color: var(--chrome-fg);
  min-width: 0;
  -webkit-app-region: drag;
}
.shell > .chrome button, .shell > .chrome summary, .shell > .chrome input, .shell > .chrome a, .shell > .chrome .select, .shell > .chrome .workspace-menu-panel { -webkit-app-region: no-drag; }
.shell .window-controls, .dsh-ui .window-controls { display: inline-flex; align-items: center; gap: 0; -webkit-app-region: no-drag; }
.shell .window-controls button, .dsh-ui .window-controls button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: var(--topbar-h); border: 0; border-radius: 0; background: transparent; color: var(--fg-2); cursor: pointer; font: 400 13px/1 var(--font-sans); }
.shell .window-controls button:hover, .dsh-ui .window-controls button:hover { background: var(--surface-warm); color: var(--fg); }
.shell .window-controls button.window-close:hover, .dsh-ui .window-controls button.window-close:hover { background: var(--danger); color: #fff; }
.shell > .chrome > * { min-width: 0; padding: 0 var(--space-4); }
.shell > .chrome > .topbar-actions { flex: none; }
.shell > .chrome > .workspace-chrome { min-width: 0; overflow: hidden; border-left: 1px solid var(--hairline); border-right: 1px solid var(--hairline); padding: 0 var(--space-5); }
.shell > .chrome > .topbar-actions { justify-content: flex-end; gap: var(--space-4); }
.shell > .chrome > .layout-controls { width: fit-content; min-width: min-content; max-width: 100%; justify-self: start; }
/* Extension launcher rail: a host-reserved strip, not an overlay. Inside the
   top chrome it is a real grid child, so contributed launchers take layout
   space and can never cover the composer or other app controls at any width;
   on bare screens without chrome (e.g. workspace verification) it pins to the
   free top-right corner instead. The rail itself stays click-through and each
   contribution opts into pointer events. The --dsh-ext-* variables are the
   placement contract with contributions: they pull a dock inline and make its
   open panel drop below the launcher (open panels overlay intentionally). */
.shell-extensions-dock {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-self: end;
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
.shell > .chrome > .shell-extensions-dock { position: static; height: auto; padding: 0; }
.shell .brand-lockup, .dsh-ui .brand-lockup { display: flex; align-items: center; gap: 8px; flex: none; font-size: var(--text-sm); letter-spacing: .08em; }
.shell .brand-mark, .dsh-ui .brand-mark { display: grid; width: 22px; height: 22px; place-items: center; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-on); font-weight: 700; font-size: 12px; }
.shell .workspace-chrome, .dsh-ui .workspace-chrome { display: flex; align-items: center; gap: 2px; min-width: 0; max-width: 100%; }
.shell .workspace-chrome .workspace-menu, .dsh-ui .workspace-chrome .workspace-menu { position: relative; min-width: 0; flex: 1 1 auto; max-width: 100%; }
.shell .workspace-menu-divider, .dsh-ui .workspace-menu-divider { border: 0; border-top: 1px solid var(--hairline); margin: 4px 2px; }
.shell .workspace-menu-trigger, .dsh-ui .workspace-menu-trigger { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; width: 100%; min-height: var(--control-h); padding: 0 14px; border: 1px solid transparent; background: var(--chrome-raised); cursor: pointer; font-weight: 600; letter-spacing: .02em; color: var(--chrome-fg); border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--elev-ring); }
.shell .workspace-menu-trigger > span, .dsh-ui .workspace-menu-trigger > span { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-menu-trigger::after, .dsh-ui .workspace-menu-trigger::after { content: '⌄'; flex: none; font-size: 11px; color: var(--meta); }
.shell .workspace-menu-trigger:hover, .shell .workspace-menu-trigger[data-state="open"], .dsh-ui .workspace-menu-trigger:hover, .dsh-ui .workspace-menu-trigger[data-state="open"] { background: var(--surface); }
.dsh-ui.workspace-menu-panel { z-index: 30; min-width: 240px; max-height: min(360px, 70dvh); overflow: auto; padding: 6px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); }
.dsh-ui.workspace-menu-panel[data-state="open"] { animation: shell-pop-in var(--motion-base) var(--ease-spring); transform-origin: top left; }
.dsh-ui.workspace-menu-panel .workspace-menu-item, .dsh-ui.workspace-menu-panel [role="menuitem"] { width: 100%; padding: 7px 9px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); color: var(--fg-2); outline: none; }
.dsh-ui.workspace-menu-panel .workspace-menu-item:hover, .dsh-ui.workspace-menu-panel [role="menuitem"][data-highlighted] { background: var(--surface); color: var(--fg); }
.dsh-ui.workspace-menu-panel [role="menuitem"][aria-current="true"] { color: var(--accent); font-weight: 600; }
.shell .file-context-menu, .dsh-ui.file-context-menu { z-index: 30; min-width: 200px; padding: 6px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); display: flex; flex-direction: column; gap: 2px; }
.dsh-ui.file-context-menu[data-state="open"] { animation: shell-pop-in var(--motion-fast) var(--ease-spring); }
.shell .file-context-menu button, .dsh-ui.file-context-menu button, .dsh-ui.file-context-menu [role="menuitem"] { width: 100%; padding: 7px 9px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); color: var(--fg-2); outline: none; }
.shell .file-context-menu button:hover:not([disabled]), .shell .file-context-menu button:focus-visible:not([disabled]), .dsh-ui.file-context-menu button:hover:not([disabled]), .dsh-ui.file-context-menu button:focus-visible:not([disabled]), .dsh-ui.file-context-menu [role="menuitem"][data-highlighted] { background: var(--surface); color: var(--fg); }
.shell .file-context-menu button:disabled, .dsh-ui.file-context-menu button:disabled, .dsh-ui.file-context-menu [role="menuitem"][data-disabled] { opacity: .45; cursor: not-allowed; }
.shell .file-context-menu button[data-danger="true"], .dsh-ui.file-context-menu button[data-danger="true"], .dsh-ui.file-context-menu [role="menuitem"][data-danger="true"] { color: var(--danger); }
.shell .file-context-menu button[data-danger="true"]:hover:not([disabled]), .shell .file-context-menu button[data-danger="true"]:focus-visible:not([disabled]), .dsh-ui.file-context-menu button[data-danger="true"]:hover:not([disabled]), .dsh-ui.file-context-menu button[data-danger="true"]:focus-visible:not([disabled]), .dsh-ui.file-context-menu [role="menuitem"][data-danger="true"][data-highlighted] { background: color-mix(in srgb, var(--danger) 10%, var(--surface)); color: var(--danger); }
.shell .file-context-menu-separator, .dsh-ui.file-context-menu-separator, .dsh-ui .file-context-menu-separator { border: 0; border-top: 1px solid var(--hairline); margin: 4px 2px; }
.shell .path-fallback, .dsh-ui .path-fallback { display: grid; gap: 7px; margin: 7px 2px 2px; padding: 8px 2px 0; border-top: 1px solid var(--hairline); }
.shell .path-fallback label, .dsh-ui .path-fallback label { display: grid; gap: 4px; font-size: var(--text-sm); color: var(--muted); }
.shell .path-fallback input, .dsh-ui .path-fallback input { min-width: 0; padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); }
.shell .path-fallback > div, .dsh-ui .path-fallback > div { display: flex; gap: 6px; }
.shell .path-fallback button, .dsh-ui .path-fallback button { padding: 6px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: transparent; cursor: pointer; }
.shell .layout-controls, .dsh-ui .layout-controls { display: flex; align-items: center; gap: 2px; padding: 2px; width: fit-content; background: var(--chrome-sunken); border-radius: var(--radius-md); box-shadow: var(--elev-ring); }
.shell .layout-controls button, .dsh-ui .layout-controls button { display: flex; align-items: center; justify-content: center; min-width: 36px; height: 30px; padding: 0 12px; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--text-chrome); letter-spacing: .08em; color: var(--chrome-muted); }
.shell .layout-controls button:hover, .shell .layout-controls button[aria-pressed="true"], .dsh-ui .layout-controls button:hover, .dsh-ui .layout-controls button[aria-pressed="true"] { background: var(--surface); color: var(--fg); }
.shell .layout-controls button[aria-pressed="true"], .dsh-ui .layout-controls button[aria-pressed="true"] { color: var(--accent); font-weight: 600; }
.shell .topbar-actions, .dsh-ui .topbar-actions { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.shell .topbar-actions > span, .dsh-ui .topbar-actions > span { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .icon-button, .dsh-ui .icon-button, .dsh-ui .icon-button { display: grid; place-items: center; min-width: 32px; min-height: 32px; padding: 3px; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; color: var(--meta); }
.shell .icon-button:hover, .dsh-ui .icon-button:hover { background: var(--surface); color: var(--fg); }
.shell .native-settings-control, .dsh-ui .native-settings-control { display: flex; align-items: center; }
.shell .native-settings-control button, .dsh-ui .native-settings-control button { white-space: nowrap; min-height: var(--control-h); padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--chrome-raised); cursor: pointer; color: var(--fg); font-size: var(--text-chrome); }

/* ── Theme switch ────────────────────────────────────────── */
.shell .theme-toggle, .dsh-ui .theme-toggle {
  display: flex;
  align-items: stretch;
  height: var(--control-h);
  background: var(--chrome-raised);
  box-shadow: var(--elev-ring);
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
  font-family: var(--font-sans);
  font-size: var(--text-chrome);
  font-weight: 500;
  letter-spacing: .14em;
  color: var(--chrome-muted);
  padding: 0 12px;
  line-height: var(--control-h);
}
.shell .theme-toggle:hover, .dsh-ui .theme-toggle:hover { background: var(--surface-warm); color: var(--fg); transform: translateY(-1px); }
/* 浮起按钮的按压:回到 0 而不是全局的 +1px,保持"按下去"的方向感。 */
.shell .theme-toggle:active, .dsh-ui .theme-toggle:active { transform: translateY(0); }

/* ── Sidebar / tree ─────────────────────────────────────── */
/* 侧栏整体下沉 1 度,与主区在纸/墨双主题下都形成温和的层级对比,
   同时把 1px 实色边框换为半透明 hairline,避免"上一代工具"的硬切感。 */
.shell > .sidebar { grid-row: 2; min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--hairline); background: var(--chrome-sunken); overflow-x: hidden; overflow-y: auto; }
.shell .side-title, .dsh-ui .side-title { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; padding: 8px 12px; font-size: var(--text-chrome); font-weight: 600; letter-spacing: .08em; color: var(--chrome-fg); }
.shell .side-title > span:first-child, .dsh-ui .side-title > span:first-child { flex: none; white-space: nowrap; }
.shell .side-title .icon-button, .dsh-ui .side-title .icon-button { font-size: 14px; }
.shell .side-search, .dsh-ui .side-search { margin: 0 12px 8px; padding: 0 12px; width: auto; min-height: var(--control-h); border: 1px solid transparent; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--elev-ring); color: var(--fg); font: 400 var(--text-chrome)/1.4 var(--font-sans); appearance: none; -webkit-appearance: none; }
.shell .side-search::-webkit-search-cancel-button, .dsh-ui .side-search::-webkit-search-cancel-button { -webkit-appearance: none; }
.shell .side-search:focus-visible, .dsh-ui .side-search:focus-visible { border-color: var(--accent-active); box-shadow: var(--focus-ring); }
.shell .tree, .dsh-ui .tree { flex: 1 1 auto; min-height: 72px; overflow: auto; padding: 4px 6px 20px; display: flex; flex-direction: column; }
.shell .tree-directory-row, .dsh-ui .tree-directory-row { display: flex; align-items: center; gap: 4px; min-width: 0; width: 100%; padding: 2px 8px 2px 0; }
.shell .tree-marker, .dsh-ui .tree-marker { width: 12px; flex: none; color: var(--meta); text-align: center; font-size: 11px; }
.shell .tree-directory-add, .dsh-ui .tree-directory-add { width: 18px; height: 18px; flex: none; display: grid; place-items: center; border: 0; border-radius: var(--radius-xs); background: transparent; cursor: pointer; opacity: .68; color: var(--meta); font-size: 14px; }
.shell .tree-directory-add:hover, .shell .tree-directory-add:focus-visible, .dsh-ui .tree-directory-add:hover, .dsh-ui .tree-directory-add:focus-visible { opacity: 1; background: var(--surface); color: var(--fg); }
/* VSCode 式行内操作:每个目录悬停/聚焦时才露出「新建文件/文件夹」。 */
.shell .tree-row-actions, .dsh-ui .tree-row-actions { flex: none; display: inline-flex; align-items: center; gap: 2px; visibility: hidden; }
.shell .tree-directory-row:hover .tree-row-actions, .shell .tree-directory-row:focus-within .tree-row-actions, .dsh-ui .tree-directory-row:hover .tree-row-actions, .dsh-ui .tree-directory-row:focus-within .tree-row-actions { visibility: visible; }
/* 侧栏头部工具组:版本溢出菜单,避免三枚文字按钮挤成一行。 */
.shell .side-title-actions, .dsh-ui .side-title-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 2px; flex: none; }
.shell .side-action, .dsh-ui .side-action { border: 0; border-radius: var(--radius-xs); background: transparent; cursor: pointer; padding: 3px 6px; color: var(--meta); font: 500 var(--text-xs)/1.2 var(--font-sans); letter-spacing: .04em; }
.shell .side-action:hover, .shell .side-action[aria-pressed="true"], .dsh-ui .side-action:hover, .dsh-ui .side-action[aria-pressed="true"] { background: var(--surface); color: var(--fg); }
.shell .side-action:disabled, .dsh-ui .side-action:disabled { opacity: .5; cursor: default; }
.shell .side-version-trigger, .dsh-ui .side-version-trigger { display: grid; place-items: center; width: 28px; min-height: 28px; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--meta); cursor: pointer; font: 600 16px/1 var(--font-sans); }
.shell .side-version-trigger:hover, .shell .side-version-trigger[data-state="open"], .dsh-ui .side-version-trigger:hover, .dsh-ui .side-version-trigger[data-state="open"] { background: var(--surface); color: var(--fg); }
.shell .side-status, .dsh-ui .side-status { margin: 0 12px 8px; padding: 0; color: var(--meta); font-size: var(--text-xs); line-height: 1.4; }
/* 提交历史面板:侧栏内树上方的小列表。 */
.shell .snapshot-panel, .dsh-ui .snapshot-panel { margin: 0 12px 10px; padding: 8px; max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 2px; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--elev-ring); animation: shell-rise-in var(--motion-emphasis) var(--ease-spring); }
.shell .snapshot-row, .dsh-ui .snapshot-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--radius-xs); color: var(--fg-2); font-size: var(--text-xs); }
.shell .snapshot-row:hover, .dsh-ui .snapshot-row:hover { background: color-mix(in srgb, var(--fg) 4%, transparent); }
.shell .snapshot-label, .dsh-ui .snapshot-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .snapshot-meta, .dsh-ui .snapshot-meta { flex: none; color: var(--muted); }
.shell .snapshot-rollback, .dsh-ui .snapshot-rollback { flex: none; border: 0; border-radius: var(--radius-xs); background: transparent; cursor: pointer; padding: 2px 6px; color: var(--accent); font-size: var(--text-xs); }
.shell .snapshot-rollback:hover, .dsh-ui .snapshot-rollback:hover { background: var(--accent-soft); }
.shell .snapshot-rollback:disabled, .dsh-ui .snapshot-rollback:disabled { opacity: .5; cursor: default; }
.shell .snapshot-empty, .dsh-ui .snapshot-empty { padding: 6px 8px; color: var(--meta); font-size: var(--text-xs); }

/* 全文搜索、归档、导出预检、导入、世界书触发设置 */
.shell .search-panel, .dsh-ui .search-panel { margin: 0 12px 10px; padding: 10px; border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--elev-ring); display: flex; flex-direction: column; gap: 8px; }
.shell .search-panel form, .dsh-ui .search-panel form { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px; }
.shell .search-panel form.search-replace, .dsh-ui .search-panel form.search-replace { grid-template-columns: minmax(0, 1fr) auto; }
.shell .search-panel input, .shell .search-panel .select-trigger, .dsh-ui .search-panel input, .dsh-ui .search-panel .select-trigger { min-width: 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg); font: 400 var(--text-sm)/1.3 var(--font-sans); }
.shell .search-panel .select-trigger, .dsh-ui .search-panel .select-trigger { min-width: 7.5em; min-height: 0; }
.shell .search-panel button:not(.select-trigger), .dsh-ui .search-panel button:not(.select-trigger) { padding: 6px 8px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); cursor: pointer; }
.shell .search-panel button:not(.select-trigger):disabled, .dsh-ui .search-panel button:not(.select-trigger):disabled { opacity: .45; cursor: default; }
.shell .search-summary, .dsh-ui .search-summary { display: flex; flex-wrap: wrap; gap: 6px; color: var(--meta); font-size: var(--text-xs); }
.shell .search-results, .dsh-ui .search-results { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow: auto; }
.shell .search-file, .dsh-ui .search-file { display: grid; gap: 4px; }
.shell .search-file > strong, .dsh-ui .search-file > strong { font-size: var(--text-xs); color: var(--fg-2); }
.shell .search-file ul, .dsh-ui .search-file ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.shell .search-file button, .dsh-ui .search-file button { width: 100%; text-align: left; padding: 5px 7px; border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--fg-2); cursor: pointer; font-size: var(--text-xs); }
.shell .search-file button:hover:not([disabled]), .dsh-ui .search-file button:hover:not([disabled]) { background: var(--accent-soft); color: var(--fg); }
.shell .cards-badge, .dsh-ui .cards-badge { padding: 1px 6px; border-radius: 999px; background: var(--surface-warm); color: var(--fg-2); font-style: normal; }
.shell .archive-panel .archive-list, .dsh-ui .archive-panel .archive-list { display: grid; gap: 8px; }
.shell .archive-panel article, .dsh-ui .archive-panel article { display: grid; gap: 6px; padding: 8px; border-radius: var(--radius-sm); background: var(--surface); }
.shell .archive-panel article small, .shell .archive-panel article code, .dsh-ui .archive-panel article small, .dsh-ui .archive-panel article code { display: block; color: var(--meta); font-size: var(--text-xs); }
.shell .export-summary, .dsh-ui .export-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }
.shell .export-summary div, .dsh-ui .export-summary div { display: grid; gap: 2px; }
.shell .export-summary dt, .dsh-ui .export-summary dt { color: var(--meta); font-size: var(--text-xs); }
.shell .export-summary dd, .dsh-ui .export-summary dd { margin: 0; }
.shell .export-chapters, .dsh-ui .export-chapters { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; max-height: 280px; overflow: auto; }
.shell .export-chapters li, .dsh-ui .export-chapters li { display: flex; justify-content: space-between; gap: 8px; font-size: var(--text-sm); }
.shell .import-overlay, .dsh-ui .import-overlay { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 24px; background: color-mix(in srgb, var(--studio) 36%, transparent); animation: shell-fade-in var(--motion-fast) var(--ease); }
.shell .import-dialog, .dsh-ui .import-dialog { width: min(520px, 100%); max-height: min(680px, calc(100dvh - 48px)); overflow: auto; padding: 18px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-card); animation: shell-dialog-in var(--motion-emphasis) var(--ease-spring); }
.shell .import-dialog h2, .dsh-ui .import-dialog h2 { margin: 0 0 12px; font: 500 20px/1.2 var(--font-serif); }
.shell .import-dialog footer, .dsh-ui .import-dialog footer { display: flex; justify-content: flex-end; gap: 7px; flex-wrap: wrap; margin-top: 16px; }
.shell .rewrite-presets, .dsh-ui .rewrite-presets { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.shell .rewrite-presets button, .dsh-ui .rewrite-presets button { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 4px 10px; border: 0; border-radius: 999px; background: transparent; box-shadow: var(--elev-ring); color: var(--fg-2); font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .06em; cursor: pointer; }
.shell .rewrite-presets button:hover, .dsh-ui .rewrite-presets button:hover { background: var(--bg); color: var(--fg); }
.shell .rewrite-presets button:disabled, .dsh-ui .rewrite-presets button:disabled { opacity: .45; cursor: default; }
.shell .rewrite-presets-custom, .dsh-ui .rewrite-presets-custom { display: inline-flex; align-items: center; gap: 4px; }
.shell .rewrite-presets input, .dsh-ui .rewrite-presets input { min-width: 12em; max-width: 22em; min-height: 28px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-xs)/1.3 var(--font-sans); }
.shell .chapter-meta-settings, .dsh-ui .chapter-meta-settings { flex: 1 1 100%; padding: 8px 12px; border-top: 1px solid var(--hairline); background: var(--bg-sunken); }
.shell .chapter-meta-settings > summary, .dsh-ui .chapter-meta-settings > summary { cursor: pointer; font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); list-style: none; }
.shell .chapter-meta-settings > summary::-webkit-details-marker, .dsh-ui .chapter-meta-settings > summary::-webkit-details-marker { display: none; }
.shell .chapter-meta-body, .dsh-ui .chapter-meta-body { display: grid; gap: 8px; margin-top: 8px; }
.shell .chapter-meta-body > label, .dsh-ui .chapter-meta-body > label { display: grid; gap: 4px; font-size: var(--text-xs); color: var(--muted); }
.shell .chapter-meta-state, .dsh-ui .chapter-meta-state { display: grid; grid-template-columns: repeat(auto-fit, minmax(8em, 1fr)); gap: 8px; }
.shell .chapter-meta-state label, .dsh-ui .chapter-meta-state label { display: grid; gap: 4px; font-size: var(--text-xs); color: var(--muted); }
.shell .chapter-meta-settings textarea, .shell .chapter-meta-settings input[type="text"], .dsh-ui .chapter-meta-settings textarea, .dsh-ui .chapter-meta-settings input[type="text"] { padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); }
.shell .chapter-meta-count, .dsh-ui .chapter-meta-count { color: var(--meta); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.shell .chapter-meta-count.over, .dsh-ui .chapter-meta-count.over { color: var(--danger); }
.shell button.home-import-link.home-entry-card, .dsh-ui button.home-import-link.home-entry-card { margin-top: 0; color: var(--fg); text-decoration: none; font: inherit; }
.shell .tree-row, .shell .tree-file-row, .dsh-ui .tree-row, .dsh-ui .tree-file-row { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 32px; width: 100%; padding: 4px 8px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; color: var(--fg-2); font-size: var(--text-chrome); line-height: 1.35; letter-spacing: .02em; }
/* 章节状态徽标:行末单字胶囊,草/修/定三色。 */
.shell .tree-row .chapter-status, .dsh-ui .tree-row .chapter-status { display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 6px; margin-left: auto; border-radius: 999px; box-shadow: var(--elev-ring); font-size: 10px; font-weight: 500; line-height: 1; letter-spacing: .04em; }
.shell .tree-row .chapter-status.draft, .dsh-ui .tree-row .chapter-status.draft { color: var(--muted); background: var(--surface-warm); }
.shell .tree-row .chapter-status.revising, .dsh-ui .tree-row .chapter-status.revising { color: var(--accent-on); background: var(--accent); }
.shell .tree-row .chapter-status.final, .dsh-ui .tree-row .chapter-status.final { color: var(--surface); background: var(--confirm); }
.shell .tree-row > span:not(.chapter-status):last-child, .shell .tree-file-row > span:not(.chapter-status):last-child, .dsh-ui .tree-row > span:not(.chapter-status):last-child, .dsh-ui .tree-file-row > span:not(.chapter-status):last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .tree-row:hover, .shell .tree-file-row:hover, .dsh-ui .tree-row:hover, .dsh-ui .tree-file-row:hover { background: var(--surface); color: var(--fg); }
/* 选中态用 accent-soft(墨蓝淡底)替代原本的灰底,让"我现在在写哪一章"更醒目。 */
.shell .tree-row[aria-current="page"], .shell .tree-file-row[aria-current="page"], .dsh-ui .tree-row[aria-current="page"], .dsh-ui .tree-file-row[aria-current="page"] { background: var(--accent-soft); color: var(--fg); }
.shell .tree-row[aria-current="page"]::before, .shell .tree-file-row[aria-current="page"]::before, .dsh-ui .tree-row[aria-current="page"]::before, .dsh-ui .tree-file-row[aria-current="page"]::before { content: ''; width: 2px; align-self: stretch; margin: -2px 2px -2px -2px; background: var(--accent); border-radius: 2px; }
.shell .tree-row.danger, .shell .tree-file-row.danger, .dsh-ui .tree-row.danger, .dsh-ui .tree-file-row.danger { color: var(--danger); }

/* Image preview: host Dialog content is the image box, not a full-viewport click catcher. */
.dsh-ui.file-dialog.image-preview-dialog {
  width: max-content;
  max-width: min(90vw, 1184px);
  max-height: min(80dvh, 780px);
  padding: 0;
  overflow: visible;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.dsh-ui.image-preview-dialog img {
  display: block;
  max-width: min(90vw, 1184px);
  max-height: min(80dvh, 780px);
  object-fit: contain;
  box-shadow: var(--elev-card);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.dsh-ui.file-dialog.image-preview-dialog .image-preview-close {
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
  color: var(--fg-2);
  background: var(--surface);
  border-radius: 50%;
  box-shadow: var(--elev-ring);
}

/* 搭档面板关闭后的右下角浮动入口 */
.shell > .assistant-launcher { position: fixed; right: 24px; bottom: 24px; z-index: 12; display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--hairline-strong); border-radius: 999px; background: var(--surface); color: var(--fg); box-shadow: var(--elev-card); cursor: pointer; font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .06em; }
.shell > .assistant-launcher:hover { background: var(--surface-warm); box-shadow: var(--elev-card), var(--elev-ring-accent); transform: translateY(-2px); }
.shell > .assistant-launcher .whale-mark { width: 18px; height: 18px; color: var(--accent); }

/* ── Columns / paper / chat ─────────────────────────────── */
.shell .panel-resizer, .dsh-ui .panel-resizer { grid-row: 2; position: relative; z-index: 4; cursor: col-resize; background: var(--border); }
.shell .panel-resizer span, .dsh-ui .panel-resizer span { position: absolute; inset: 0; }
.shell .panel-resizer:hover, .shell .panel-resizer:focus-visible, .dsh-ui .panel-resizer:hover, .dsh-ui .panel-resizer:focus-visible { background: var(--accent); }

/* ── Editor / paper ─────────────────────────────────────── */
/* 稿纸是视觉中心,保持 --surface 主色;底/顶栏 hairline 分隔。 */
.shell .editor, .dsh-ui .editor { grid-row: 2; min-width: 0; min-height: 0; display: grid; grid-template-rows: var(--topbar-h) minmax(0, 1fr) auto; background: var(--surface); position: relative; z-index: 1; box-shadow: var(--elev-raised); }
.shell .editor-header, .dsh-ui .editor-header { display: flex; align-items: center; gap: var(--space-3); min-width: 0; height: var(--topbar-h); padding: 0 24px 0 20px; border-bottom: 1px solid var(--hairline); background: var(--surface); color: var(--meta); font-size: var(--text-chrome); letter-spacing: .06em; }
.shell .editor-header > span:first-child, .dsh-ui .editor-header > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-family: var(--font-serif); font-size: var(--text-md); font-weight: 500; letter-spacing: .12em; }
.shell .editor-header > span:last-child, .dsh-ui .editor-header > span:last-child { margin-left: auto; white-space: nowrap; }
.shell .editor-header > .editor-notice, .dsh-ui .editor-header > .editor-notice { margin-left: auto; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .paper-experience-toggles, .dsh-ui .paper-experience-toggles { display: inline-flex; align-items: center; gap: 4px; }
.shell .paper-experience-toggles button, .dsh-ui .paper-experience-toggles button { min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--meta); cursor: pointer; font-size: var(--text-chrome); letter-spacing: .04em; }
.shell .paper-experience-toggles button[aria-pressed="true"], .dsh-ui .paper-experience-toggles button[aria-pressed="true"] { background: var(--bg); color: var(--fg); }
.shell .editor-menu-trigger, .dsh-ui .editor-menu-trigger { min-width: 32px; min-height: 32px; padding: 0 8px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--meta); cursor: pointer; font-size: 16px; letter-spacing: .12em; }
.shell .editor-menu-trigger:hover, .shell .editor-menu-trigger[data-state="open"], .dsh-ui .editor-menu-trigger:hover, .dsh-ui .editor-menu-trigger[data-state="open"] { background: var(--bg); color: var(--fg); }
.dsh-ui.editor-action-menu { z-index: 40; min-width: 220px; max-height: min(calc(100dvh - 24px), var(--radix-dropdown-menu-content-available-height, 90dvh)); overflow: auto; padding: 6px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); }
.dsh-ui.editor-action-menu[data-state="open"] { animation: shell-pop-in var(--motion-fast) var(--ease-spring); }
.dsh-ui.editor-action-menu .editor-menu-item, .dsh-ui.editor-action-menu [role="menuitem"], .dsh-ui.editor-action-menu [role="menuitemcheckbox"] { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); color: var(--fg-2); outline: none; }
.dsh-ui.editor-action-menu [role="menuitem"][data-highlighted], .dsh-ui.editor-action-menu [role="menuitemcheckbox"][data-highlighted], .dsh-ui.editor-action-menu [role="menuitem"][data-state="open"] { background: var(--surface); color: var(--fg); }
.dsh-ui.editor-action-menu [data-disabled] { opacity: .45; cursor: not-allowed; }
.dsh-ui.editor-action-menu .editor-menu-label { padding: 6px 9px 2px; color: var(--meta); font-size: 11px; letter-spacing: .08em; }
.dsh-ui.editor-action-menu .editor-menu-item { position: relative; }
.dsh-ui.editor-action-menu [role="menuitemcheckbox"] { padding-left: 28px; }
.dsh-ui.editor-action-menu .editor-menu-check { position: absolute; left: 9px; }
.dsh-ui.editor-action-menu .editor-menu-sub-arrow { float: right; margin-left: 16px; }
.dsh-ui.editor-action-menu .editor-menu-separator { border: 0; border-top: 1px solid var(--hairline); margin: 4px 2px; }
.dsh-ui.editor-action-dialog { width: min(440px, 100%); }
.dsh-ui.editor-action-dialog .chapter-meta-body { display: grid; gap: 8px; }
.dsh-ui.editor-action-dialog .chapter-meta-state { display: grid; grid-template-columns: repeat(auto-fit, minmax(8em, 1fr)); gap: 8px; }
.shell .chapter-navigation, .dsh-ui .chapter-navigation { display: flex; align-items: center; gap: 2px; }
.shell .chapter-navigation > span, .dsh-ui .chapter-navigation > span { font-size: 11px; color: var(--meta); padding: 0 4px; }
.shell .chapter-navigation button, .dsh-ui .chapter-navigation button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer; color: var(--meta); font-size: 16px; line-height: 1; }
.shell .chapter-navigation button:hover, .dsh-ui .chapter-navigation button:hover { background: var(--bg); color: var(--fg); }

.shell .paper-input, .dsh-ui .paper-input {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  color: var(--fg);
}
/* The CodeMirror paper mounts inside .paper-input. Typography (serif stack,
   padding, caret color) lives in editor-core's CM theme; these rules only
   anchor layout and the design tokens the theme reads. */
.shell .paper-input .cm-editor, .dsh-ui .paper-input .cm-editor { height: 100%; background: transparent; }
.shell .paper-input .cm-scroller, .dsh-ui .paper-input .cm-scroller { font-family: var(--paper-font-family, var(--font-serif)); }
.shell .paper-input .cm-placeholder, .dsh-ui .paper-input .cm-placeholder { color: var(--meta); font-style: italic; }
.shell .paper-scroll, .dsh-ui .paper-scroll { max-width: 36em; margin: 0 auto; }

/* Mirrored ghost suggestion. Same type, lower contrast. */
.shell .ghost, .dsh-ui .ghost { color: var(--ghost); font: inherit; letter-spacing: inherit; line-height: inherit; }
.shell .ghost.is-loading, .dsh-ui .ghost.is-loading { color: transparent; background-image: linear-gradient(90deg, var(--ghost) 0%, var(--fg-2) 46%, var(--ghost) 100%); background-size: 180% 100%; background-clip: text; -webkit-background-clip: text; animation: ghost-shimmer 1.35s var(--ease) infinite; }

@keyframes ghost-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -80% 0; } }

.shell .editor-tools, .dsh-ui .editor-tools { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 24px; border-top: 1px solid var(--hairline); background: var(--surface); color: var(--meta); flex-shrink: 0; }
.shell .editor-tools button, .shell .primary-action, .shell .composer-actions button:not(.send), .shell .proposal-actions button, .shell .pending-card button, .shell .file-dialog button:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch):not(.dsh-plugins-primary):not(.dsh-plugins-ghost), .dsh-ui .editor-tools button, .dsh-ui .primary-action, .dsh-ui .composer-actions button:not(.send), .dsh-ui .proposal-actions button, .dsh-ui .pending-card button, .dsh-ui.file-dialog button:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch):not(.dsh-plugins-primary):not(.dsh-plugins-ghost) { display: inline-flex; align-items: center; justify-content: center; min-height: var(--control-h); padding: 5px 12px; border-radius: var(--radius-md); font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .08em; transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease); border: 0; cursor: pointer; }
.shell .editor-tools button, .shell .pending-card button, .shell .file-dialog button:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch):not(.dsh-plugins-primary):not(.dsh-plugins-ghost), .dsh-ui .editor-tools button, .dsh-ui .pending-card button, .dsh-ui.file-dialog button:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch):not(.dsh-plugins-primary):not(.dsh-plugins-ghost) { box-shadow: var(--elev-ring); background: transparent; color: var(--fg-2); }
.shell .editor-tools button:hover, .shell .pending-card button:hover, .shell .file-dialog button:hover:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch), .dsh-ui .editor-tools button:hover, .dsh-ui .pending-card button:hover, .dsh-ui.file-dialog button:hover:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch) { background: var(--surface); color: var(--fg); }
.shell .editor-tools button:active, .shell .pending-card button:active, .shell .file-dialog button:active:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch), .dsh-ui .editor-tools button:active, .dsh-ui .pending-card button:active, .dsh-ui.file-dialog button:active:not([role="switch"]):not([role="tab"]):not(.dsh-plugins-switch) { background: var(--surface-warm); }
.shell .primary-action, .dsh-ui .primary-action { background: var(--accent); color: var(--accent-on); box-shadow: var(--elev-ring-accent); }
.shell .primary-action:hover, .dsh-ui .primary-action:hover { box-shadow: var(--elev-ring-accent), var(--elev-raised); }
.shell .primary-action:active, .dsh-ui .primary-action:active { background: var(--accent-active); }
.shell .danger-action, .dsh-ui .danger-action { color: var(--danger) !important; box-shadow: 0 0 0 1px var(--danger) !important; }
.shell .danger-link, .dsh-ui .danger-link { color: var(--danger) !important; }
.shell .editor-tools .ghost-actions, .dsh-ui .editor-tools .ghost-actions { display: flex; gap: 4px; align-items: center; padding: 0 4px; }
.shell .editor-tools .ghost-actions > strong, .dsh-ui .editor-tools .ghost-actions > strong { font-weight: 500; letter-spacing: .04em; }
.shell .editor-tools .ghost-actions > small, .dsh-ui .editor-tools .ghost-actions > small { font-size: 11px; color: var(--meta); }
.shell .editor-tools .ghost-actions .kbd, .dsh-ui .editor-tools .ghost-actions .kbd { font-family: var(--font-mono); font-size: 10px; padding: 2px 5px; border-radius: var(--radius-xs); background: var(--bg); box-shadow: var(--elev-ring); color: var(--fg-2); margin-right: 4px; }
.shell .editor-tools .ghost-actions .fim-sep, .dsh-ui .editor-tools .ghost-actions .fim-sep { color: var(--border); padding: 0 4px; user-select: none; }
.shell .editor-notice, .dsh-ui .editor-notice { font-size: var(--text-xs); color: var(--muted); padding: 4px 8px; opacity: .85; }

/* Selection patch proposal card. */
.shell .proposal, .dsh-ui .proposal { position: relative; padding: 12px 14px 10px; margin: 14px 0 8px 0; max-width: 100%; background: var(--bg); box-shadow: var(--elev-ring); border-radius: var(--radius-md); display: grid; gap: 8px; }
.shell .proposal > strong, .dsh-ui .proposal > strong { font: 500 var(--text-sm)/1.4 var(--font-sans); letter-spacing: .08em; color: var(--fg); }
.shell .proposal p, .dsh-ui .proposal p { margin: 0; white-space: pre-wrap; font: 400 16px/1.85 var(--font-serif); letter-spacing: .03em; color: var(--fg-2); }
.shell .proposal p:last-child, .dsh-ui .proposal p:last-child { color: var(--fg); }
.shell .proposal-actions, .dsh-ui .proposal-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
.shell .proposal-actions .primary-action, .dsh-ui .proposal-actions .primary-action { background: var(--accent); color: var(--accent-on); box-shadow: var(--elev-ring-accent); }
.shell .proposal-actions .proposal-dismiss, .dsh-ui .proposal-actions .proposal-dismiss { background: transparent; color: var(--fg-2); box-shadow: var(--elev-ring); }
.shell .selection-diff, .dsh-ui .selection-diff { display: grid; gap: 6px; }
.shell .selection-diff section, .dsh-ui .selection-diff section { display: grid; gap: 4px; }
.shell .selection-diff section small, .dsh-ui .selection-diff section small { font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .12em; color: var(--meta); }
.shell .selection-diff-original p, .dsh-ui .selection-diff-original p { color: var(--fg-2); }
.shell .selection-diff-revised p, .dsh-ui .selection-diff-revised p { color: var(--fg); }
.shell .proposal-conflict, .dsh-ui .proposal-conflict { padding: 6px 10px; border-top: 1px solid var(--hairline); font-size: var(--text-xs); color: var(--danger); background: var(--surface); }

/* ── Chat ───────────────────────────────────────────────── */
/* 聊天下沉:与侧栏同 --bg-sunken,让写作者的目光始终回到稿纸。 */
.shell > .chat { grid-row: 2; position: relative; width: 100%; max-width: 100%; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; border-left: 1px solid var(--hairline); background: var(--chrome-sunken); animation: shell-slide-in-right var(--motion-base) var(--ease); }
.shell > .chat > * { min-width: 0; max-width: 100%; }
.shell > .chat[hidden] { display: none !important; }
/* 头部参考 Kimi Code 侧栏:单行布局,左侧会话切换药丸,右侧动作图标;
   不放品牌标志,避免占用写作空间。模型指示挪到输入区工具栏。 */
.shell .chat-header, .dsh-ui .chat-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 44px; padding: 6px var(--space-3); border-bottom: 1px solid var(--hairline); background: var(--chrome-sunken); width: 100%; min-width: 0; box-sizing: border-box; }
.shell .whale-mark, .dsh-ui .whale-mark { width: 18px; height: 18px; color: var(--accent); }
.shell .chat-status, .dsh-ui .chat-status { color: var(--meta); font-size: var(--text-xs); }
.shell .chat-header-actions, .dsh-ui .chat-header-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.shell .compact-control, .dsh-ui .compact-control { display: flex; align-items: center; gap: 8px; min-width: 0; }
.shell .compact-control button, .dsh-ui .compact-control button { padding: 0; border: 0; background: none; color: var(--meta); font-size: var(--text-xs); cursor: pointer; text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; }
.shell .compact-control button:hover, .dsh-ui .compact-control button:hover { color: var(--fg); }
.shell .conversation-select, .dsh-ui .conversation-select { min-width: 0; flex: 1; }
.shell .conversation-select .select, .dsh-ui .conversation-select .select { display: block; min-width: 0; max-width: 100%; }
.shell .conversation-select .select-trigger, .dsh-ui .conversation-select .select-trigger { min-width: 0; max-width: 100%; min-height: 26px; padding: 0 var(--space-2); border-color: var(--hairline); color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .conversation-menu, .dsh-ui .conversation-menu { position: relative; }
.dsh-ui.conversation-menu-pop { z-index: 30; min-width: 8em; padding: 4px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-card); }
.dsh-ui.conversation-menu-pop [role="menuitem"] { width: 100%; padding: 7px 9px; border: 0; border-radius: var(--radius-xs); background: transparent; text-align: left; cursor: pointer; font-size: var(--text-sm); color: var(--fg-2); outline: none; }
.dsh-ui.conversation-menu-pop [role="menuitem"][data-highlighted] { background: var(--bg); color: var(--fg); }
.dsh-ui.conversation-menu-pop [role="menuitem"][data-disabled] { opacity: .45; cursor: not-allowed; }
.dsh-ui.conversation-menu-pop [role="menuitem"].danger, .dsh-ui.conversation-menu-pop [role="menuitem"][data-danger="true"] { color: var(--danger); }
.shell .archived-conversations, .dsh-ui .archived-conversations { margin: 0; padding: 6px var(--space-4); border-bottom: 1px solid var(--hairline); color: var(--meta); font-size: var(--text-xs); background: var(--bg-sunken); }
.shell .archived-conversations summary, .dsh-ui .archived-conversations summary { cursor: pointer; letter-spacing: .04em; }
.shell .archived-conversations ul, .dsh-ui .archived-conversations ul { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.shell .archived-conversations li, .dsh-ui .archived-conversations li { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.shell .archived-conversations button, .dsh-ui .archived-conversations button { border: 0; background: none; color: var(--accent); cursor: pointer; font-size: var(--text-xs); }
/* 新对话设置:绝对定位铺满搭档栏,不参与 grid 行分配——若作为普通
   grid 项插入,会把对话历史顶出 minmax(0,1fr) 行,长消息溢出栏外。 */
.dsh-ui.conversation-setup-dialog { width: min(420px, 100%); }
.dsh-ui.conversation-setup-dialog .conversation-setup { position: static; inset: auto; display: grid; align-content: start; gap: var(--space-4); padding: 0; background: transparent; }
.dsh-ui.conversation-setup-dialog .select, .dsh-ui.conversation-setup-dialog .select-trigger { width: 100%; min-width: 0; }
.shell .conversation-setup, .dsh-ui .conversation-setup { display: grid; align-content: start; gap: var(--space-4); }
.shell .conversation-setup header, .dsh-ui .conversation-setup header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.shell .conversation-setup header strong, .dsh-ui .conversation-setup header strong { font: 500 var(--text-base)/1.3 var(--font-sans); }
.shell .conversation-setup select, .dsh-ui .conversation-setup select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); }
.shell .conversation-setup > button, .dsh-ui .conversation-setup > button { justify-self: start; }
.shell .conversation-setup footer, .dsh-ui .conversation-setup footer { display: flex; justify-content: flex-end; gap: 7px; }
.shell .model-indicator, .dsh-ui .model-indicator { display: block; overflow: hidden; color: var(--meta); font-size: var(--text-xs); text-overflow: ellipsis; white-space: nowrap; }

.shell .chat-history, .dsh-ui .chat-history { display: flex; flex-direction: column; gap: var(--space-3); width: 100%; min-width: 0; max-width: 100%; min-height: 0; overflow: auto; overflow-x: hidden; padding: var(--space-3); box-sizing: border-box; }
.shell .chat-row, .dsh-ui .chat-row { margin: 0; padding: 2px 0; border: 0; border-radius: 0; background: transparent; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.shell .chat-row > .msg-role, .shell .chat-row > p:first-child, .shell .chat-row > strong:first-child, .dsh-ui .chat-row > .msg-role, .dsh-ui .chat-row > p:first-child, .dsh-ui .chat-row > strong:first-child { display: block; font: 500 var(--text-xs)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--meta); margin-bottom: 4px; }
.shell .chat-row p, .dsh-ui .chat-row p { margin: 0; white-space: pre-wrap; line-height: 1.7; }
.shell .chat-row.user, .dsh-ui .chat-row.user { margin-left: 12px; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .chat-row.user p, .dsh-ui .chat-row.user p { color: var(--fg); font: 400 var(--text-base)/1.65 var(--font-sans); }
.shell .chat-row.assistant p, .dsh-ui .chat-row.assistant p { font: 400 var(--text-base)/1.75 var(--font-sans); color: var(--fg); }
.shell .chat-row.assistant .md, .dsh-ui .chat-row.assistant .md { padding-left: 0; border-left: 0; font: 400 var(--text-base)/1.75 var(--font-sans); color: var(--fg); }
.shell .md > :first-child, .dsh-ui .md > :first-child { margin-top: 0; }
.shell .md > :last-child, .dsh-ui .md > :last-child { margin-bottom: 0; }
.shell .md h1, .shell .md h2, .shell .md h3, .shell .md h4, .shell .md h5, .shell .md h6, .dsh-ui .md h1, .dsh-ui .md h2, .dsh-ui .md h3, .dsh-ui .md h4, .dsh-ui .md h5, .dsh-ui .md h6 { margin: 12px 0 6px; font-family: var(--font-serif); font-weight: 600; line-height: 1.5; }
.shell .md h1, .dsh-ui .md h1 { font-size: 1.18em; }
.shell .md h2, .dsh-ui .md h2 { font-size: 1.1em; }
.shell .md h3, .shell .md h4, .shell .md h5, .shell .md h6, .dsh-ui .md h3, .dsh-ui .md h4, .dsh-ui .md h5, .dsh-ui .md h6 { font-size: 1em; }
.shell .md p, .dsh-ui .md p { margin: 0 0 10px; }
.shell .chat-row.assistant .md p, .dsh-ui .chat-row.assistant .md p { margin: 0 0 10px; line-height: 1.75; }
.shell .md ul, .shell .md ol, .dsh-ui .md ul, .dsh-ui .md ol { margin: 0 0 8px; padding-left: 22px; }
.shell .md li, .dsh-ui .md li { margin: 2px 0; }
.shell .md blockquote, .dsh-ui .md blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 2px solid var(--hairline); color: var(--fg-2); }
.shell .md hr, .dsh-ui .md hr { margin: 10px 0; border: 0; border-top: 1px solid var(--hairline); }
.shell .md code, .dsh-ui .md code { padding: 0 4px; border-radius: var(--radius-sm); background: var(--bg); font: 400 .92em/1.5 var(--font-mono); }
.shell .md pre, .dsh-ui .md pre { max-height: 240px; overflow: auto; margin: 0 0 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg); white-space: pre-wrap; max-width: 100%; }
.shell .md pre code, .dsh-ui .md pre code { padding: 0; background: transparent; }
.shell .md a, .dsh-ui .md a { color: var(--accent); }
.shell .chat-row.tool, .shell .chat-row.notice, .shell .chat-row.unknown, .dsh-ui .chat-row.tool, .dsh-ui .chat-row.notice, .dsh-ui .chat-row.unknown { color: var(--muted); font-size: var(--text-xs); padding: 0; background: transparent; border: 0; }
.shell .chat-row.tool.error, .dsh-ui .chat-row.tool.error { border: 0; background: transparent; color: var(--danger); }
.shell .chat-row.tool.error summary, .dsh-ui .chat-row.tool.error summary { color: var(--danger); font-weight: 600; }
.shell .chat-row.tool.error pre, .dsh-ui .chat-row.tool.error pre { background: color-mix(in srgb, var(--danger) 6%, var(--bg)); color: var(--fg-2); }
.shell .chat-row.tool.error small, .dsh-ui .chat-row.tool.error small { color: var(--danger); }
.shell .chat-row.tool.error .tool-error-reason, .dsh-ui .chat-row.tool.error .tool-error-reason { margin: 6px 0 0; font-size: var(--text-sm); line-height: 1.6; color: var(--danger); }
.shell .chat-row.thinking, .dsh-ui .chat-row.thinking { color: var(--muted); font-size: var(--text-xs); border: 0; background: transparent; }
.shell details.chat-row summary { cursor: pointer; font: 500 var(--text-xs)/1.5 var(--font-sans); letter-spacing: .02em; color: var(--meta); padding: 2px 0; }
.shell details.chat-row p { margin: 4px 0 0; white-space: pre-wrap; line-height: 1.55; }
.shell details.chat-row pre { max-height: 160px; overflow: auto; margin: 4px 0 0; padding: 6px 8px; background: var(--bg); white-space: pre-wrap; border-radius: var(--radius-sm); font-size: var(--text-xs); line-height: 1.5; max-width: 100%; }
.shell details.chat-row small { display: block; margin-top: 4px; color: var(--meta); }

.shell .composer, .dsh-ui .composer { border-top: 1px solid var(--hairline); padding: 10px var(--space-3) 12px; background: var(--chrome-sunken); display: grid; gap: var(--space-2); width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; }
.shell .composer textarea, .dsh-ui .composer textarea { width: 100%; min-height: 64px; max-height: 132px; padding: 10px 12px; background: var(--surface); box-shadow: var(--elev-ring); border-radius: var(--radius-md); font-size: var(--text-sm); line-height: 1.6; letter-spacing: .02em; color: var(--fg); resize: none; box-sizing: border-box; }
.shell .composer textarea::placeholder, .dsh-ui .composer textarea::placeholder { color: var(--meta); }
.shell .composer-toolbar, .dsh-ui .composer-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; min-width: 0; }
.shell .composer-model, .dsh-ui .composer-model { flex: 1 1 160px; min-width: 0; }
/* 模型选择器占满底部;思考档位收进次级菜单,避免把模型名挤没。 */
.shell .composer-model .model-picker, .dsh-ui .composer-model .model-picker { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; min-width: 0; width: 100%; }
.shell .composer-model .model-picker > .select, .dsh-ui .composer-model .model-picker > .select { flex: 1 1 auto; min-width: 0; }
.shell .composer-model .model-picker .select-value, .dsh-ui .composer-model .model-picker .select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell > .chat .select, .dsh-ui .chat .select { display: block; width: 100%; max-width: 100%; min-width: 0; }
.shell > .chat .select-trigger, .dsh-ui .chat .select-trigger { min-width: 0; width: 100%; max-width: 100%; }
.shell .composer-model .select, .dsh-ui .composer-model .select { flex: 1 1 7rem; min-width: 0; }
.shell .composer-model .select-trigger, .dsh-ui .composer-model .select-trigger { min-width: 0; width: 100%; max-width: 100%; min-height: 24px; padding: 0 var(--space-2); border-color: var(--hairline); background: transparent; color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .composer-model .select-trigger:hover:not(:disabled), .dsh-ui .composer-model .select-trigger:hover:not(:disabled) { color: var(--fg); }
.shell .composer-actions, .dsh-ui .composer-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.shell .composer .send, .dsh-ui .composer .send { flex: none; width: 32px; height: 32px; display: grid; place-items: center; color: var(--fg-2); border: 0; background: transparent; border-radius: var(--radius-md); cursor: pointer; }
.shell .composer .send:hover:not(:disabled), .dsh-ui .composer .send:hover:not(:disabled) { background: var(--surface-warm); color: var(--fg); }
.shell .composer .send:disabled, .dsh-ui .composer .send:disabled { opacity: .4; cursor: default; }
.shell .composer .send svg, .dsh-ui .composer .send svg { display: block; }

.shell .pending-card, .dsh-ui .pending-card { display: grid; gap: var(--space-3); padding: 10px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.shell .init-guide-card, .dsh-ui .init-guide-card { border-color: var(--accent); }
.shell .init-guide-card > div, .dsh-ui .init-guide-card > div { display: flex; gap: 8px; }
.shell .init-guide-quiet, .dsh-ui .init-guide-quiet { margin: 0 0 var(--space-2); padding: 6px 8px; border: 1px dashed var(--hairline); border-radius: var(--radius-sm); background: transparent; color: var(--muted); font-size: var(--text-xs); }
.shell .init-guide-quiet summary, .dsh-ui .init-guide-quiet summary { cursor: pointer; color: var(--meta); letter-spacing: .02em; }
.shell .init-guide-quiet p, .dsh-ui .init-guide-quiet p { margin: 6px 0; line-height: 1.6; color: var(--fg-2); }
.shell .init-guide-quiet .init-guide-actions, .dsh-ui .init-guide-quiet .init-guide-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.shell .init-guide-quiet button, .dsh-ui .init-guide-quiet button { min-height: 26px; padding: 0 8px; font-size: var(--text-xs); letter-spacing: .04em; }
.shell .pending-card input, .dsh-ui .pending-card input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg); }
.shell .pending-card input::placeholder, .dsh-ui .pending-card input::placeholder { color: var(--meta); }
/* 提问卡片:编号页签切换问题,页签透出作答状态(当前高亮/已答对勾)。 */
.shell .pending-card .question-tabs, .dsh-ui .pending-card .question-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.shell .pending-card .question-tab, .dsh-ui .pending-card .question-tab { min-width: 28px; min-height: 26px; padding: 3px 9px; border-radius: var(--radius-sm); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .pending-card .question-tab.is-active, .dsh-ui .pending-card .question-tab.is-active { background: var(--surface-warm); color: var(--fg); box-shadow: var(--elev-ring); }
.shell .pending-card .question-tab.is-done, .dsh-ui .pending-card .question-tab.is-done { color: var(--accent); }
.shell .pending-card .question-panel, .dsh-ui .pending-card .question-panel { display: grid; gap: 6px; }
.shell .pending-card .question-panel > strong, .dsh-ui .pending-card .question-panel > strong { font: 500 var(--text-xs)/1.4 var(--font-sans); letter-spacing: .12em; color: var(--meta); }
.shell .pending-card .question-panel > p, .dsh-ui .pending-card .question-panel > p { margin: 0; white-space: pre-wrap; line-height: 1.7; color: var(--fg); }
.shell .pending-card .question-panel > small, .dsh-ui .pending-card .question-panel > small { color: var(--meta); line-height: 1.6; }
/* 预设选项:整行宽大按钮,label 为主、description 为辅,选中态用强调色描边。 */
.shell .pending-card .question-options, .dsh-ui .pending-card .question-options { display: grid; gap: 6px; }
.shell .pending-card .question-option, .dsh-ui .pending-card .question-option { display: grid; gap: 3px; justify-items: start; justify-content: start; width: 100%; min-height: 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--bg); text-align: left; letter-spacing: .03em; line-height: 1.5; }
.shell .pending-card .question-option:hover, .dsh-ui .pending-card .question-option:hover { background: var(--surface-warm); color: var(--fg); }
.shell .pending-card .question-option.is-selected, .dsh-ui .pending-card .question-option.is-selected { background: var(--surface-warm); color: var(--fg); box-shadow: 0 0 0 1px var(--accent); }
.shell .pending-card .question-option > small, .dsh-ui .pending-card .question-option > small { font-size: var(--text-xs); font-weight: 400; letter-spacing: .02em; color: var(--meta); }
.shell .pending-card .question-option.is-selected > small, .dsh-ui .pending-card .question-option.is-selected > small { color: var(--fg-2); }
.shell .proposal-card, .dsh-ui .proposal-card { display: grid; gap: var(--space-3); padding: 10px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .proposal-card header, .shell .proposal-card footer, .dsh-ui .proposal-card header, .dsh-ui .proposal-card footer { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.shell .proposal-card pre, .dsh-ui .proposal-card pre { max-height: 180px; overflow: auto; padding: 8px; background: var(--bg); white-space: pre-wrap; border-radius: var(--radius-sm); margin: 0; font: 400 var(--text-sm)/1.55 var(--font-serif); color: var(--fg-2); }
/* 章节拆分/合并/批量改名:走同一张提案卡,只补少量结构;主外观继续走 .proposal-card 的 spacing。 */
.shell .proposal-card .proposal-split-summary, .shell .proposal-card .proposal-merge-summary, .shell .proposal-card .proposal-renames, .dsh-ui .proposal-card .proposal-split-summary, .dsh-ui .proposal-card .proposal-merge-summary, .dsh-ui .proposal-card .proposal-renames { display: grid; gap: 6px; }
.shell .proposal-card .proposal-renames ul, .dsh-ui .proposal-card .proposal-renames ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.shell .proposal-card .proposal-renames code, .dsh-ui .proposal-card .proposal-renames code { font-size: var(--text-xs); }

/* ── Empty / home ───────────────────────────────────────── */
.shell .empty-paper, .dsh-ui .empty-paper { grid-row: 2; display: grid; place-items: center; min-width: 0; min-height: 0; padding: 32px; background: var(--surface); }
.shell .empty-paper.home-stage, .dsh-ui .empty-paper.home-stage { background: var(--bg); }
/* ── Home (空白稿纸) 空状态 ────────────────────────────────
   命令条三列入口卡(打开 / 新建 / 导入)由 Motion m.button 负责入场弹簧;
   最近作品列表才是主内容。不要再给这些卡叠 CSS transform 动画。 */
.shell .home-card, .dsh-ui .home-card { width: min(880px, 100%); padding: clamp(28px, 4vw, 44px); border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); text-align: left; box-shadow: var(--elev-raised); display: grid; gap: 22px; animation: shell-rise-in var(--motion-emphasis) var(--ease-spring) both; }
.shell .home-card h1, .dsh-ui .home-card h1 { margin: 0; font: 500 clamp(32px, 4.4vw, 44px)/1.1 var(--font-serif); letter-spacing: -.04em; color: var(--fg); }
.shell .home-eyebrow, .dsh-ui .home-eyebrow { margin: 0; color: var(--muted); font-size: var(--text-xs); font-weight: 500; letter-spacing: .16em; text-transform: uppercase; }
.shell .home-hint, .dsh-ui .home-hint { margin: 0; color: var(--muted); line-height: 1.7; font-size: var(--text-base); max-width: 46em; }
/* 命令条:打开 / 新建 / 导入三列入口,最近作品才是主列表。 */
.shell .home-actions, .dsh-ui .home-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 4px; }
.shell .home-command-bar, .dsh-ui .home-command-bar { align-items: stretch; }
.shell .home-entry-card, .dsh-ui .home-entry-card { display: grid; grid-template-rows: auto 1fr auto; align-items: start; gap: 8px; min-height: 112px; padding: 16px 16px 14px; text-align: left; background: var(--chrome-sunken); border: 1px solid var(--hairline); border-radius: var(--radius-lg); cursor: pointer; color: var(--fg); transition: background-color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), box-shadow var(--motion-base) var(--ease); }
.shell .home-entry-card:hover, .dsh-ui .home-entry-card:hover { background: var(--surface); border-color: var(--accent-soft); box-shadow: var(--elev-card); }
.shell .home-entry-card:active, .dsh-ui .home-entry-card:active { transform: none; }
.shell .home-entry-card .home-entry-icon, .dsh-ui .home-entry-card .home-entry-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--accent-soft); color: var(--accent); transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease); }
.shell .home-entry-card:hover .home-entry-icon, .dsh-ui .home-entry-card:hover .home-entry-icon { background: var(--accent); color: var(--accent-on); }
.shell .home-entry-card .home-entry-icon svg, .dsh-ui .home-entry-card .home-entry-icon svg { display: block; width: 20px; height: 20px; }
.shell .home-entry-card .home-entry-title, .dsh-ui .home-entry-card .home-entry-title { display: block; font: 500 var(--text-md)/1.2 var(--font-serif); letter-spacing: .02em; color: var(--fg); }
.shell .home-entry-card .home-entry-desc, .dsh-ui .home-entry-card .home-entry-desc { display: block; font: 400 var(--text-sm)/1.55 var(--font-sans); letter-spacing: .02em; color: var(--muted); }
/* 最近作品区:卡片化,hover 浮起。 */
.shell .home-recent, .dsh-ui .home-recent { display: grid; gap: 12px; margin-top: 4px; padding-top: 8px; }
.shell .home-recent > header, .dsh-ui .home-recent > header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.shell .home-recent h2, .dsh-ui .home-recent h2 { margin: 0; font: 500 18px/1.2 var(--font-serif); letter-spacing: .01em; color: var(--fg); }
.shell .home-recent header small, .dsh-ui .home-recent header small { color: var(--muted); font-size: var(--text-xs); letter-spacing: .04em; }
.shell .home-recent-empty, .dsh-ui .home-recent-empty { margin: 0; color: var(--meta); font-size: var(--text-sm); padding: 12px 14px; border: 1px dashed var(--hairline-strong); border-radius: var(--radius-md); }
.shell .workspace-list, .dsh-ui .workspace-list { display: grid; gap: 8px; }
.shell .workspace-row, .dsh-ui .workspace-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 14px 16px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); transition: background-color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease), box-shadow var(--motion-base) var(--ease); animation: shell-rise-in var(--motion-base) var(--ease-spring) both; }
.shell .workspace-row:hover, .dsh-ui .workspace-row:hover { border-color: var(--accent-soft); transform: translateY(-1px); box-shadow: var(--elev-raised); }
.shell .workspace-row .tree-row, .dsh-ui .workspace-row .tree-row { display: grid; gap: 3px; padding: 4px; text-align: left; }
.shell .workspace-row .tree-row strong, .dsh-ui .workspace-row .tree-row strong { font: 500 var(--text-base)/1.35 var(--font-sans); letter-spacing: .02em; color: var(--fg); }
.shell .workspace-row .tree-row small, .dsh-ui .workspace-row .tree-row small { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-row .workspace-time, .dsh-ui .workspace-row .workspace-time { color: var(--meta); font-size: var(--text-xs); letter-spacing: .04em; white-space: nowrap; align-self: center; }
.shell .workspace-row .workspace-manage, .dsh-ui .workspace-row .workspace-manage { align-self: start; }
.shell .workspace-relocation, .dsh-ui .workspace-relocation { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--hairline); color: var(--danger); font-size: var(--text-xs); }
.shell .workspace-intent-prompt, .dsh-ui .workspace-intent-prompt { display: grid; gap: 8px; margin-top: var(--space-4); padding: 14px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .workspace-intent-prompt p, .shell .workspace-intent-prompt code, .dsh-ui .workspace-intent-prompt p, .dsh-ui .workspace-intent-prompt code { margin: 0; }
.shell .workspace-intent-prompt code, .dsh-ui .workspace-intent-prompt code { color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .workspace-intent-prompt > div, .dsh-ui .workspace-intent-prompt > div { display: flex; gap: 7px; flex-wrap: wrap; }
.shell .workspace-intent-prompt button, .dsh-ui .workspace-intent-prompt button { padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); cursor: pointer; color: var(--fg); }
.shell .workspace-checking, .dsh-ui .workspace-checking { grid-column: 1 / -1; grid-row: 1 / -1; display: grid; place-content: center; gap: 8px; padding: 40px; text-align: center; }
.shell .workspace-checking h1, .shell .workspace-checking p, .dsh-ui .workspace-checking h1, .dsh-ui .workspace-checking p { margin: 0; }
.shell .workspace-checking code, .dsh-ui .workspace-checking code { max-width: min(680px, 80vw); color: var(--muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Dialogs ────────────────────────────────────────────── */
/* 自建对话框只给进场:它们关闭即卸载,不做伪装的退场动画。 */
.shell .file-dialog-overlay { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 24px; background: color-mix(in srgb, var(--studio) 36%, transparent); }
.dsh-ui.file-dialog-overlay { position: fixed; z-index: 20; inset: 0; background: color-mix(in srgb, var(--studio) 36%, transparent); }
.shell .file-dialog-overlay[data-state="open"], .dsh-ui.file-dialog-overlay[data-state="open"], .shell .file-dialog-overlay:not([data-state]) { animation: shell-fade-in var(--motion-fast) var(--ease); }
.shell .file-dialog, .dsh-ui.file-dialog { width: min(520px, 100%); max-height: min(680px, calc(100dvh - 48px)); overflow: auto; padding: 18px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-card); }
.dsh-ui.file-dialog { position: fixed; z-index: 21; left: 50%; top: 50%; translate: -50% -50%; }
.dsh-ui.confirm-dialog { z-index: 56; }
.shell .file-dialog[data-state="open"], .dsh-ui.file-dialog[data-state="open"], .shell .file-dialog:not([data-state]) { animation: shell-dialog-in var(--motion-emphasis) var(--ease-spring); }
.shell .file-dialog header, .dsh-ui.file-dialog header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: 14px; }
.shell .file-dialog h2, .dsh-ui.file-dialog h2 { margin: 0; font: 500 20px/1.2 var(--font-serif); letter-spacing: -.02em; }
.shell .file-dialog form, .shell .file-dialog label, .dsh-ui.file-dialog form, .dsh-ui.file-dialog label { display: grid; gap: 7px; }
.shell .file-dialog input:not([type="range"]), .shell .file-dialog select, .shell .file-dialog textarea, .dsh-ui.file-dialog input:not([type="range"]), .dsh-ui.file-dialog select, .dsh-ui.file-dialog textarea { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); }
.shell .file-dialog textarea, .dsh-ui.file-dialog textarea { min-height: 88px; resize: vertical; font: 400 var(--text-sm)/1.55 var(--font-serif); }
.shell .file-dialog.chapter-ops-dialog, .dsh-ui.file-dialog.chapter-ops-dialog { width: min(680px, 100%); }
.shell .chapter-ops-card, .dsh-ui .chapter-ops-card { min-width: 0; }
.shell .chapter-ops-dialog .proposal-card, .dsh-ui .chapter-ops-dialog .proposal-card { font-size: var(--text-xs); }
.shell .file-dialog footer, .dsh-ui.file-dialog footer { display: flex; justify-content: flex-end; gap: 7px; flex-wrap: wrap; margin-top: 16px; }
.shell .file-dialog-actions, .dsh-ui .file-dialog-actions { display: grid; gap: 6px; }
.shell .file-dialog-actions button, .dsh-ui .file-dialog-actions button { text-align: left; }

/* ── Focus mode / layout toggles ────────────────────────── */
.shell.layout-shell { grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.layout-shell > .sidebar, .shell.layout-shell > .editor, .shell.layout-shell > .empty-paper, .shell.layout-shell > .chat, .shell.layout-shell > .panel-resizer, .shell.layout-shell.pinned-open > .pinned-pane, .shell.layout-shell > .pinned-pane { grid-row: 2; }
/* 中栏 overlay 座位：座位容器和渲染器包裹层都不占格；插件标记 data-dsh-center-overlay 的根元素
   直接成为网格项，落在稿纸所在的列。稿纸根元素带内联 display，因此隐藏必须 !important。 */
.shell.layout-shell > .center-overlays, .shell.layout-shell > .center-overlays > * { display: contents; }
.shell.layout-shell > .center-overlays [data-dsh-center-overlay] { grid-row: 2; min-width: 0; min-height: 0; overflow: auto; }
.shell.layout-shell:has(> .center-overlays [data-dsh-center-overlay]) > .editor,
.shell.layout-shell:has(> .center-overlays [data-dsh-center-overlay]) > .empty-paper { display: none !important; }
.shell.layout-shell.focus-mode { grid-template-columns: minmax(0, 1fr) !important; }
.shell.layout-shell.focus-mode .editor-header { justify-content: center; }
.shell.layout-shell.focus-mode .editor-header > *:not(:first-child):not(:last-child) { display: none; }
.shell.layout-shell.focus-mode .paper-input { padding: 56px 64px; max-width: 880px; margin-inline: auto; }
.shell.layout-shell.focus-mode .editor-tools { justify-content: center; }

.shell.no-session { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.no-session > .chrome { grid-column: 1; }
/* no-session(首页)整体放在画布色上,留出大段顶部空间让卡片居中偏上。 */
.shell.no-session > .empty-paper { grid-column: 1; grid-row: 2; place-items: start center; overflow: auto; padding: clamp(40px, 8vw, 112px) 24px; background: var(--chrome-bg); }
.shell.no-session .home-card { padding: clamp(28px, 4.5vw, 48px) clamp(28px, 4.5vw, 52px); }
.shell.no-session .home-card h1 { font-size: clamp(34px, 4.4vw, 48px); }
.shell.no-session .home-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }

/* ── Command palette (Cmd/Ctrl+K) ──────────────────────────
   cmdk 内部对所有元素不附加样式,只用 data-attribute 表示 selected/disabled。
   Radix Dialog 的 Portal 会把 Overlay/Content 渲染到 document.body —— 因此
   面板相关的选择器不能带 .shell 前缀(否则匹配不到),只 trigger 按钮的样式
   留在 .shell 命名空间下(它挂在 chrome 上,仍是 .shell 后代)。 */
.palette-overlay { position: fixed; z-index: 40; inset: 0; background: color-mix(in srgb, var(--studio) 36%, transparent); }
.palette-overlay[data-state="open"] { animation: palette-overlay-in var(--motion-fast) var(--ease); }
.palette-overlay[data-state="closed"] { animation: palette-overlay-out var(--motion-fast) var(--ease); }
.palette-content { position: fixed; z-index: 41; top: 20vh; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); max-height: min(540px, 64dvh); display: flex; flex-direction: column; padding: 0; border: 1px solid var(--hairline-strong); border-radius: var(--radius-lg); background: var(--bg); box-shadow: var(--elev-card); overflow: hidden; }
/* 进场带回弹、退场更快更直:开是"召唤",关是"退场",节奏刻意不同。 */
.palette-content[data-state="open"] { animation: palette-content-in var(--motion-emphasis) var(--ease-spring); }
.palette-content[data-state="closed"] { animation: palette-content-out var(--motion-fast) var(--ease); }
@keyframes palette-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes palette-overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes palette-content-in { from { opacity: 0; transform: translate(-50%, -10px) scale(.97); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes palette-content-out { from { opacity: 1; transform: translate(-50%, 0) scale(1); } to { opacity: 0; transform: translate(-50%, 5px) scale(.99); } }

.palette-command { display: flex; flex-direction: column; min-height: 0; }
.palette-search { display: flex; align-items: center; gap: var(--space-3); padding: 14px 16px; border-bottom: 1px solid var(--hairline); transition: border-color var(--motion-fast) var(--ease); }
.palette-search:focus-within { border-bottom-color: var(--accent); }
.palette-search-icon { display: grid; place-items: center; color: var(--meta); }
.palette-input { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; outline: 0; color: var(--fg); font: 500 18px/1.3 var(--font-sans); letter-spacing: .02em; }
.palette-input::placeholder { color: var(--meta); font-weight: 400; }
.palette-kbd { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 5px; font: 500 10px/1 var(--font-mono); letter-spacing: .04em; color: var(--meta); background: var(--surface); border-radius: var(--radius-xs); box-shadow: var(--elev-ring); }
.palette-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px; }
.palette-empty { padding: 24px 12px; text-align: center; color: var(--muted); font-size: var(--text-sm); letter-spacing: .04em; }
.palette-group { padding: 6px 0; }
.palette-group + .palette-group { border-top: 1px solid var(--hairline); margin-top: 4px; padding-top: 10px; }
.palette-group [cmdk-group-heading] { padding: 4px 12px 6px; font: 500 11px/1 var(--font-sans); letter-spacing: .14em; color: var(--meta); text-transform: uppercase; }
.palette-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 10px; border-radius: var(--radius-md); cursor: pointer; color: var(--fg-2); transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease); }
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
.shell .palette-trigger, .dsh-ui .palette-trigger { display: inline-flex; align-items: center; gap: 8px; min-height: var(--control-h); padding: 0 10px 0 12px; border: 0; border-radius: var(--radius-sm); background: var(--chrome-raised); color: var(--fg-2); cursor: pointer; font: 500 var(--text-chrome)/1 var(--font-sans); letter-spacing: .04em; box-shadow: var(--elev-ring); transition: background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease); }
.shell .palette-trigger:hover, .dsh-ui .palette-trigger:hover { background: var(--surface-warm); color: var(--fg); transform: translateY(-1px); }
.shell .palette-trigger:active, .dsh-ui .palette-trigger:active { transform: translateY(0); }
.shell .palette-trigger-icon, .dsh-ui .palette-trigger-icon { display: grid; place-items: center; color: var(--meta); }
.shell .palette-trigger:hover .palette-trigger-icon, .dsh-ui .palette-trigger:hover .palette-trigger-icon { color: var(--fg); }
.shell .palette-trigger-label, .dsh-ui .palette-trigger-label { white-space: nowrap; }
.shell .palette-trigger-kbd, .dsh-ui .palette-trigger-kbd { display: inline-grid; place-items: center; min-width: 22px; height: 18px; padding: 0 4px; font: 500 10px/1 var(--font-mono); letter-spacing: .04em; color: var(--meta); background: var(--bg); border-radius: var(--radius-xs); box-shadow: var(--elev-ring); }
.shell .palette-trigger:hover .palette-trigger-kbd, .dsh-ui .palette-trigger:hover .palette-trigger-kbd { color: var(--fg-2); }

/* 760px 折叠:trigger 的文字 label 隐藏,只保留放大镜 + kbd。 */
@media (max-width: 760px) {
.shell .palette-trigger-label, .dsh-ui .palette-trigger-label { display: none; }
  .palette-content { top: 12vh; max-height: 70dvh; }
}

/* ── Writing settings (宿主设置弹窗里的"写作"一节) ──────────────
   这段 DOM 由 shell 渲染进宿主设置弹窗,宿主样式不认识它,而 .shell 的
   input/textarea reset 会剥掉原生控件外观,所以这里自带完整样式。 */
.shell .writing-settings, .dsh-ui .writing-settings { display: grid; gap: var(--space-4); max-width: 560px; align-content: start; color: var(--fg-2); font-size: var(--text-sm); }
.shell .writing-settings h2, .dsh-ui .writing-settings h2 { margin: 0; font: 600 var(--text-md)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .writing-settings p, .dsh-ui .writing-settings p { margin: 0; color: var(--chrome-muted); }
.shell .writing-settings fieldset, .dsh-ui .writing-settings fieldset { display: grid; gap: var(--space-2); margin: 0; padding: var(--space-3) var(--space-4) var(--space-4); border: 1px solid var(--border-soft); border-radius: var(--radius-md); }
.shell .writing-settings legend, .dsh-ui .writing-settings legend { padding: 0 var(--space-1); font-weight: 500; color: var(--fg-2); }
.shell .writing-settings fieldset label, .dsh-ui .writing-settings fieldset label { display: flex; align-items: center; gap: var(--space-2); color: var(--fg-2); cursor: pointer; }
.shell .writing-settings fieldset input[type="radio"], .shell .writing-settings fieldset input[type="checkbox"], .dsh-ui .writing-settings fieldset input[type="radio"], .dsh-ui .writing-settings fieldset input[type="checkbox"] { margin: 0; accent-color: var(--accent-active); }
.shell .writing-settings .paper-typography .slider-row, .dsh-ui .writing-settings .paper-typography .slider-row { display: grid; gap: 4px; }
.shell .writing-settings .paper-typography .slider-row > span, .dsh-ui .writing-settings .paper-typography .slider-row > span { font-variant-numeric: tabular-nums; }
.shell .writing-settings .paper-typography input[type="range"], .dsh-ui .writing-settings .paper-typography input[type="range"] {
  width: 100%; height: 18px; margin: 0; padding: 0; border: 0; background: transparent; accent-color: var(--accent-active);
  -webkit-appearance: none; appearance: none;
}
.shell .writing-settings .paper-typography input[type="range"]:focus-visible, .dsh-ui .writing-settings .paper-typography input[type="range"]:focus-visible {
  outline: none; box-shadow: var(--focus-ring); border-radius: 999px;
}
.shell .writing-settings .paper-typography input[type="range"]::-webkit-slider-runnable-track, .dsh-ui .writing-settings .paper-typography input[type="range"]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--fg) 14%, transparent);
}
.shell .writing-settings .paper-typography input[type="range"]::-webkit-slider-thumb, .dsh-ui .writing-settings .paper-typography input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 14px; height: 14px; margin-top: -5px;
  border: 0; border-radius: 50%; background: var(--accent); box-shadow: var(--elev-ring);
}
.shell .writing-settings .paper-typography input[type="range"]::-moz-range-track, .dsh-ui .writing-settings .paper-typography input[type="range"]::-moz-range-track {
  height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--fg) 14%, transparent);
}
.shell .writing-settings .paper-typography input[type="range"]::-moz-range-thumb, .dsh-ui .writing-settings .paper-typography input[type="range"]::-moz-range-thumb {
  width: 14px; height: 14px; border: 0; border-radius: 50%; background: var(--accent);
}
.shell .writing-settings .paper-typography kbd, .dsh-ui .writing-settings .paper-typography kbd { margin-left: auto; color: var(--meta); font: 400 var(--text-xs)/1 var(--font-mono); }
.shell .writing-settings .paper-typography .choice-row, .dsh-ui .writing-settings .paper-typography .choice-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.shell .writing-settings .paper-typography .choice-row > span, .dsh-ui .writing-settings .paper-typography .choice-row > span { font-weight: 500; color: var(--fg-2); }
.shell .writing-settings .author-preferences, .dsh-ui .writing-settings .author-preferences { display: grid; gap: var(--space-2); }
.shell .writing-settings .author-preferences > span, .dsh-ui .writing-settings .author-preferences > span { font-weight: 500; color: var(--fg-2); }
.shell .writing-settings .author-preferences textarea, .dsh-ui .writing-settings .author-preferences textarea { width: 100%; box-sizing: border-box; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-sm)/1.7 var(--font-sans); resize: vertical; }
.shell .writing-settings .author-preferences textarea:focus-visible, .dsh-ui .writing-settings .author-preferences textarea:focus-visible { box-shadow: var(--focus-ring); }
.shell .writing-settings .author-preferences small, .dsh-ui .writing-settings .author-preferences small { color: var(--meta); }
/* 每日目标:与作者约定一致的输入风格;宽度收窄给数字用。 */
.shell .writing-settings .writing-progress-settings .goal-input, .dsh-ui .writing-settings .writing-progress-settings .goal-input { display: grid; gap: var(--space-2); }
.shell .writing-settings .writing-progress-settings .goal-input > span, .dsh-ui .writing-settings .writing-progress-settings .goal-input > span { font-weight: 500; color: var(--fg-2); }
.shell .writing-settings .writing-progress-settings .goal-input input, .dsh-ui .writing-settings .writing-progress-settings .goal-input input { width: 9em; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-sm)/1.4 var(--font-sans); font-variant-numeric: tabular-nums; }
.shell .writing-settings .writing-progress-settings .goal-input input:focus-visible, .dsh-ui .writing-settings .writing-progress-settings .goal-input input:focus-visible { box-shadow: var(--focus-ring); }
.shell .writing-settings .writing-progress-settings .goal-input small, .dsh-ui .writing-settings .writing-progress-settings .goal-input small { color: var(--meta); }
.shell .writing-settings > button, .dsh-ui .writing-settings > button { justify-self: start; min-height: 30px; padding: 5px 12px; border: 0; border-radius: var(--radius-md); background: var(--accent); color: var(--accent-on); font: 500 var(--text-sm)/1 var(--font-sans); letter-spacing: .08em; cursor: pointer; box-shadow: var(--elev-ring-accent); transition: box-shadow var(--motion-base) var(--ease), background var(--motion-fast) var(--ease); }
.shell .writing-settings > button:hover:not(:disabled), .dsh-ui .writing-settings > button:hover:not(:disabled) { background: var(--accent-active); }
.shell .writing-settings > button:disabled, .dsh-ui .writing-settings > button:disabled { opacity: .55; cursor: not-allowed; }
.shell .writing-settings p[role="alert"], .dsh-ui .writing-settings p[role="alert"] { color: var(--danger); }

/* ── 设置弹窗(自建,纸/墨风格) ──────────────────────────────
   替代上游 DSH 设置弹窗;overlay 复用 .file-dialog-overlay 的遮罩。
   原生 <select> 一律不用(见 baseStyles 尾部的 Chromium 弹层说明),
   下拉用 .select 组件(Radix Select,弹层 Portal 样式见下方"下拉"段)。 */
.shell .settings-trigger, .dsh-ui .settings-trigger { display: inline-flex; align-items: center; gap: 6px; min-height: var(--control-h); padding: 0 12px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--fg-2); cursor: pointer; font: 500 var(--text-chrome)/1 var(--font-sans); letter-spacing: .04em; }
.shell .settings-trigger:hover, .dsh-ui .settings-trigger:hover { background: var(--surface-warm); color: var(--fg); }
.shell .settings-trigger-icon, .dsh-ui .settings-trigger-icon { display: grid; place-items: center; font-size: 13px; color: var(--meta); }
.shell .settings-trigger:hover .settings-trigger-icon, .dsh-ui .settings-trigger:hover .settings-trigger-icon { color: var(--fg); }
.shell .settings-dialog, .dsh-ui.settings-dialog { width: min(760px, calc(100vw - 96px)); height: min(720px, calc(100dvh - 64px)); display: grid; grid-template-columns: 168px minmax(0, 1fr); padding: 0; overflow: hidden; background: var(--chrome-raised); }
.shell .settings-nav, .dsh-ui .settings-nav { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow: auto; padding: var(--space-4) var(--space-3); border-right: 1px solid var(--hairline); background: var(--chrome-bg); }
.shell .settings-nav h2, .dsh-ui .settings-nav h2 { margin: 0 0 var(--space-3); padding: 0 var(--space-2); font: 600 var(--text-md)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
/* 左侧导航是纯净列表:无框无底,hover 淡底,active 用 accent 淡底 + 强调色。
   width 100% 显式撑满(Chromium 的 button 默认收缩到内容宽度),并压过 .file-dialog button 的 inline-flex/justify-content。 */
.shell .settings-nav .settings-tab, .dsh-ui .settings-nav .settings-tab { display: flex; align-items: center; justify-content: flex-start; width: 100%; min-height: 32px; padding: 0 var(--space-3); border: 0; box-shadow: none; border-radius: var(--radius-sm); background: transparent; color: var(--fg-2); cursor: pointer; font: 500 var(--text-sm)/1.2 var(--font-sans); letter-spacing: .04em; text-align: left; }
.shell .settings-nav .settings-tab:hover, .dsh-ui .settings-nav .settings-tab:hover { background: var(--surface-warm); color: var(--fg); }
.shell .settings-nav .settings-tab.active, .dsh-ui .settings-nav .settings-tab.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.shell .settings-body, .dsh-ui .settings-body { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.shell .settings-header, .dsh-ui .settings-header { display: flex; align-items: center; gap: var(--space-2); flex: none; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--hairline); }
.shell .settings-header-title, .dsh-ui .settings-header-title { font: 600 var(--text-md)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .settings-open-config, .dsh-ui .settings-open-config { margin-left: auto; min-height: 26px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-sm); background: var(--surface); color: var(--fg-2); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; box-shadow: var(--elev-ring); }
.shell .settings-open-config:hover, .dsh-ui .settings-open-config:hover { background: var(--surface-warm); color: var(--fg); }
.shell .settings-header .settings-close, .dsh-ui .settings-header .settings-close { margin-left: auto; }
.shell .settings-header .settings-open-config + .settings-close, .dsh-ui .settings-header .settings-open-config + .settings-close { margin-left: 0; }
.shell .settings-body > .warning, .dsh-ui .settings-body > .warning { flex: none; }
.shell .settings-content, .dsh-ui .settings-content { min-height: 0; overflow: visible; padding: var(--space-4) var(--space-5); }
.shell .settings-content[hidden], .dsh-ui .settings-content[hidden] { display: none; }
.shell .writing-settings > h2, .dsh-ui .writing-settings > h2 { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
.shell .settings-block, .dsh-ui .settings-block { display: grid; gap: var(--space-2); margin: 0 0 var(--space-5); padding: 0 0 var(--space-4); border-bottom: 1px solid var(--hairline); }
.shell .settings-block:last-child, .dsh-ui .settings-block:last-child { border-bottom: 0; margin-bottom: 0; padding-bottom: 0; }
.shell .settings-block-head, .dsh-ui .settings-block-head { display: grid; gap: 4px; }
.shell .settings-block-title, .dsh-ui .settings-block-title { margin: 0; font: 600 var(--text-base)/1.4 var(--font-sans); letter-spacing: .02em; color: var(--fg); }
.shell .settings-block-help, .dsh-ui .settings-block-help { margin: 0; color: var(--chrome-muted); font-size: var(--text-sm); line-height: 1.55; }
.shell .writing-settings fieldset.settings-block, .dsh-ui .writing-settings fieldset.settings-block { padding: var(--space-3) var(--space-4) var(--space-4); border: 1px solid var(--border-soft); }
.shell .settings-content:has(.dsh-plugins), .dsh-ui .settings-content:has(.dsh-plugins) { padding-right: var(--space-4); }

/* 通用设置行 */
.shell .settings-general, .dsh-ui .settings-general { display: grid; gap: var(--space-4); max-width: 560px; align-content: start; }
.shell .settings-row, .dsh-ui .settings-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) 0; border-bottom: 1px solid var(--hairline); }
.shell .settings-row-text, .dsh-ui .settings-row-text { display: grid; gap: 2px; min-width: 0; }
.shell .settings-row-title, .dsh-ui .settings-row-title { font: 500 var(--text-sm)/1.5 var(--font-sans); color: var(--fg); }
.shell .settings-row-description, .dsh-ui .settings-row-description { color: var(--chrome-muted); font-size: var(--text-xs); }
.shell .settings-segmented, .dsh-ui .settings-segmented { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--radius-md); background: var(--bg-sunken); box-shadow: var(--elev-ring); }
.shell .settings-segmented button, .dsh-ui .settings-segmented button { min-height: 24px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--fg-2); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); }
.shell .settings-segmented button:hover, .dsh-ui .settings-segmented button:hover { color: var(--fg); }
.shell .settings-segmented button.active, .dsh-ui .settings-segmented button.active { background: var(--surface); color: var(--fg); box-shadow: var(--elev-ring); }

/* 下拉(Radix Select):触发钮留在 .shell 内;弹层 Portal 到 document.body,
   选择器因此不带 .shell 前缀(与 palette 同理),主题变量仍由 :root[data-theme]
   提供。z-index 60:压过模型设置的 .models-overlay(50)。react-popper 会读取
   .select-list 的计算 z-index 写到定位 wrapper 上,堆叠因此正确。 */
.shell .select, .dsh-ui .select { position: relative; display: inline-block; min-width: 0; }
.shell .select-trigger, .dsh-ui .select-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 160px; min-height: var(--control-h); padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 400 var(--text-sm)/1.4 var(--font-sans); transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-base) var(--ease), transform var(--motion-base) var(--ease); }
.shell .select-trigger:hover:not(:disabled), .dsh-ui .select-trigger:hover:not(:disabled) { border-color: var(--hairline-strong); }
.shell .select-trigger[data-state="open"], .dsh-ui .select-trigger[data-state="open"] { border-color: var(--hairline-strong); box-shadow: var(--elev-raised); }
.shell .select-trigger:disabled, .dsh-ui .select-trigger:disabled { opacity: .55; cursor: not-allowed; }
.shell .select-trigger:focus-visible, .dsh-ui .select-trigger:focus-visible { box-shadow: var(--focus-ring); }
.shell .select-value, .dsh-ui .select-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell .select-value.placeholder, .dsh-ui .select-value.placeholder { color: var(--meta); }
.shell .select-caret, .dsh-ui .select-caret { color: var(--meta); font-size: 11px; transition: transform var(--motion-fast) var(--ease); }
.shell .select-trigger[data-state="open"] .select-caret, .dsh-ui .select-trigger[data-state="open"] .select-caret { transform: rotate(180deg); }
.select-list, .select-list *, .select-list *::before, .select-list *::after { box-sizing: border-box; }
.select-list { z-index: 60; min-width: var(--radix-select-trigger-width); max-width: calc(100vw - 16px); padding: 0; border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); color: var(--fg); box-shadow: var(--elev-card); transform-origin: var(--radix-select-content-transform-origin); font: 400 var(--text-sm)/1.4 var(--font-sans); }
.select-list[data-state="open"] { animation: shell-pop-in var(--motion-base) var(--ease-spring); }
.select-list[data-state="closed"] { animation: shell-fade-out var(--motion-fast) var(--ease); }
@keyframes shell-fade-out { from { opacity: 1; } to { opacity: 0; transform: translateY(-2px) scale(.98); } }
.select-viewport { padding: 4px; max-height: min(320px, var(--radix-select-content-available-height, 50dvh)); overflow: auto; }
.select-viewport::-webkit-scrollbar { width: 8px; }
.select-viewport::-webkit-scrollbar-track { background: transparent; }
.select-viewport::-webkit-scrollbar-thumb { background: var(--hairline-strong); border-radius: var(--radius-sm); }
.select-option { display: flex; align-items: center; gap: 6px; padding: 6px var(--space-3); border-radius: var(--radius-sm); color: var(--fg-2); font-size: var(--text-sm); cursor: pointer; white-space: nowrap; user-select: none; outline: none; transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease); }
.select-option[data-highlighted] { background: var(--accent-soft); color: var(--accent); }
.select-option[data-state="checked"] { font-weight: 600; color: var(--fg); }
.select-option[data-disabled] { opacity: .5; cursor: not-allowed; }
.select-option-check { margin-left: auto; flex: none; font-size: 11px; color: var(--accent); }

/* 模型设置 */
.shell .models-page, .dsh-ui .models-page { max-width: 720px; display: flex; flex-direction: column; gap: var(--space-3); }
.shell .models-writing-routes, .dsh-ui .models-writing-routes { display: grid; gap: var(--space-2); padding-bottom: var(--space-3); border-bottom: 1px solid var(--hairline); }
.shell .models-writing-routes .settings-block-title, .dsh-ui .models-writing-routes .settings-block-title { white-space: nowrap; }
.shell .models-writing-route, .dsh-ui .models-writing-route { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); min-width: 0; padding: var(--space-2) 0; }
.shell .models-writing-route .select, .dsh-ui .models-writing-route .select { flex: 0 1 18rem; min-width: 12rem; max-width: 100%; }
.shell .settings-page, .dsh-ui .settings-page { min-width: 0; }
.shell .settings-pages, .dsh-ui .settings-pages { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; outline: none; }
.shell .settings-content.is-active, .dsh-ui .settings-content.is-active { position: relative; z-index: 1; display: block; }
.shell .sidebar-tools { min-width: 0; }
@keyframes shell-panel-enter { from { opacity: 0; transform: translateY(6px); } }
.shell .sidebar-tools > * { animation: shell-panel-enter var(--motion-base) var(--ease); }
.shell .models-header, .dsh-ui .models-header { display: grid; gap: 4px; }
.shell .models-title, .dsh-ui .models-title { margin: 0; font: 600 var(--text-md)/1.3 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .models-intro, .dsh-ui .models-intro { margin: 0; color: var(--chrome-muted); font-size: var(--text-xs); }
.shell .models-notice, .shell .models-status, .shell .models-warning, .shell .models-hint, .dsh-ui .models-notice, .dsh-ui .models-status, .dsh-ui .models-warning, .dsh-ui .models-hint { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .models-warning, .dsh-ui .models-warning { color: var(--danger); }
.shell .models-saved, .dsh-ui .models-saved { margin: 0; font-size: var(--text-xs); color: var(--confirm); }
.shell .models-status, .dsh-ui .models-status { color: var(--muted); }
.shell .models-error, .dsh-ui .models-error { display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); font-size: var(--text-xs); }
.shell .models-rows, .dsh-ui .models-rows { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.shell .models-row-card, .dsh-ui .models-row-card { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); }
.shell .models-row-head, .dsh-ui .models-row-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.shell .models-row-identity, .dsh-ui .models-row-identity { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.shell .models-row-name, .dsh-ui .models-row-name { font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); }
.shell .models-row-tag, .dsh-ui .models-row-tag { padding: 2px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.shell .models-row-actions, .dsh-ui .models-row-actions { display: inline-flex; align-items: center; gap: var(--space-2); }
.shell .models-row-state, .dsh-ui .models-row-state { width: 14px; height: 14px; flex: none; }
.shell .models-credential-dot, .dsh-ui .models-credential-dot { width: 8px; height: 8px; flex: none; border-radius: 999px; }
.shell .models-credential-dot-configured, .dsh-ui .models-credential-dot-configured { background: var(--confirm); }
.shell .models-credential-dot-missing, .dsh-ui .models-credential-dot-missing { background: var(--danger); }
.shell .models-button, .dsh-ui .models-button { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease); }
.shell .models-button:hover:not(:disabled), .dsh-ui .models-button:hover:not(:disabled) { background: var(--surface-warm); color: var(--fg); border-color: var(--hairline-strong); }
.shell .models-button:disabled, .dsh-ui .models-button:disabled { opacity: .55; cursor: not-allowed; }
.shell .models-button:focus-visible, .dsh-ui .models-button:focus-visible { box-shadow: var(--focus-ring); }
.shell .models-button-primary, .dsh-ui .models-button-primary { background: var(--accent); color: var(--accent-on); border-color: transparent; }
.shell .models-button-primary:hover:not(:disabled), .dsh-ui .models-button-primary:hover:not(:disabled) { background: var(--accent-active); color: var(--accent-on); }
.shell .models-button-danger, .dsh-ui .models-button-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.shell .models-button-danger:hover:not(:disabled), .dsh-ui .models-button-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 8%, var(--surface)); }
.shell .models-button-icon, .dsh-ui .models-button-icon { min-width: 28px; padding: 0 8px; }
.shell .models-button-add, .dsh-ui .models-button-add { align-self: flex-start; }
.shell .models-add-card, .dsh-ui .models-add-card { display: grid; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .models-add-picker, .dsh-ui .models-add-picker { display: grid; gap: var(--space-2); }
.shell .models-add-actions, .dsh-ui .models-add-actions { display: inline-flex; gap: var(--space-2); }
.shell .models-editor, .dsh-ui .models-editor { display: grid; gap: var(--space-3); padding: var(--space-3); border-top: 1px solid var(--hairline); }
.shell .models-row-card > .models-editor, .dsh-ui .models-row-card > .models-editor { border-top: 1px solid var(--hairline); margin-top: var(--space-2); }
.shell .models-editor-header, .dsh-ui .models-editor-header { display: flex; align-items: baseline; gap: var(--space-2); }
.shell .models-editor-title, .dsh-ui .models-editor-title { font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); }
.shell .models-editor-route, .dsh-ui .models-editor-route { font-size: var(--text-xs); color: var(--meta); font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.shell .models-editor-actions, .dsh-ui .models-editor-actions { display: inline-flex; gap: var(--space-2); justify-content: flex-end; }
.shell .models-field, .dsh-ui .models-field { display: grid; gap: 6px; min-width: 0; }
.shell .models-field-label, .dsh-ui .models-field-label { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); letter-spacing: .04em; }
.shell .models-field-row, .dsh-ui .models-field-row { grid-template-columns: 120px minmax(0, 1fr); align-items: center; gap: var(--space-3); }
.shell .models-input, .dsh-ui .models-input { width: 100%; min-height: 28px; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); font: 400 var(--text-sm)/1.4 var(--font-sans); box-shadow: none; }
.shell .models-input:hover:not(:disabled), .dsh-ui .models-input:hover:not(:disabled) { border-color: var(--hairline-strong); }
.shell .models-input:focus-visible, .dsh-ui .models-input:focus-visible { border-color: var(--accent-active); box-shadow: var(--focus-ring); }
.shell .models-input:disabled, .dsh-ui .models-input:disabled { opacity: .6; cursor: not-allowed; }
.shell .models-input::placeholder, .dsh-ui .models-input::placeholder { color: var(--meta); }
.shell .models-input-id, .dsh-ui .models-input-id { flex: 1 1 200px; }
.shell .models-input-name, .dsh-ui .models-input-name { flex: 1 1 200px; }
.shell .models-customized, .dsh-ui .models-customized { border: 1px solid var(--hairline); border-radius: var(--radius-sm); }
.shell .models-customized > summary, .dsh-ui .models-customized > summary { cursor: pointer; padding: 8px var(--space-3); font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); list-style: none; }
.shell .models-customized > summary::-webkit-details-marker, .dsh-ui .models-customized > summary::-webkit-details-marker { display: none; }
.shell .models-customized[open] > summary, .dsh-ui .models-customized[open] > summary { border-bottom: 1px solid var(--hairline); }
.shell .models-customized-body, .dsh-ui .models-customized-body { display: grid; gap: var(--space-3); padding: var(--space-3); }
.shell .models-catalog, .dsh-ui .models-catalog { display: grid; gap: var(--space-2); }
.shell .models-catalog-head, .dsh-ui .models-catalog-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.shell .models-catalog-title, .dsh-ui .models-catalog-title { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--fg-2); letter-spacing: .04em; }
.shell .models-catalog-entry, .dsh-ui .models-catalog-entry { display: grid; gap: 6px; padding: var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--bg); }
.shell .models-catalog-row, .dsh-ui .models-catalog-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.shell .models-catalog-advanced, .dsh-ui .models-catalog-advanced { display: grid; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--hairline); }
.shell .models-empty, .dsh-ui .models-empty { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .models-overlay, .dsh-ui .models-overlay { z-index: 50; }
.shell .models-candidate-dialog, .dsh-ui .models-candidate-dialog { width: min(560px, 100%); max-height: min(640px, calc(100dvh - 48px)); }
.shell .models-candidate-list, .dsh-ui .models-candidate-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; max-height: 360px; overflow: auto; }
/* 提级到 dialog 作用域:压过 .file-dialog label 的 grid 和 .file-dialog input 的文本框样式,
   否则勾选框和模型名会被竖向堆叠、勾选框被撑成文本框。 */
.shell .models-candidate-dialog .models-candidate-label, .dsh-ui .models-candidate-dialog .models-candidate-label { display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-2); border-radius: var(--radius-sm); cursor: pointer; }
.shell .models-candidate-dialog .models-candidate-label:hover, .dsh-ui .models-candidate-dialog .models-candidate-label:hover { background: var(--surface); }
.shell .models-candidate-dialog .models-candidate-label input[type="checkbox"], .dsh-ui .models-candidate-dialog .models-candidate-label input[type="checkbox"] { width: 14px; height: 14px; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); accent-color: var(--accent-active); cursor: pointer; }
.shell .models-candidate-id, .dsh-ui .models-candidate-id { font: 500 var(--text-sm)/1.4 var(--font-sans); color: var(--fg); }
.shell .models-candidate-name, .dsh-ui .models-candidate-name { color: var(--meta); font-size: var(--text-xs); }
.shell .models-candidate-description, .dsh-ui .models-candidate-description { margin: 0; font-size: var(--text-xs); color: var(--meta); }
.shell .models-candidate-actions, .dsh-ui .models-candidate-actions { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 8px; }

/* 关于与更新:复用 .file-dialog 弹层节奏,只加 about-* 自己的版块。 */
.shell .about-page, .dsh-ui .about-page { max-width: 520px; display: flex; flex-direction: column; gap: var(--space-4); }
.shell .about-header, .dsh-ui .about-header { display: grid; gap: 4px; }
.shell .about-title, .dsh-ui .about-title { margin: 0; font: 600 var(--text-md)/1.3 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .about-version, .dsh-ui .about-version { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.shell .about-version strong, .dsh-ui .about-version strong { color: var(--fg); font-weight: 500; }
.shell .about-status, .dsh-ui .about-status { margin: 0; font-size: var(--text-sm); color: var(--fg-2); display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.shell .about-status-tag, .dsh-ui .about-status-tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font: 500 var(--text-xs)/1.4 var(--font-sans); letter-spacing: .04em; }
.shell .about-status-tag.latest, .dsh-ui .about-status-tag.latest { background: color-mix(in srgb, var(--confirm) 12%, var(--surface)); color: var(--confirm); }
.shell .about-status-tag.available, .dsh-ui .about-status-tag.available { background: var(--accent-soft); color: var(--accent); }
.shell .about-status-tag.error, .dsh-ui .about-status-tag.error { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
.shell .about-release, .dsh-ui .about-release { display: grid; gap: 6px; padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg-sunken); }
.shell .about-release-meta, .dsh-ui .about-release-meta { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
.shell .about-release-version, .dsh-ui .about-release-version { font: 500 var(--text-sm)/1.3 var(--font-sans); color: var(--fg); }
.shell .about-release-date, .dsh-ui .about-release-date { color: var(--muted); font-size: var(--text-xs); }
.shell .about-release-body, .dsh-ui .about-release-body { margin: 0; font: 400 var(--text-sm)/1.65 var(--font-sans); color: var(--fg-2); white-space: pre-wrap; max-height: 220px; overflow: auto; }
.shell .about-note, .dsh-ui .about-note { margin: 0; color: var(--meta); font-size: var(--text-xs); line-height: 1.7; }
.shell .about-actions, .dsh-ui .about-actions { display: flex; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
.shell .about-button, .dsh-ui .about-button { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease); }
.shell .about-button:hover:not(:disabled), .dsh-ui .about-button:hover:not(:disabled) { background: var(--surface-warm); color: var(--fg); border-color: var(--hairline-strong); }
.shell .about-button:disabled, .dsh-ui .about-button:disabled { opacity: .55; cursor: not-allowed; }
.shell .about-button:focus-visible, .dsh-ui .about-button:focus-visible { box-shadow: var(--focus-ring); }
.shell .about-button-primary, .dsh-ui .about-button-primary { background: var(--accent); color: var(--accent-on); border-color: transparent; }
.shell .about-button-primary:hover:not(:disabled), .dsh-ui .about-button-primary:hover:not(:disabled) { background: var(--accent-active); color: var(--accent-on); }
.shell .about-error, .dsh-ui .about-error { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--danger) 8%, var(--surface)); color: var(--danger); font-size: var(--text-xs); white-space: pre-wrap; }
.shell .about-download, .dsh-ui .about-download { display: grid; gap: 6px; }
.shell .about-progress, .dsh-ui .about-progress { height: 6px; border-radius: 999px; background: var(--hairline); overflow: hidden; }
.shell .about-progress-fill, .dsh-ui .about-progress-fill { height: 100%; border-radius: inherit; background: var(--accent); transition: width var(--motion-fast) var(--ease); }
.shell .about-download-meta, .dsh-ui .about-download-meta { margin: 0; color: var(--muted); font-size: var(--text-xs); line-height: 1.6; }
/* 关于/更新入口:沿用 .settings-trigger 的轻量按钮节奏,放在 SettingsTrigger 旁。 */
.shell .about-trigger, .dsh-ui .about-trigger { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--fg-2); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; }
.shell .about-trigger:hover, .dsh-ui .about-trigger:hover { background: var(--surface-warm); color: var(--fg); }
/* 启动更新提示:右下角轻量 toast,只在后台检查发现新版本时出现。 */
.shell .update-toast, .dsh-ui .update-toast { position: fixed; right: var(--space-4); bottom: var(--space-4); z-index: 40; display: flex; align-items: center; gap: var(--space-3); padding: 6px 6px 6px var(--space-3); border: 1px solid var(--hairline-strong); border-radius: var(--radius-md); background: var(--bg); box-shadow: var(--elev-raised); font-size: var(--text-sm); color: var(--fg); animation: shell-rise-in var(--motion-base) var(--ease-spring); }
.shell .update-toast-action, .dsh-ui .update-toast-action { min-height: 26px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-on); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; }
.shell .update-toast-action:hover, .dsh-ui .update-toast-action:hover { background: var(--accent-active); }
.shell .update-toast-action:focus-visible, .dsh-ui .update-toast-action:focus-visible { box-shadow: var(--focus-ring); }
.shell .update-toast-close, .dsh-ui .update-toast-close { min-width: 24px; min-height: 24px; }
.shell .about-trigger-icon, .dsh-ui .about-trigger-icon { display: grid; place-items: center; font-size: 13px; color: var(--meta); }
.shell .about-trigger:hover .about-trigger-icon, .dsh-ui .about-trigger:hover .about-trigger-icon { color: var(--fg); }

/* 用量设置:今日 4 卡 + 近 7 日分模型堆叠柱状图 + 底部说明。 */
.shell .usage-page, .dsh-ui .usage-page { max-width: 720px; display: flex; flex-direction: column; gap: var(--space-5); }
.shell .usage-header, .dsh-ui .usage-header { display: grid; gap: 4px; }
.shell .usage-title, .dsh-ui .usage-title { margin: 0; font: 600 var(--text-md)/1.3 var(--font-sans); letter-spacing: .04em; color: var(--fg); }
.shell .usage-intro, .dsh-ui .usage-intro { margin: 0; color: var(--chrome-muted); font-size: var(--text-sm); line-height: 1.7; }
.shell .usage-status, .dsh-ui .usage-status { margin: 0; font-size: var(--text-xs); color: var(--muted); }
.shell .usage-error, .dsh-ui .usage-error { display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); font-size: var(--text-xs); }
.shell .usage-section-title, .dsh-ui .usage-section-title { margin: 0 0 var(--space-3); font: 500 var(--text-sm)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg-2); }
.shell .usage-cards, .dsh-ui .usage-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); }
.shell .usage-card, .dsh-ui .usage-card { display: grid; gap: 6px; padding: var(--space-3); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.shell .usage-card-label, .dsh-ui .usage-card-label { font: 500 var(--text-xs)/1.4 var(--font-sans); color: var(--meta); letter-spacing: .04em; }
.shell .usage-card-value, .dsh-ui .usage-card-value { font: 600 var(--text-md)/1.2 var(--font-sans); color: var(--fg); font-variant-numeric: tabular-nums; }
/* 柱状图:ECharts SVG 堆叠柱 + 图例 + 精确数据表。 */
.shell .usage-chart, .dsh-ui .usage-chart { display: grid; gap: var(--space-3); min-width: 0; }
.shell .usage-chart-plot, .dsh-ui .usage-chart-plot { width: 100%; height: 200px; min-height: 160px; max-height: 220px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--surface); }
.usage-chart-tooltip { max-width: min(280px, calc(100vw - 32px)); white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.shell .usage-chart-legend, .dsh-ui .usage-chart-legend { display: flex; flex-wrap: wrap; gap: 6px var(--space-4); margin: 0; padding: 0; list-style: none; }
.shell .usage-chart-legend li, .dsh-ui .usage-chart-legend li { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; font-size: var(--text-xs); color: var(--fg-2); }
.shell .usage-chart-chip, .dsh-ui .usage-chart-chip { width: 10px; height: 10px; flex: none; border-radius: 3px; }
.shell .usage-chart-model, .dsh-ui .usage-chart-model { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14em; }
.shell .usage-chart-meta, .dsh-ui .usage-chart-meta { color: var(--meta); font-variant-numeric: tabular-nums; }
.shell .usage-chart-table, .dsh-ui .usage-chart-table { min-width: 0; color: var(--fg-2); font-size: var(--text-xs); }
.shell .usage-chart-table > summary, .dsh-ui .usage-chart-table > summary { cursor: pointer; color: var(--meta); }
.shell .usage-chart-table table, .dsh-ui .usage-chart-table table { width: 100%; margin-top: var(--space-2); border-collapse: collapse; }
.shell .usage-chart-table th, .shell .usage-chart-table td, .dsh-ui .usage-chart-table th, .dsh-ui .usage-chart-table td { padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid var(--hairline); }
.shell .usage-chart-table th:first-child, .shell .usage-chart-table td:first-child, .dsh-ui .usage-chart-table th:first-child, .dsh-ui .usage-chart-table td:first-child { text-align: left; }
.shell .usage-empty, .dsh-ui .usage-empty { margin: 0; padding: var(--space-4); text-align: center; color: var(--meta); font-size: var(--text-sm); border: 1px dashed var(--hairline-strong); border-radius: var(--radius-md); }
.shell .usage-footnote, .dsh-ui .usage-footnote { margin: 0; color: var(--meta); font-size: var(--text-xs); }
.shell .usage-button, .dsh-ui .usage-button { display: inline-flex; align-items: center; justify-content: center; min-height: 24px; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); cursor: pointer; font: 500 var(--text-xs)/1 var(--font-sans); letter-spacing: .04em; }
.shell .usage-button:hover, .dsh-ui .usage-button:hover { background: var(--surface-warm); border-color: var(--hairline-strong); }
@media (max-width: 560px) { .shell .usage-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

.shell .pinned-pane, .dsh-ui .pinned-pane { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--surface); box-shadow: var(--elev-raised); }
.shell .pinned-header, .dsh-ui .pinned-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); padding: 16px 24px 12px; border-bottom: 1px solid var(--hairline); }
.shell .pinned-header h2, .dsh-ui .pinned-header h2 { margin: 0; font: 500 20px/1.2 var(--font-serif); letter-spacing: -.02em; color: var(--fg); }
.shell .pinned-header p, .dsh-ui .pinned-header p { margin: 6px 0 0; }
.shell .pinned-actions, .dsh-ui .pinned-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.shell .pinned-actions button, .dsh-ui .pinned-actions button { padding: 5px 7px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); cursor: pointer; font-size: var(--text-xs); }
.shell .pinned-body, .dsh-ui .pinned-body { min-height: 0; overflow: auto; display: grid; gap: var(--space-4); padding: 16px 24px 32px; }
.shell .pinned-fields, .dsh-ui .pinned-fields { margin: 0; display: grid; gap: 8px; }
.shell .pinned-field, .dsh-ui .pinned-field { display: grid; gap: 2px; }
.shell .pinned-field dt, .dsh-ui .pinned-field dt { color: var(--meta); font: 500 var(--text-xs)/1.4 var(--font-sans); }
.shell .pinned-field dd, .dsh-ui .pinned-field dd { margin: 0; color: var(--fg); font: 400 var(--text-sm)/1.5 var(--font-sans); }
.shell .pinned-text, .dsh-ui .pinned-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 400 var(--text-sm)/1.65 var(--font-serif); color: var(--fg); }

/* ── Responsive collapse ────────────────────────────────── */
@media (max-width: 1040px) {
  .shell { grid-template-columns: 196px minmax(0, 1fr); }
  .shell > .chat, .shell > .panel-resizer.right { display: none; }
  .shell > .chrome { grid-template-columns: 196px minmax(0, 1fr); }
  .shell > .chrome > .workspace-chrome { display: none; }
  .shell > .chrome > .topbar-actions { padding-right: var(--space-4); }
.shell .editor-header, .dsh-ui .editor-header { padding-inline: 20px; }
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
  .shell .home-entry-card, .dsh-ui .home-entry-card { min-height: 0; }
}

/* Portaled chrome: tooltip, CSS dialog exit, control sizing. */
.confirm-overlay { z-index: 55; }
.tooltip-content { z-index: 70; padding: 6px 10px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-sm); background: var(--chrome-raised); color: var(--chrome-fg); font: 500 12px/1.3 var(--font-sans); box-shadow: var(--elev-raised); }
.tooltip-content[data-state="delayed-open"], .tooltip-content[data-state="instant-open"] { animation: shell-pop-in var(--motion-fast) var(--ease-spring); }
.file-dialog-overlay[data-state="closed"], .dsh-ui.file-dialog-overlay[data-state="closed"] { pointer-events: none; animation: shell-fade-out var(--motion-fast) var(--ease) forwards; }
.file-dialog[data-state="closed"], .dsh-ui.file-dialog[data-state="closed"] { pointer-events: none; animation: shell-dialog-out var(--motion-fast) var(--ease) forwards; }
@keyframes shell-dialog-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(8px) scale(.98); } }
.dsh-ui .ui-button, .dsh-ui.file-dialog .ui-button { min-height: var(--control-h); }
.dsh-ui .ui-input, .dsh-ui.file-dialog .ui-input { min-height: var(--control-h); padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--fg); }
.dsh-ui [role="tablist"] { display: flex; flex-direction: row; gap: 2px; width: 100%; }
.dsh-ui [role="tablist"][data-orientation="vertical"], .dsh-ui [role="tablist"][aria-orientation="vertical"] { flex-direction: column; }
.dsh-ui .dsh-plugins-tabs[role="tablist"], .dsh-ui.file-dialog .dsh-plugins-tabs[role="tablist"] {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  width: max-content;
  gap: 2px;
}
.shell .settings-tabs, .dsh-ui .settings-tabs { display: contents; }

/* ── Reduced motion ─────────────────────────────────────── */
/* 覆盖 Portal 到 body 的浮层(palette/select,在 .shell 之外)与伪元素;
   hover/:active 的位移 transform 也一并抹掉,而不是只停掉过渡。 */
@media (prefers-reduced-motion: reduce) {
  .shell *, .shell *::before, .shell *::after,
  .dsh-ui, .dsh-ui *, .dsh-ui *::before, .dsh-ui *::after,
  .palette-overlay, .palette-overlay::before, .palette-overlay::after,
  .palette-content, .palette-content *, .palette-content *::before, .palette-content *::after,
  .select-list, .select-list *, .select-list *::before, .select-list *::after,
  .tooltip-content, .tooltip-content *, .file-context-menu, .file-context-menu * {
    scroll-behavior: auto !important;
    transition: none !important;
    animation: none !important;
  }
  .shell *:hover, .shell *:active, .dsh-ui *:hover, .dsh-ui *:active { transform: none !important; }
  .shell .settings-page, .dsh-ui .settings-page { opacity: 1 !important; transform: none !important; }
  .shell .ghost.is-loading, .dsh-ui .ghost.is-loading { animation: none; color: var(--ghost); background: none; }
}
`

/* Single concatenated string for the runtime to drop into a <style> element.
   Kept as a string so existing call sites keep working — splitting is purely
   for editorial readability above. */
export const redesignedStyles = `${tokenStyles}${baseStyles}${componentStyles}`
