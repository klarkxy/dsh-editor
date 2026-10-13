import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-menu', `
.dsh-menu {
  z-index: var(--dsh-ui-z-dropdown); min-width: 180px; max-width: 320px;
  padding: var(--dsh-ui-space-1);
  background: var(--dsh-ui-menu-fill); color: var(--dsh-ui-text);
  border-radius: var(--dsh-ui-radius-lg); box-shadow: var(--dsh-ui-elevation-panel);
  border: 0; backdrop-filter: none;
}
.dsh-menu__viewport { padding: 0; }
.dsh-menu__item {
  display: flex; align-items: center; gap: var(--dsh-ui-space-2);
  min-height: 32px; padding: 0 var(--dsh-ui-space-2); border-radius: var(--dsh-ui-radius-sm);
  font-size: var(--dsh-ui-text-sm); cursor: default; user-select: none; outline: 0;
}
.dsh-menu__item[data-highlighted] { background: var(--dsh-ui-selected); color: var(--dsh-ui-text); }
.dsh-menu__item[data-disabled] { color: var(--dsh-ui-muted); }
.dsh-menu__item[data-tone='danger'] { color: var(--dsh-ui-danger); }
.dsh-menu__item[data-tone='danger'][data-highlighted] { background: var(--dsh-ui-danger-soft); }
.dsh-menu__icon { display: inline-flex; flex: none; color: var(--dsh-ui-muted); }
.dsh-menu__item[data-tone='danger'] .dsh-menu__icon { color: var(--dsh-ui-danger); }
.dsh-menu__item-body { flex: 1; min-width: 0; }
.dsh-menu__item-desc { display: block; font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-menu__check { display: inline-flex; flex: none; width: var(--dsh-ui-icon-md); }
.dsh-menu__shortcut { flex: none; margin-left: auto; }
.dsh-menu__sub-arrow { flex: none; margin-left: auto; display: inline-flex; color: var(--dsh-ui-muted); }
.dsh-menu__separator { height: 0.5px; margin: var(--dsh-ui-space-1) var(--dsh-ui-space-2); background: var(--dsh-ui-line); }
.dsh-menu__label { padding: var(--dsh-ui-space-1) var(--dsh-ui-space-2); font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
@media (forced-colors: active) {
  .dsh-menu { border: 1px solid CanvasText; }
  .dsh-menu__item[data-highlighted] { outline: 1px solid Highlight; }
}
`)
