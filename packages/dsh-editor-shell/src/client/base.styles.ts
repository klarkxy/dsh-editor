import { defineStyles } from '../design-system/layers.ts'
import { SCOPE } from '../design-system/tokens.ts'
import { uiRule } from '../design-system/styles.ts'

/* 结构 50%/100%/999px 的圆/胶囊在 @supports 超椭圆块里恢复 round。 */
const ROUND_SHAPES = [
  '.composer-actions .send', '.composer-actions .chat-stop',
  'button.send', 'button.chat-stop',
  '.shell ::-webkit-scrollbar-thumb',
  '.models-credential-dot',
  '.activity-dots i', '.panel-activity-dots i',
  '.activity-shimmer', '.activity-shimmer i',
  '.history-commit-dot',
  '.image-preview-close',
  '.chat-step-status', '.chat-step-error-dot',
  /* ui 基元的圆/胶囊：:where(*) 超椭圆是作用域规则（(0,2,1)），裸类选择器压不过
     它，所有 radius-full 元素必须经本名单取回 round。 */
  '.dsh-badge',
  '.dsh-radio', '.dsh-radio__indicator',
  '.dsh-search-field__clear',
  '.dsh-slider__track', '.dsh-slider__thumb',
  '.dsh-spinner', '.dsh-activity-dots i',
  '.dsh-switch', '.dsh-switch__thumb',
  '.dsh-tabs__tab[data-state="active"]::after',
  '.dsh-files-rail .tree-row[aria-current="page"] .tree-marker:empty::before',
]

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/*
 * shell 全局基座：元素重置、主题根度量、外壳网格、滚动条、焦点环、原生窗口
 * 拖拽区、扩展停靠条与全局状态（hidden/降级动画）。`.radix-themes` 是
 * ShellTheme 输出的主题作用域类（design-system-spec §4），不是依赖残留。
 * 颜色一律走 --dsh-ui-* token；仍服务遗留 className 钩子的规则（.icon-button、
 * .danger-action、.primary-action）是 HOST_UI 面板的兼容钩子。
 */

defineStyles('dsh.reset', 'dsh-base-reset', `
.shell, .shell *, .shell *::before, .shell *::after { box-sizing: border-box; }
.shell :is(button, input, select, textarea):not(:where([data-dsh-plugin-surface] *)) { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; }
.shell button:not(:where([data-dsh-plugin-surface] *)) { cursor: pointer; transition: background-color 150ms ${EASE}, color 150ms ${EASE}, border-color 150ms ${EASE}, box-shadow 150ms ${EASE}; }
.shell textarea:not(:where([data-dsh-plugin-surface] *)) { resize: none; outline: none; }
.shell :focus:not(:where([data-dsh-plugin-surface] *)) { outline: none; }
.shell :focus-visible:not(:where([data-dsh-plugin-surface] *)) { outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; }
.shell button:not(:where([data-dsh-plugin-surface] *)):disabled { cursor: not-allowed; opacity: .55; }
.shell ::-webkit-scrollbar { width: 8px; height: 8px; }
.shell ::-webkit-scrollbar-track { background: transparent; }
.shell ::-webkit-scrollbar-thumb { background: var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-sm); }
.shell ::-webkit-scrollbar-thumb:hover { background: var(--dsh-ui-faint); }
.radix-themes .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
.radix-themes .muted { color: var(--dsh-ui-muted); }
.radix-themes .warning { color: var(--dsh-ui-danger); }
`)

