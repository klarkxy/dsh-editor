import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-input', `
.dsh-input {
  display: inline-flex; align-items: center; gap: var(--dsh-ui-space-2);
  min-height: var(--dsh-ui-control-md); padding: 0 var(--dsh-ui-space-3);
  background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-md); color: var(--dsh-ui-text); min-width: 0;
}
.dsh-input[data-size='sm'] { min-height: var(--dsh-ui-control-sm); }
.dsh-input:focus-within { box-shadow: var(--dsh-ui-elevation-focus); }
.dsh-input[data-invalid] { border-color: var(--dsh-ui-danger); }
.dsh-input__control {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  font: var(--dsh-ui-weight-regular) var(--dsh-ui-text-base)/var(--dsh-ui-leading-normal) var(--dsh-ui-font-ui);
  color: var(--dsh-ui-text); height: var(--dsh-ui-control-md); padding: 0;
}
.dsh-input[data-size='sm'] .dsh-input__control { height: var(--dsh-ui-control-sm); font-size: var(--dsh-ui-text-sm); }
.dsh-input__control::placeholder { color: var(--dsh-ui-faint); }
.dsh-input__control:disabled { color: var(--dsh-ui-muted); }
.dsh-input__adorn { display: inline-flex; flex: none; color: var(--dsh-ui-muted); }
`)
