import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-checkbox', `
.dsh-checkbox-row {
  display: flex; align-items: center; gap: var(--dsh-ui-space-3);
  min-height: 40px; padding: var(--dsh-ui-space-1) 0; cursor: pointer; min-width: 0;
}
.dsh-checkbox-row[data-disabled] { cursor: default; }
.dsh-checkbox-row__text { display: grid; gap: 2px; min-width: 0; }
.dsh-checkbox-row__label { font-size: var(--dsh-ui-text-base); }
.dsh-checkbox-row__desc { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-checkbox {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 18px; height: 18px; padding: 0; cursor: pointer;
  border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-xs);
  background: var(--dsh-ui-raised); color: var(--dsh-ui-on-brand);
}
.dsh-checkbox[data-state='checked'], .dsh-checkbox[data-state='indeterminate'] {
  background: var(--dsh-ui-brand); border-color: var(--dsh-ui-brand);
}
.dsh-checkbox:disabled { opacity: 0.5; cursor: default; }
.dsh-checkbox__indicator { display: inline-flex; }
@media (forced-colors: active) {
  .dsh-checkbox[data-state='checked'], .dsh-checkbox[data-state='indeterminate'] { background: Highlight; }
}
`)
