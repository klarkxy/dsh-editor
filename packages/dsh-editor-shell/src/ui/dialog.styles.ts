import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-dialog', `
.dsh-overlay {
  position: fixed; inset: 0; z-index: var(--dsh-ui-z-dialog);
  background: var(--dsh-ui-scrim); backdrop-filter: none;
}
.dsh-dialog {
  position: fixed; z-index: var(--dsh-ui-z-dialog);
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 64px);
  display: flex; flex-direction: column;
  background: var(--dsh-ui-raised); color: var(--dsh-ui-text);
  border-radius: var(--dsh-ui-radius-panel); box-shadow: var(--dsh-ui-elevation-prominent);
  border: 0;
}
.dsh-dialog[data-size='sm'] { width: min(420px, calc(100vw - 32px)); }
.dsh-dialog[data-size='lg'] { width: min(720px, calc(100vw - 32px)); }
.dsh-dialog__header {
  display: flex; align-items: center; justify-content: space-between; gap: var(--dsh-ui-space-3);
  padding: var(--dsh-ui-space-4) var(--dsh-ui-space-4) 0;
}
.dsh-dialog__title { margin: 0; font: var(--dsh-ui-weight-strong) var(--dsh-ui-text-lg)/var(--dsh-ui-leading-tight) var(--dsh-ui-font-ui); }
.dsh-dialog__desc { margin: 0; padding: var(--dsh-ui-space-1) var(--dsh-ui-space-4) 0; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); }
.dsh-dialog__body { padding: var(--dsh-ui-space-4); overflow: auto; min-height: 0; }
.dsh-dialog__footer {
  display: flex; justify-content: flex-end; gap: var(--dsh-ui-space-2);
  padding: 0 var(--dsh-ui-space-4) var(--dsh-ui-space-4);
}
@media (forced-colors: active) {
  .dsh-dialog { border: 1px solid CanvasText; }
}
`)