defineStyles('dsh.components', 'dsh-base-shared', `
/* 主题根度量：旧 themeStyles 的 52px/34px 早被适配层覆盖为 token 值，这里
   直接落最终值；.dsh-settings-page 仍自带 --control-h: 34px 的局部覆盖。 */
.radix-themes.shell-theme {
  --topbar-h: var(--dsh-ui-header-height);
  --control-h: var(--dsh-ui-control-md);
}
.shell-theme { height: 100dvh; min-height: 0; }

.radix-themes .icon-button { display: grid; place-items: center; min-width: 32px; min-height: 32px; padding: 3px; border: 0; border-radius: var(--dsh-ui-radius-md); background: transparent; cursor: pointer; color: var(--dsh-ui-muted); transition: transform 120ms ${EASE}, background-color 150ms ${EASE}, color 150ms ${EASE}; }
.radix-themes .icon-button:hover { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); }
/* .danger-action / .primary-action 类名钩子仍由 HOST_UI Button 输出（controls.tsx），
   外观由 .dsh-button[data-variant] 承担，不再需要旧的红字/填充覆盖；
   .icon-button:active 的缩放已被旧适配层归零，不再保留。 */
${uiRule(['a:not(.dsh-button)'], 'color: var(--dsh-ui-link);')}
${uiRule(['.dsh-button:focus-visible', '.dsh-icon-button:focus-visible', '.icon-button:focus-visible', '.tree-row:focus-visible', '.search-hit:focus-visible'], 'outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; box-shadow: 0 0 0 4px var(--dsh-ui-accent-soft);')}

/* 支持引擎里的超椭圆；圆与胶囊保持 round，插件面不受影响。 */
@supports (corner-shape: superellipse(1.5)) {
${uiRule([':where(*)', ':where(*)::before', ':where(*)::after'], 'corner-shape: superellipse(1.5);')}${uiRule(ROUND_SHAPES, 'corner-shape: round;')}
}
`)

defineStyles('dsh.surfaces', 'dsh-shell-frame', `
.shell {
  width: 100%;
  height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--topbar-h) minmax(0, 1fr);
  background: var(--dsh-ui-bg);
  color: var(--dsh-ui-text);
  font: 400 var(--dsh-ui-text-base)/1.45 var(--dsh-ui-font-ui);
  overflow: hidden;
}

.workspace-menu-panel { min-width: max(18rem, var(--radix-dropdown-menu-trigger-width, 16rem)); }
.shell .window-controls {
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  align-self: center;
  height: var(--control-h);
}
.shell .window-controls button:hover { background: var(--dsh-ui-hover); }
.shell .window-controls button.window-close:hover { background: var(--dsh-ui-danger); color: var(--dsh-ui-on-accent); }
.shell-extensions-dock {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--dsh-ui-space-2);
  min-width: 0;
  position: fixed;
  top: 0;
  right: var(--dsh-ui-space-4);
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
.shell .panel-resizer:focus-visible::before { background: var(--dsh-ui-line-strong); }
.shell .panel-resizer[data-separator="active"]::before { background: var(--dsh-ui-accent); }

/* ── 工作台网格与覆盖层 ──────────────────────────────────── */
.shell .shell-panel { height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsh-ui-bg); }
.shell .shell-panel.editor-cell { background: var(--paper-fill); }
.shell .editor-cell { position: relative; background: var(--paper-fill); }
.shell .editor-cell > .center-overlays { position: absolute; inset: 0; z-index: 5; pointer-events: none; display: flex; flex-direction: column; }
/* 覆盖层外框（§4 修订）：只提供底色与边距；标题与关闭由插件自带，
   shell 不叠标题栏。 */
.shell .center-overlay-surface { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.shell .center-overlays [data-dsh-center-overlay] { flex: 1; min-width: 0; min-height: 0; overflow: auto; background: var(--dsh-ui-raised); pointer-events: auto; }

.shell.no-session { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--topbar-h) minmax(0, 1fr); }
.shell.no-session > .chrome { grid-column: 1; grid-row: 1; }
.shell.no-session > .empty-paper { grid-column: 1; grid-row: 2; overflow: auto; padding: clamp(40px, 8vw, 112px) var(--dsh-ui-space-5); background: var(--paper-fill); }
.radix-themes .workspace-checking { grid-column: 1 / -1; grid-row: 1 / -1; }

/* 空稿纸阶段卡片与提示（components.tsx PaperStage / .home-hint）。 */
.radix-themes .home-card {
  background: var(--dsh-ui-raised);
  border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-xl);
  box-shadow: none; transition: all var(--dsh-ui-duration-base) ${EASE};
}
.radix-themes .home-card:hover { background: var(--dsh-ui-raised); box-shadow: var(--dsh-ui-elevation-prominent); transform: translateY(-2px); }
.radix-themes .home-hint { color: var(--dsh-ui-muted); }

/* 更新提示 toast：Notice 承载语义，角落浮层自带 panel 投影。 */
.radix-themes .update-toast { position: fixed; right: var(--dsh-ui-space-4); bottom: var(--dsh-ui-space-4); z-index: var(--dsh-ui-z-toast, 70); animation: shell-toast-in 260ms ${EASE}; }
@keyframes shell-toast-in { from { opacity: 0; transform: translateY(12px) scale(.98); } }

@keyframes shell-fade-in { from { opacity: 0; } }
@keyframes shell-message-in { from { opacity: 0; transform: translateY(var(--dsh-ui-space-3)); } }
@keyframes shell-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes shell-activity-typing { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes shell-activity-shimmer { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
@keyframes shell-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
@keyframes shell-success-draw { from { stroke-dashoffset: 42; } }
@keyframes shell-panel-enter { from { opacity: 0; transform: translateY(6px); } }
@keyframes ghost-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -80% 0; } }
`)

