import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-drawer', `
.dsh-drawer {
  position: fixed; top: 0; bottom: 0; z-index: var(--dsh-ui-z-dialog);
  /* 贴边窄窗（390px）下抽屉必须留出 16px 边距而不是顶满视口宽。 */
  width: min(var(--dsh-drawer-w, 360px), calc(100vw - 32px));
  display: flex; flex-direction: column;
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
/* body 是满高 flex 列：pane-slot 与收养进来的 .dsh-pane 才能把
   栏内容（含底部锚定的 composer）撑到抽屉底。横向溢出在内部滚动/
   换行里消化，不撑宽 document。 */
.dsh-drawer__body {
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; flex-direction: column;
  overflow-y: auto; overflow-x: hidden;
}
.dsh-drawer__body > .dsh-pane-slot { flex: 1 1 auto; min-height: 0; }
/* bare 模式：无标题条，关闭钮压在第一行（页签条，高约 37px）右端。 */
.dsh-drawer__close { position: absolute; top: calc((37px - var(--dsh-ui-control-sm)) / 2); right: var(--dsh-ui-space-2); z-index: 2; }
.dsh-drawer--bare .dsh-drawer__body { padding-top: 0; }
@media (forced-colors: active) {
  .dsh-drawer { border: 1px solid CanvasText; }
}
`)
