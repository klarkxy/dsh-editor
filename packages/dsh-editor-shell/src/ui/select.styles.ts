import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-select', `
.dsh-select {
  display: inline-flex; align-items: center; justify-content: space-between; gap: var(--dsh-ui-space-2);
  min-height: var(--dsh-ui-control-md); padding: 0 var(--dsh-ui-space-3); min-width: 0;
  background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-md); color: var(--dsh-ui-text); cursor: pointer;
  font: var(--dsh-ui-weight-regular) var(--dsh-ui-text-base)/1 var(--dsh-ui-font-ui);
}
.dsh-select[data-size='sm'] { min-height: var(--dsh-ui-control-sm); font-size: var(--dsh-ui-text-sm); }
.dsh-select[data-placeholder] { color: var(--dsh-ui-faint); }
.dsh-select:disabled { color: var(--dsh-ui-muted); cursor: default; }
.dsh-select__icon { display: inline-flex; flex: none; color: var(--dsh-ui-muted); }
`)
