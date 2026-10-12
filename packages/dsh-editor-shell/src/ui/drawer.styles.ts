import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-drawer', `
.dsh-drawer {
  position: fixed; top: 0; bottom: 0; z-index: var(--dsh-ui-z-dialog);
  width: min(360px, 88vw); display: flex; flex-direction: column;
  background: var(--dsh-ui-raised); color: var(--dsh-ui-text);
  box-shadow: var(--dsh-ui-elevation-prominent); border: 0;
}
.dsh-drawer[data-side='right'] { right: 0; border-radius: var(--dsh-ui-radius-lg) 0 0 var(--dsh-ui-radius-lg); }
.dsh-drawer[data-side='left'] { left: 0; border-radius: 0 var(--dsh-ui-radius-lg) var(--dsh-ui-radius-lg) 0; }
.dsh-drawer__header {
  display: flex; align-items: center; justify-content: space-between; gap: var(--dsh-ui-space-2);
  padding: var(--dsh-ui-space-3) var(--dsh-ui-space-3);
  border-bottom: 0.5px solid var(--dsh-ui-line);
}
.dsh-drawer__title { margin: 0; font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-base)/1 var(--dsh-ui-font-ui); }
.dsh-drawer__body { flex: 1; overflow: auto; min-height: 0; }
@media (forced-colors: active) {
  .dsh-drawer { border: 1px solid CanvasText; }
}
`)
