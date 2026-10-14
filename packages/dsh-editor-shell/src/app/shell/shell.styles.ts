import { defineStyles } from '../../design-system/layers.ts'

/*
 * 工作台外框样式（shell-rewrite-spec §2）：顶栏 44px、三列网格、页签、
 * 抽屉、专注模式与输入淡化的结构/外观规则都在 dsh.surfaces 层，
 * 颜色一律走 --dsh-ui-* token。
 */
defineStyles('dsh.surfaces', 'dsh-shell', `
/* 工作台外框用 flex 列；首页/检查态的 .no-session 维持旧 grid。 */
.shell.layout-shell {
  display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;
}
.dsh-topbar {
  -webkit-app-region: drag;
  display: flex; align-items: center; gap: var(--dsh-ui-space-2);
  height: 44px; flex: none; padding-inline: var(--dsh-ui-space-2);
  background: var(--dsh-ui-chrome); color: var(--dsh-ui-text);
  user-select: none;
}
.dsh-topbar > *:not(.dsh-topbar__drag) { -webkit-app-region: no-drag; }
.dsh-topbar__drag { flex: 1 1 auto; min-width: 0; align-self: stretch; -webkit-app-region: drag; }
.dsh-topbar__group { display: flex; align-items: center; gap: var(--dsh-ui-space-1); min-width: 0; }
.dsh-topbar__group--left { flex: 0 0 auto; }
.dsh-topbar__group--right { flex: 0 0 auto; }

.workspace-menu-trigger {
  display: inline-flex; align-items: center; gap: var(--dsh-ui-space-1);
  height: var(--dsh-ui-control-sm); padding-inline: var(--dsh-ui-space-2);
  border: 0; border-radius: var(--dsh-ui-radius-md); background: transparent;
  color: var(--dsh-ui-text); font: inherit; font-weight: var(--dsh-ui-weight-medium);
  max-width: 24rem; cursor: pointer;
}
.workspace-menu-trigger:hover { background: var(--dsh-ui-hover); }
.workspace-menu-trigger .workspace-name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.dsh-breadcrumb {
  display: flex; align-items: center; gap: var(--dsh-ui-space-1);
  min-width: 0; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);
}
.dsh-breadcrumb__seg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.dsh-breadcrumb__sep { color: var(--dsh-ui-faint); }
.dsh-breadcrumb__current {
  display: inline-flex; align-items: center; gap: var(--dsh-ui-space-1);
  min-height: var(--dsh-ui-control-sm); padding-inline: var(--dsh-ui-space-2);
  border: 0; border-radius: var(--dsh-ui-radius-md); background: transparent;
  color: var(--dsh-ui-text); font: inherit; font-size: var(--dsh-ui-text-sm);
  font-weight: var(--dsh-ui-weight-medium); cursor: pointer;
  max-width: 18rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.dsh-breadcrumb__current:hover { background: var(--dsh-ui-hover); }

.dsh-frame { position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; }
.dsh-workbench-grid { flex: 1 1 auto; min-width: 0; min-height: 0; }
.dsh-workbench-grid [data-panel] { min-width: 0; min-height: 0; }
.dsh-workbench-grid [data-panel] > div { height: 100%; min-width: 0; }

.dsh-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.dsh-pane-slot { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.dsh-pane--files { background: var(--dsh-ui-sidebar); }
.dsh-pane--aux { background: var(--dsh-ui-sidebar); }
.dsh-pane > .sidebar, .dsh-pane > .chat, .dsh-pane > .dsh-aux-rail { flex: 1 1 auto; height: 100%; min-height: 0; }
.dsh-pane .pinned-pane { flex: 1 1 auto; height: 100%; min-height: 0; }
.dsh-reference { display: flex; flex-direction: column; height: 100%; min-height: 0; }
/* rightbar 会话表面常驻挂载：display:flex 需要显式 [hidden] 兜底才会真正隐藏。 */
.dsh-reference__preview { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dsh-reference__preview[hidden] { display: none; }

/* 输入淡化：两侧栏与抽屉随 data-typing 淡出。 */
.dsh-root .dsh-pane, .dsh-root .dsh-topbar {
  transition: opacity var(--dsh-ui-duration-base) var(--dsh-ui-ease-out);
}
.dsh-root[data-typing] .dsh-pane--files,
.dsh-root[data-typing] .dsh-pane--aux,
.dsh-root[data-typing] .dsh-topbar {
  opacity: var(--dsh-ui-dim-opacity);
}

/* 辅助栏页签头 */
.dsh-aux-rail { display: flex; flex-direction: column; height: 100%; min-height: 0; }
/* §5：chrome 底；抽屉里（bare）页签条兼任抽屉顶行，右端给关闭钮留位。 */
.dsh-aux-rail__tabs {
  flex: none; border-bottom: 0.5px solid var(--dsh-ui-line);
  background: var(--dsh-ui-chrome);
  padding-inline: var(--dsh-ui-space-2);
}
.dsh-drawer--bare .dsh-aux-rail__tabs {
  padding-right: calc(var(--dsh-ui-control-sm) + var(--dsh-ui-space-3));
}
.dsh-aux-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dsh-aux-panel .chat { flex: 1 1 auto; min-height: 0; }
.dsh-aux-panel__head {
  flex: none; display: flex; align-items: center; gap: var(--dsh-ui-space-2);
  min-height: var(--dsh-ui-header-height); padding-inline: var(--dsh-ui-space-3);
}
.dsh-aux-panel__empty {
  padding: var(--dsh-ui-space-4); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);
}
/* 官方 rightbar 槽位宿主（§4）。插件面板自带 position:absolute +
   top/bottom/right:0 与 pointer-events:none，宽度吃 slot props 的 width。
   插件样式不进层（永远压过分层规则），所以这里只给宿主定位上下文
   与 clip，不改面板自身定位：push 模式填满槽位（width 由宿主按实际
   栏宽喂给它），溢出部分裁掉。槽位本身带 data-dsh-plugin-surface，
   这些规则必须是原始选择器，不能走 uiRule 的插件排除。 */
.dsh-aux-rightbar-slot {
  position: relative; overflow: hidden;
  flex: 1 1 auto; min-height: 0; background: var(--dsh-ui-bg);
}
/* 作者在面板里请求全屏（fullscreen 模式）时，槽位提升为固定覆盖层，
   盖住顶栏以下整个工作台；退出全屏/收起控件是插件自己的。
   面板 width:100vw 锚定槽位右缘，正好铺满覆盖层。 */
.dsh-aux-rightbar-slot:has([data-sidebar-right-panel="fullscreen"]) {
  position: fixed; inset: 44px 0 0 0; z-index: var(--dsh-ui-z-rail-overlay); overflow: visible;
}

/* 启动按钮：稿纸右下角。 */
/* bottom 让开稿纸页脚：--paper-footer-h 由 editor.tsx 量出（无文档时为 0）。 */
.dsh-launcher { position: absolute; right: var(--dsh-ui-space-4); bottom: calc(var(--paper-footer-h, 0px) + var(--dsh-ui-space-3)); z-index: var(--dsh-ui-z-sticky); }
.dsh-launcher-note { position: absolute; right: var(--dsh-ui-space-4); bottom: calc(var(--paper-footer-h, 0px) + var(--dsh-ui-space-3)); z-index: var(--dsh-ui-z-sticky); max-width: 22rem; }

/* 窄窗抽屉里的栏内容铺满。 */
.dsh-drawer__body .dsh-pane { height: 100%; }
.dsh-drawer .sidebar, .dsh-drawer .chat { height: 100%; min-height: 0; }

/* 窄窗（≤760px）：快捷键提示先让位；作品菜单截断但保留真实命中区。 */
@media (max-width: 760px) {
  .dsh-topbar .palette-trigger-kbd { display: none; }
  .dsh-topbar .palette-trigger { padding-inline: var(--dsh-ui-space-2); min-width: var(--dsh-ui-control-sm); }
  .dsh-topbar .dsh-icon-button { width: var(--dsh-ui-control-sm); height: var(--dsh-ui-control-sm); }
  .dsh-topbar__group { gap: 0; }
  .dsh-topbar .workspace-menu-trigger { max-width: min(12rem, 30vw); }
  .dsh-topbar .workspace-menu-trigger .workspace-name { min-width: min(7em, 22vw); }
  .dsh-breadcrumb { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-root .dsh-pane, .dsh-root .dsh-topbar { transition: none; }
}
@media (forced-colors: active) {
  .dsh-topbar { border-bottom: 1px solid CanvasText; }
}
`)

/*
 * 插件边界例外（design-system-spec §4）：宿主唯一允许不进层的规则。
 * 官方 rightbar 面板根是 pointer-events:none 的命中穿透层；官方框架
 * 靠 .overlayLayer>* 恢复子树命中，这里等价恢复。插件 CSS 是未分层
 * normal 声明，分层规则永远压不过它，所以这条规则必须同样未分层、
 * 且用 (0,2,0) 的类+属性选择器压过插件的 (0,1,0) 类选择器，不用
 * !important。折叠时插件自己把子树 visibility:hidden，不拦截点击。
 * 注入时追加在 collectStyles() 结果之后（root.tsx injectShellStyles）。
 */
export const pluginBoundaryStyles = `
.dsh-aux-rightbar-slot [data-sidebar-right-panel] { pointer-events: auto; }
`
