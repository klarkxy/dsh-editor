import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-radio', `
.dsh-radio-group { display: grid; }
.dsh-radio-row {
  display: flex; align-items: center; gap: var(--dsh-ui-space-3);
  min-height: 40px; padding: var(--dsh-ui-space-1) 0; cursor: pointer; min-width: 0;
}
.dsh-radio-row[data-disabled] { cursor: default; }
.dsh-radio-row__text { display: grid; gap: 2px; min-width: 0; }
.dsh-radio-row__label { font-size: var(--dsh-ui-text-base); }
.dsh-radio-row__desc { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-radio {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 18px; height: 18px; padding: 0; cursor: pointer;
  border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-full);
  background: var(--dsh-ui-raised);
}
.dsh-radio[data-state='checked'] { border-color: var(--dsh-ui-brand); }
.dsh-radio:disabled { opacity: 0.5; cursor: default; }
.dsh-radio__indicator { display: block; width: 8px; height: 8px; border-radius: var(--dsh-ui-radius-full); background: var(--dsh-ui-brand); }
@media (forced-colors: active) {
  .dsh-radio[data-state='checked'] { border-color: Highlight; }
  .dsh-radio__indicator { background: Highlight; }
}
`)
