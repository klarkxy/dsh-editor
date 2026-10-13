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
.dsh-aux-rail__tabs { flex: none; border-bottom: 0.5px solid var(--dsh-ui-line); }
.dsh-aux-rail__tabs .dsh-tabs__list { padding-inline: var(--dsh-ui-space-2); }
.dsh-aux-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dsh-aux-panel[hidden] { display: none; }
.dsh-aux-panel .chat { flex: 1 1 auto; min-height: 0; }
.dsh-aux-panel__head {
  flex: none; display: flex; align-items: center; gap: var(--dsh-ui-space-2);
  min-height: var(--dsh-ui-header-height); padding-inline: var(--dsh-ui-space-3);
}
.dsh-aux-panel__empty {
  padding: var(--dsh-ui-space-4); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);
}
.dsh-aux-panel .official-resource-panel {
  position: static; inset: auto; width: auto; flex: 1 1 auto; min-height: 0; border-left: 0;
}

/* 启动按钮：稿纸右下角。 */
.dsh-launcher { position: absolute; right: var(--dsh-ui-space-4); bottom: var(--dsh-ui-space-4); z-index: var(--dsh-ui-z-sticky); }
.dsh-launcher-note { position: absolute; right: var(--dsh-ui-space-4); bottom: var(--dsh-ui-space-4); z-index: var(--dsh-ui-z-sticky); max-width: 22rem; }

/* 窄窗抽屉里的栏内容铺满。 */
.dsh-drawer__body .dsh-pane { height: 100%; }
.dsh-drawer .sidebar, .dsh-drawer .chat { height: 100%; min-height: 0; }

/* 窄窗（≤760px）：快捷键提示先让位；作品菜单截断但保留真实命中区。 */
@media (max-width: 760px) {
  .dsh-topbar .palette-trigger-kbd { display: none; }
  .dsh-topbar .palette-trigger { padding-inline: var(--dsh-ui-space-2); min-width: var(--dsh-ui-control-md); }
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
