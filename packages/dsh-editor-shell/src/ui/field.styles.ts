import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-field', `
.dsh-field { display: grid; gap: var(--dsh-ui-space-1); min-width: 0; }
.dsh-field__label { font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-medium); }
.dsh-field__desc { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-field__error { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-danger); }
`)
