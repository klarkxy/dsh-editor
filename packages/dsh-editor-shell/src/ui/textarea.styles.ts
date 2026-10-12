import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-textarea', `
.dsh-textarea {
  display: block; width: 100%; min-width: 0; resize: none;
  padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3);
  background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-md); color: var(--dsh-ui-text); outline: 0;
  font: var(--dsh-ui-weight-regular) var(--dsh-ui-text-base)/var(--dsh-ui-leading-normal) var(--dsh-ui-font-ui);
}
.dsh-textarea:focus-visible { box-shadow: var(--dsh-ui-elevation-focus); outline: 0; }
.dsh-textarea::placeholder { color: var(--dsh-ui-faint); }
.dsh-textarea:disabled { color: var(--dsh-ui-muted); }
`)
