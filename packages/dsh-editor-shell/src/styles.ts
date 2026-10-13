import { chatMessageStyles } from './client/chat-message-styles.ts'
import { historyStyles } from './client/history-styles.ts'
/*
 * DSH Editor shell — residual CSS on top of Radix Themes.
 * Hand-written CSS is only for grid / -webkit-app-region / CodeMirror /
 * cmdk / resizer / keyframes. Colours, space, radius, and type use Radix
 * variables — no hex / rgba in components. Semantic class names stay as
 * e2e / panel hooks; search e2e/ before renaming them.
 */

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/* Palette and font variables now live only in design-system/tokens.ts
   (dsh.tokens layer). This block keeps structural shell metrics only. */
export const themeStyles = `
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
.shell button:not([class^="rt-"]):not([class*=" rt-"]):not(:where([data-dsh-plugin-surface] *)),
.shell input:not([class^="rt-"]):not([class*=" rt-"]):not(:where([data-dsh-plugin-surface] *)),
.shell select:not([class^="rt-"]):not([class*=" rt-"]):not(:where([data-dsh-plugin-surface] *)),
.shell textarea:not([class^="rt-"]):not([class*=" rt-"]):not(:where([data-dsh-plugin-surface] *)) { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; }
.shell button:not([class^="rt-"]):not([class*=" rt-"]):not(:where([data-dsh-plugin-surface] *)) { cursor: pointer; transition: background-color 150ms ${EASE}, color 150ms ${EASE}, border-color 150ms ${EASE}, box-shadow 150ms ${EASE}; }
@keyframes shell-fade-in { from { opacity: 0; } }
@keyframes shell-message-in { from { opacity: 0; transform: translateY(var(--space-3)); } }
@keyframes shell-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes shell-activity-typing { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes shell-activity-shimmer { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
@keyframes shell-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
@keyframes shell-success-draw { from { stroke-dashoffset: 42; } }
.shell textarea:not([class^="rt-"]):not([class*=" rt-"]):not(:where([data-dsh-plugin-surface] *)) { resize: none; outline: none; }
.shell :focus:not(:where([data-dsh-plugin-surface] *)) { outline: none; }
.shell :focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: 0 0 0 2px var(--accent-10); }
.shell button:not([class^="rt-"]):not([class*=" rt-"]):not(:where([data-dsh-plugin-surface] *)):disabled { cursor: not-allowed; opacity: .55; }
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
/* 工作区顶栏已迁入 app/shell（.dsh-topbar，dsh.surfaces 层）。下面保留的
   .chrome 规则只服务首页 HomeChrome（4.1 不动首页内部结构）。 */
.shell > .chrome {
  grid-column: 1 / -1;
  height: var(--topbar-h);
  min-width: 0;
  padding-right: 0;
  border-bottom: 1px solid var(--gray-a5);
  box-shadow: inset 0 -2px 0 var(--accent-a5);
  background: var(--gray-2);
  -webkit-app-region: drag;
}
.shell > .chrome button, .shell > .chrome summary, .shell > .chrome input, .shell > .chrome a, .shell > .chrome .select { -webkit-app-region: no-drag; }
.shell .chrome .shell-extensions-dock { -webkit-app-region: drag; }
.shell .chrome-main,
.shell .topbar-actions {
  display: flex;
  align-items: center;
}
.shell .chrome-main { flex: 1 1 auto; min-width: 0; height: 100%; }
.shell .topbar-actions { flex-shrink: 0; height: 100%; }
.shell .topbar-actions { padding-right: var(--space-3); }
.shell .topbar-actions:has(+ .window-controls) { padding-right: var(--space-1); }
.shell > .chrome .palette-trigger {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: var(--control-h);
  min-height: var(--control-h);
  margin: 0;
  gap: var(--space-1);
}
.shell > .chrome button.rt-IconButton,
.shell > .chrome .window-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: var(--control-h);
  height: var(--control-h);
  min-width: var(--control-h);
  min-height: var(--control-h);
  padding: 0;
  margin: 0;
  line-height: 0;
  --icon-button-ghost-padding: 0px;
  --margin-top-override: 0px;
  --margin-right-override: 0px;
  --margin-bottom-override: 0px;
  --margin-left-override: 0px;
}
.shell > .chrome button.rt-IconButton svg,
.shell > .chrome .palette-trigger-icon,
.shell > .chrome .palette-trigger-icon svg,
.shell > .chrome .settings-trigger-icon,
.shell > .chrome .settings-trigger-icon svg {
  display: block;
  flex-shrink: 0;
}
/* Residual: window-control hover colors and the extensions dock placement
   contract (position:fixed + --dsh-ext-* variables). */
.workspace-menu-panel { min-width: max(18rem, var(--radix-dropdown-menu-trigger-width, 16rem)); }
.shell .window-controls {
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  align-self: center;
  height: var(--control-h);
}
.shell .window-controls button:hover { background: var(--gray-a3); }
.shell .window-controls button.window-close:hover { background: var(--red-9); color: var(--accent-contrast); }
.shell-extensions-dock {
  display: flex;
  align-items: center;
  justify-content: flex-end;
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
/* 停靠在顶栏内（工作台 .dsh-topbar 与首页 .chrome 同一约定）：静态定位参与 flex 布局。 */
.shell .dsh-topbar .shell-extensions-dock,
.shell .chrome .shell-extensions-dock {
  position: static;
  top: auto;
  right: auto;
  height: auto;
  padding: 0;
  margin-left: 0;
  flex: 1 1 auto;
}
.radix-themes .path-fallback { min-width: 0; }
.radix-themes .icon-button { display: grid; place-items: center; min-width: 32px; min-height: 32px; padding: 3px; border: 0; border-radius: var(--radius-3); background: transparent; cursor: pointer; color: var(--gray-10); transition: transform 120ms ${EASE}, background-color 150ms ${EASE}, color 150ms ${EASE}; }
.radix-themes .icon-button:hover { background: var(--gray-a3); color: var(--gray-12); }
.radix-themes .icon-button:active { transform: scale(.9); }

/* Sidebar/tree/search rules moved to src/app/files/files-rail.styles.ts (§3). */
${historyStyles}
.shell .pinned-pane { min-width: 0; min-height: 0; overflow: hidden; }
.shell .pinned-header { border-bottom: 1px solid var(--gray-a5); }
.shell .pinned-body { min-height: 0; flex: 1 1 auto; }
.shell .pinned-markdown { min-width: 0; overflow-wrap: anywhere; }

.radix-themes .cards-badge { padding: 1px 6px; border-radius: 999px; background: var(--gray-3); color: var(--gray-11); font-style: normal; }
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
  font-size: var(--font-size-4);
  color: var(--gray-11);
  background: var(--color-panel-solid);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--gray-a6);
}

.shell .panel-resizer {
  position: relative;
  z-index: 20;
  flex: 0 0 12px;
  /* The grab strip is a control with an accessible name, so the hit area is
     sized like one even though the drawn rule stays hairline-thin. */
  width: 12px;
  cursor: col-resize;
  background: transparent;
}
.shell .panel-resizer::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--dsh-ui-line);
  pointer-events: none;
}
.shell .panel-resizer:hover::before,
.shell .panel-resizer:focus-visible::before,
.shell .panel-resizer[data-separator="active"]::before { background: var(--dsh-ui-line-strong); }

/* ── Editor / paper ─────────────────────────────────────── */
.radix-themes .editor { height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--paper-fill); position: relative; z-index: 1; --paper-pad-inline: 64px; --paper-pad-block: 36px; --paper-header-space: 96px; }

/* 稿纸页内页眉：挂在 .cm-scroller 顶部的宿主里，随文档滚走（不吸顶）。
   页眉不显示标题文字（正文一级标题即章节名），只留右侧「⋯」菜单；
   天头细线改由 live-preview 一级标题的底线承担。 */
.radix-themes .paper-page-header { height: 100%; box-sizing: border-box; padding-top: 28px; color: var(--dsh-ui-text, var(--gray-12)); }
.radix-themes .paper-page-headline { position: relative; max-width: var(--paper-measure, 100%); margin-inline: auto; padding-inline: var(--paper-pad-inline); box-sizing: border-box; }
.radix-themes .paper-page-menu { position: absolute; inset-inline-end: var(--paper-pad-inline); top: 0; display: inline-flex; align-items: center; }

.radix-themes .editor-action-menu { min-width: 220px; }

/* 稿纸页脚状态行：版心居中、12px muted，固定在可视稿纸下沿。 */
.radix-themes .paper-footer-status { margin-inline: auto; display: flex; gap: 12px; align-items: baseline; font-size: var(--font-size-1); color: var(--s-muted, var(--gray-11)); }

/* 选段改写浮层（§4）：预设一行 + 指令一行 + 操作行。 */
.dsh-popover .rewrite-popover { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2, 8px); min-width: 300px; }
.dsh-popover .rewrite-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-popover .rewrite-instruction { width: 100%; }
.dsh-popover .rewrite-popover-actions { display: flex; gap: 8px; justify-content: flex-end; }

.radix-themes .paper-input {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  color: var(--gray-12);
}
/* 版心两侧各一条 1px margin-rule 竖线：横坐标由 editor.tsx 按 .cm-content
   实际内容盒量出后写进 --paper-rule-left / --paper-rule-right（线内缘距
   文字区 24px）；变量未写入时退回 --paper-measure 中线推算。
   pointer-events 关掉，不遮挡选区与光标。 */
.radix-themes .paper-input::before,
.radix-themes .paper-input::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--dsh-ui-margin-rule);
  pointer-events: none;
}
.radix-themes .paper-input::before { left: var(--paper-rule-left, max(0px, calc(50% - var(--paper-measure, 100%) / 2))); }
.radix-themes .paper-input::after { right: max(0px, calc(50% - var(--paper-measure, 100%) / 2)); left: var(--paper-rule-right, auto); }
.radix-themes .paper-input .cm-editor { width: 100%; height: 100%; background: transparent; }
.radix-themes .paper-input .cm-scroller {
  align-items: flex-start !important;
  justify-content: flex-start;
  font-family: var(--paper-font-family, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif);
}
.radix-themes .paper-input .cm-content {
  width: 100%;
  max-width: var(--paper-max-width, none);
  margin-inline: auto;
  box-sizing: border-box;
  text-align: start;
}
.radix-themes .paper-input .cm-line { text-align: start; }
.radix-themes .paper-input .cm-placeholder { color: var(--gray-10); }
.radix-themes .paper-scroll { max-width: 36em; margin: 0 auto; }

.radix-themes .ghost { color: var(--gray-9); font: inherit; letter-spacing: inherit; line-height: inherit; }
.radix-themes .ghost.is-loading { color: transparent; background-image: linear-gradient(90deg, var(--gray-9) 0%, var(--gray-11) 46%, var(--gray-9) 100%); background-size: 180% 100%; background-clip: text; -webkit-background-clip: text; animation: ghost-shimmer 1.35s ${EASE} infinite; }
@keyframes ghost-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -80% 0; } }

.radix-themes .editor-tools { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: var(--space-8); padding: var(--space-2) var(--space-5); border-top: 1px solid var(--gray-a5); background: var(--paper-fill); color: var(--gray-11); flex-shrink: 0; }
.radix-themes .editor-tools button { display: inline-flex; align-items: center; justify-content: center; min-height: var(--space-6); padding: 0 var(--space-3); border: 1px solid transparent; border-radius: var(--radius-3); background: var(--gray-a3); color: var(--gray-12); cursor: pointer; font-size: var(--font-size-1); transition: transform 140ms ${EASE}, background-color 150ms ${EASE}, border-color 150ms ${EASE}, box-shadow 150ms ${EASE}; }
.radix-themes .editor-tools button:hover:not(:disabled) { background: var(--gray-a4); border-color: var(--gray-a5); box-shadow: var(--shadow-2); transform: translateY(-1px); }
.radix-themes .editor-tools button:active:not(:disabled) { transform: scale(.97); }
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
  overflow-x: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--color-panel-solid);
}
.shell .chat > * { min-width: 0; max-width: 100%; }
.shell .chat[hidden] { display: none !important; pointer-events: none; }
.shell .chat-header {
  min-height: var(--space-8);
  border-bottom: 1px solid var(--gray-a5);
}
.shell .chat-history { min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.shell .chat-history .rt-ScrollAreaViewport { overscroll-behavior: contain; }
.radix-themes .chat-row { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.shell .proposal-card pre { max-height: 12rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.radix-themes .chat-row.chat-row-enter { animation: shell-message-in 200ms both; }
${chatMessageStyles}
.radix-themes .workspace-checking { grid-column: 1 / -1; grid-row: 1 / -1; }

.radix-themes .file-dialog { max-width: min(520px, calc(100vw - 32px)); }
.radix-themes .confirm-dialog { z-index: 56; }
.radix-themes .file-dialog.chapter-ops-dialog { max-width: min(680px, calc(100vw - 32px)); }
.radix-themes .file-dialog.export-preview-dialog { max-width: min(640px, calc(100vw - 32px)); }
.radix-themes .chapter-ops-card { min-width: 0; }
.radix-themes .chapter-ops-dialog .proposal-card .proposal-actions { display: flex; width: auto; justify-content: flex-end; }
.radix-themes .chapter-ops-dialog .proposal-card .proposal-actions button { width: auto; }
.radix-themes .file-dialog-actions { max-height: clamp(160px, calc(100dvh - 300px), 520px); }

/* ── Focus mode / layout toggles ────────────────────────── */
/* 工作台网格：.dsh-frame 是 flex 列容器，PanelGroup 占满剩余高度。 */
.shell .shell-panel { height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--gray-2); }
.shell .shell-panel.editor-cell { background: var(--paper-fill); }
.shell .editor-cell { position: relative; background: var(--paper-fill); }
.shell .editor-cell > .center-overlays { position: absolute; inset: 0; z-index: 5; pointer-events: none; display: flex; flex-direction: column; }
/* 覆盖层外框（§4 修订）：只提供底色与边距；标题与关闭由插件自带，
   shell 不叠标题栏。 */
.shell .center-overlay-surface { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.shell .center-overlays [data-dsh-center-overlay] { flex: 1; min-width: 0; min-height: 0; overflow: auto; background: var(--color-panel-solid); pointer-events: auto; }
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .editor,
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .editor-stack,
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .empty-paper { display: none !important; }
.shell.layout-shell.focus-mode .center-overlays { display: none !important; }
.shell.layout-shell.focus-mode .paper-footer-status { opacity: .45; }
.shell.layout-shell.focus-mode .editor {
  --paper-pad-block: 56px;
  --paper-pad-inline: 64px;
  --paper-max-width: 880px;
}
.shell.layout-shell.focus-mode .editor-tools { justify-content: center; }

.shell.no-session { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.no-session > .chrome { grid-column: 1; grid-row: 1; }
.shell.no-session > .empty-paper { grid-column: 1; grid-row: 2; overflow: auto; padding: clamp(40px, 8vw, 112px) var(--space-5); background: var(--paper-fill); }
.home-stage-cluster {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  width: min(1180px, 100%);
}
.home-stage.has-mascot .home-card { flex: 0 1 720px; width: min(720px, 100%); }
.radix-themes .home-command-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  align-items: stretch;
}
.radix-themes .home-command-bar > * { display: flex; min-width: 0; }
.radix-themes .home-entry-card {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  text-align: start;
  transition: box-shadow 220ms ${EASE}, border-color 200ms ${EASE};
}
.radix-themes .home-entry-card:hover { box-shadow: var(--shadow-4); }
.radix-themes .app-mascot {
  display: block;
  height: auto;
  user-select: none;
  pointer-events: none;
}
/* The mascot is a brand mark beside the lobby's actual task, so it is sized
   as a companion rather than allowed to fill the stage on its own. */
.radix-themes .app-mascot-home {
  width: min(260px, 28vw);
  flex: none;
}
.radix-themes .home-recent .workspace-row .tree-row {
  justify-content: flex-start;
  width: 100%;
  text-align: start;
}
/* Row entrance translates overflow past the list edge; clip it inside the list
   so the transformed paint never inflates the ScrollArea viewport's scrollable
   area (ResizeObserver cannot see transforms, so the scrollbar state would
   latch from the transient overflow). */
.radix-themes .home-recent .workspace-list { overflow: clip; }
@media (max-width: 1180px) {
  .home-stage-cluster { flex-direction: column; align-items: center; }
  .radix-themes .app-mascot-home { width: min(180px, 40vw); }
}

/* ── Command palette (Cmd/Ctrl+K) ────────────────────────── */
.palette-overlay { position: fixed; z-index: 40; inset: 0; background: var(--gray-a6); }
.palette-overlay[data-state="open"] { animation: palette-overlay-in 150ms ${EASE}; }
.palette-overlay[data-state="closed"] { animation: palette-overlay-out 150ms ${EASE}; }
.palette-content { position: fixed; z-index: 41; top: 20vh; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); max-height: min(540px, 64dvh); display: flex; flex-direction: column; padding: 0; border: 1px solid var(--gray-a6); border-radius: var(--radius-5); background: var(--color-panel-solid); box-shadow: var(--shadow-5); overflow: hidden; }
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
.radix-themes .writing-settings,
.radix-themes .assistant-settings { display: flex; flex-direction: column; gap: var(--space-5); width: 100%; }
.radix-themes .writing-settings .paper-typography .slider-row { width: 100%; padding-block: var(--space-3); }
.radix-themes .writing-settings .slider-value { font-variant-numeric: tabular-nums; }

/* ── Settings dialog ────────────────────────────────────── */
.radix-themes .settings-dialog {
  width: min(960px, calc(100vw - 2 * var(--space-4)));
  max-width: 960px;
  /* 预留 Radix 外层滚动容器的边距，仅让导航和内容在窗口内滚动。
     One height across every page: short pages keep the slack inside. */
  height: min(760px, calc(100dvh - var(--space-6) - max(var(--space-6), 6vh)));
  font: 400 var(--font-size-2)/1.5 var(--default-font-family);
  color: var(--gray-12);
  --control-h: 34px;
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  padding: 0;
  overflow: hidden;
}
.radix-themes .settings-tabs { display: contents; }
.radix-themes .settings-nav {
  display: flex; flex-direction: column; min-height: 0; overflow: auto;
  padding: var(--space-5) var(--space-3);
  border-right: 1px solid var(--gray-a5);
  background: var(--gray-2);
}
.radix-themes .settings-nav [role="tablist"] {
  display: flex; flex-direction: column; width: 100%; gap: var(--space-1);
  box-shadow: none;
}
.radix-themes .settings-nav .settings-tab {
  justify-content: flex-start;
  width: 100%;
  color: var(--gray-11);
  min-height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-2);
  font-size: var(--font-size-2); font-weight: 400;
}
.radix-themes .settings-nav .settings-tab[data-state="active"],
.radix-themes .settings-nav .settings-tab.active {
  background: var(--accent-a3);
  color: var(--accent-12);
}
.radix-themes .settings-nav .settings-tab::before,
.radix-themes .settings-nav .settings-tab::after,
.radix-themes .settings-nav .settings-tab .rt-BaseTabListTriggerInner::before,
.radix-themes .settings-nav .settings-tab .rt-BaseTabListTriggerInner::after { display: none; }
.radix-themes .settings-nav .settings-tab .rt-BaseTabListTriggerInner { padding: 0; background: transparent; outline: none; }
.radix-themes .settings-nav .settings-tab:hover { color: var(--gray-12); }
.radix-themes .settings-nav h2,
.radix-themes .settings-header-title { margin: 0; font-size: var(--font-size-4); font-weight: 600; line-height: 1.4; }
.radix-themes .settings-nav h2 { padding-inline: var(--space-3); margin-bottom: var(--space-4); }
.radix-themes .settings-body { min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
.radix-themes .settings-header { flex: none; min-height: 64px; padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--gray-a5); }
.radix-themes .settings-page { min-width: 0; }
.radix-themes .settings-pages {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain; scrollbar-gutter: stable;
}
.radix-themes .settings-content { min-height: 0; overflow: visible; padding: var(--space-5); }
.radix-themes .settings-content[hidden] { display: none; }
.radix-themes .settings-content.is-active { position: relative; z-index: 1; display: block; }
.radix-themes .settings-content.is-active .settings-page { animation: shell-settings-page-in 200ms ${EASE}; }
@keyframes shell-settings-page-in { from { opacity: 0; transform: translateY(8px); } }
.radix-themes .settings-page > :is(.settings-general,.models-page,.usage-page) { display: grid; gap: var(--space-5); }
.radix-themes .settings-dialog .settings-block { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; overflow: visible; }
.radix-themes .settings-dialog .settings-block.rt-Card { --card-padding: 0px; --card-border-width: 0px; }
.radix-themes .settings-dialog .settings-block.rt-Card::before,
.radix-themes .settings-dialog .settings-block.rt-Card::after { display: none; }
.radix-themes .settings-block-head { margin-bottom: var(--space-3); }
.radix-themes .settings-block-title,
.radix-themes .settings-page h3 { margin: 0; font-size: var(--font-size-3); font-weight: 600; line-height: 1.5; }
.radix-themes .settings-dialog .settings-row { min-height: 56px; gap: var(--space-4); padding-block: var(--space-3); }
.radix-themes .settings-row-title { font-size: var(--font-size-2); font-weight: 400; }
.radix-themes .settings-row-text { flex: 1; }
.radix-themes .settings-row-description { font-size: var(--font-size-1); line-height: 1.5; }
.radix-themes .settings-dialog .settings-block + .settings-block { padding-top: var(--space-5); border-top: 1px solid var(--gray-a5); }
.radix-themes .settings-dialog .rt-BaseButton:not([role="switch"]) { font-size: var(--font-size-2); min-height: var(--control-h); }
.radix-themes .settings-dialog :is(input,textarea,select) { font-family: var(--default-font-family); font-size: var(--font-size-2); }
.radix-themes .settings-dialog .rt-TextFieldRoot { min-height: var(--control-h); }
.radix-themes .settings-dialog .rt-CalloutRoot { color: var(--accent-12); }
.radix-themes .settings-dialog :is(p,small,.muted) { line-height: 1.5; }
.radix-themes .settings-dialog :is(button,input,textarea,summary,a,[tabindex]):focus-visible { outline: 2px solid var(--accent-8); outline-offset: 2px; }
.radix-themes .settings-dialog :is(.models-hint,.models-warning,.about-note) { overflow-wrap: anywhere; }
.radix-themes .settings-dialog .author-preferences textarea { field-sizing: content; min-height: 156px; max-height: min(320px, 40dvh); line-height: 1.7; }
.radix-themes .settings-dialog .models-writing-route { display: grid; grid-template-columns: 112px minmax(0,1fr) 16px; }
.radix-themes .settings-dialog .models-writing-route-controls { justify-content: flex-end; }
.radix-themes .settings-dialog .models-writing-route-controls > .select { flex: 1; min-width: 0; }
.radix-themes .settings-dialog .models-writing-route-controls .select-trigger { width: 100%; }
.radix-themes .settings-dialog .models-writing-route .model-effort .select-trigger { min-width: 72px; }
.radix-themes .settings-dialog .models-field-row { grid-template-columns: 112px minmax(0,1fr); }
.radix-themes .settings-dialog .models-editor-actions { flex-wrap: wrap; }
.radix-themes .settings-dialog .models-row-card, .radix-themes .settings-dialog .models-add-card { padding: var(--space-4); }
.radix-themes .settings-dialog .usage-section-title { margin-bottom: var(--space-3); }
.radix-themes .settings-dialog .usage-card-value { font-size: var(--font-size-5); font-weight: 600; font-variant-numeric: tabular-nums; }
.radix-themes .settings-content.is-active:has(.about-page) { flex: 1; display: flex; }
.radix-themes .settings-content:has(.about-page) .settings-page { flex: 1; display: flex; }
.radix-themes .about-page { display: block; flex: 1; min-width: 0; }
.radix-themes .about-copy { min-width: 0; }
.radix-themes .about-status,.radix-themes .about-status .rt-CalloutRoot { width: fit-content; max-width: 100%; }
.radix-themes .app-mascot-about { width: 100px; max-width: 25%; height: auto; flex: none; object-fit: contain; pointer-events: none; }
.radix-themes .about-error { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
@media(max-width:1100px) {
  .radix-themes .settings-dialog { grid-template-columns: 148px minmax(0,1fr); }
  .radix-themes .settings-dialog .settings-row { flex-wrap: wrap; }
  .radix-themes .settings-dialog .models-writing-route { grid-template-columns: 96px minmax(0,1fr) 16px; }
}
@media(max-width:760px) {
  .radix-themes .settings-dialog { grid-template-columns: 116px minmax(0,1fr); }
  .radix-themes .settings-header,.radix-themes .settings-content { padding: var(--space-4); }
  .radix-themes .settings-dialog .settings-row { align-items: flex-start; flex-direction: column; gap: var(--space-2); }
  .radix-themes .settings-dialog .models-writing-route { display: flex; }
  .radix-themes .settings-dialog .models-writing-route-controls { width: 100%; }
  .radix-themes .settings-dialog .models-field-row { grid-template-columns: minmax(0,1fr); }
}

.radix-themes .settings-segmented {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 2px;
  border-radius: var(--radius-3);
  background: var(--gray-a3);
}
.radix-themes .settings-segmented > .rt-BaseButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 32px;
  min-height: 32px;
  margin: 0;
  padding: 0 var(--space-2);
  line-height: 1;
  --margin-top-override: 0px;
  --margin-right-override: 0px;
  --margin-bottom-override: 0px;
  --margin-left-override: 0px;
}
.radix-themes .select { position: relative; display: inline-block; min-width: 0; }
.radix-themes .settings-dialog .select-trigger[data-placeholder] .rt-SelectTriggerInner { color: var(--gray-11); }
.radix-themes .settings-dialog .select-trigger { min-width: 184px; max-width: 100%; min-height: var(--control-h); font-size: var(--font-size-2); }

.radix-themes .models-writing-route-controls > .select { flex: 0 1 18rem; min-width: 12rem; max-width: 100%; }
.radix-themes .models-writing-route .model-effort .select-trigger { width: auto; }
.shell .sidebar-tools { min-width: 0; }
@keyframes shell-panel-enter { from { opacity: 0; transform: translateY(6px); } }
.shell .sidebar-tools > [data-dsh-plugin-surface] > *:not(.memory-panel):not(.proofread-panel) { animation: shell-panel-enter 200ms ${EASE}; }
.radix-themes .models-rows { margin: 0; padding: 0; list-style: none; }
.radix-themes .models-add-card { border: 0; }
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

.radix-themes .about-release-body { white-space: pre-wrap; max-height: 220px; overflow: auto; margin-block: var(--space-2) var(--space-3); }
.radix-themes .preset-badge { display: inline-flex; align-items: center; margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: var(--accent-a3); color: var(--accent-11); font: 500 var(--font-size-1)/1.4 var(--default-font-family); }
.radix-themes .update-toast { position: fixed; right: var(--space-4); bottom: var(--space-4); z-index: 40; animation: shell-toast-in 260ms ${EASE}; }
@keyframes shell-toast-in { from { opacity: 0; transform: translateY(12px) scale(.98); } }

.radix-themes .usage-chart-plot { width: 100%; height: 200px; min-height: 160px; max-height: 220px; }
.usage-chart-tooltip { max-width: min(280px, calc(100vw - 32px)); white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.radix-themes .usage-chart-legend { margin: 0; padding: 0; list-style: none; }
.radix-themes .usage-chart-legend li { display: inline-flex; align-items: center; gap: var(--space-2); }
.radix-themes .usage-chart-chip { width: 10px; height: 10px; flex: none; border-radius: var(--radius-2); }
.radix-themes .usage-log-list { margin: 0; padding: 0; list-style: none; }
.radix-themes .usage-log-row {
  display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) auto; align-items: center; gap: var(--space-3);
  padding: var(--space-2) 0; border-bottom: 1px solid var(--gray-a4);
}
.radix-themes .usage-log-row:last-child { border-bottom: 0; }
.radix-themes .usage-log-time { font-variant-numeric: tabular-nums; white-space: nowrap; }
.radix-themes .usage-log-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.radix-themes .usage-log-tokens { font-variant-numeric: tabular-nums; white-space: nowrap; }

@media (max-width: 1040px) {
  .radix-themes .editor { --paper-pad-inline: 20px; }
}
@media (max-width: 760px) {
  .radix-themes .editor { --paper-pad-inline: 22px; --paper-pad-block: 28px; }
  /* 首页顶栏让位：快捷键提示让出宽度（工作台顶栏规则在 shell.styles.ts）。 */
  .shell > .chrome .palette-trigger-kbd { display: none; }
  .shell > .chrome .palette-trigger { padding-inline: var(--space-2); min-width: var(--control-h); }
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
  .radix-themes [role="dialog"], .radix-themes [role="dialog"] *, .radix-themes [role="dialog"] *::before, .radix-themes [role="dialog"] *::after,
  .radix-themes [role="alertdialog"], .radix-themes [role="alertdialog"] *, .radix-themes [role="alertdialog"] *::before, .radix-themes [role="alertdialog"] *::after,
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
