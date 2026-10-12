import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-segmented', `
.dsh-segmented {
  display: inline-flex; align-items: stretch; height: var(--dsh-ui-control-sm);
  background: var(--dsh-ui-surface); border: 0.5px solid var(--dsh-ui-line);
  border-radius: var(--dsh-ui-radius-md); padding: 2px; gap: 2px;
}
.dsh-segmented__item {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--dsh-ui-space-1);
  padding: 0 var(--dsh-ui-space-3); border: 0; border-radius: var(--dsh-ui-radius-sm);
  background: transparent; color: var(--dsh-ui-muted); cursor: pointer; white-space: nowrap;
  font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-sm)/1 var(--dsh-ui-font-ui);
}
.dsh-segmented__item:hover:not(:disabled):not([data-state='on']) { color: var(--dsh-ui-text); }
.dsh-segmented__item[data-state='on'] { background: var(--dsh-ui-raised); color: var(--dsh-ui-text); box-shadow: var(--dsh-ui-elevation-soft); }
.dsh-segmented__item:disabled { opacity: 0.5; cursor: default; }
.dsh-segmented__icon { display: inline-flex; }
@media (forced-colors: active) {
  .dsh-segmented__item[data-state='on'] { outline: 1px solid Highlight; }
}
`)