/* 状态层：需要压过 surfaces/components 普通声明的隐藏、降级与系统偏好规则。
   层序（dsh.state 最后）代替 !important（design-system-spec §5）。 */
defineStyles('dsh.state', 'dsh-shell-state', `
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .editor,
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .editor-stack,
.shell .editor-cell:has(> .center-overlays [data-dsh-center-overlay]) > .empty-paper { display: none; }
.shell.layout-shell.focus-mode .center-overlays { display: none; }
.shell.layout-shell.focus-mode .paper-footer-status { opacity: .45; }
.shell.layout-shell.focus-mode .editor {
  --paper-pad-block: 56px;
  --paper-pad-inline: 64px;
  --paper-max-width: 880px;
}
.shell.layout-shell.focus-mode .editor-tools { justify-content: center; }

@media (prefers-reduced-motion: reduce) {
  .shell *, .shell *::before, .shell *::after,
  .palette-overlay, .palette-overlay::before, .palette-overlay::after,
  .palette-content, .palette-content *, .palette-content *::before, .palette-content *::after,
  .select-list, .select-list *, .select-list *::before, .select-list *::after,
  .radix-themes [role="dialog"], .radix-themes [role="dialog"] *, .radix-themes [role="dialog"] *::before, .radix-themes [role="dialog"] *::after,
  .radix-themes [role="alertdialog"], .radix-themes [role="alertdialog"] *, .radix-themes [role="alertdialog"] *::before, .radix-themes [role="alertdialog"] *::after,
  [data-radix-popper-content-wrapper], [data-radix-popper-content-wrapper] * {
    scroll-behavior: auto;
    transition: none;
    animation: none;
    filter: none;
  }
  .shell *:hover, .shell *:active { transform: none; }
  .radix-themes .ghost.is-loading { animation: none; color: var(--dsh-ui-faint); background: none; }
  .radix-themes .panel-activity-dots i,
  .radix-themes .panel-skeleton i::after { animation: none; }
}
@media (prefers-reduced-motion: reduce) {
  ${SCOPE} *, ${SCOPE} *::before, ${SCOPE} *::after { animation: none; animation-duration: 0s; transition: none; transition-duration: 0s; scroll-behavior: auto; }
}
@media (forced-colors: active) {
  ${SCOPE} :is(button:focus-visible, [tabindex]:focus-visible) { outline: 2px solid Highlight; }
  ${SCOPE} :is(.tree-row[aria-current="page"], .settings-tab[data-state="active"]) { outline: 1px solid Highlight; outline-offset: -1px; }
  ${SCOPE} :is(.composer, .proposal-card, .dsh-dialog) { border: 1px solid CanvasText; }
}
`)
