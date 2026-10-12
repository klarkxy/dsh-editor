import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-kbd', `
.dsh-kbd {
  display: inline-flex; align-items: center; padding: 0 var(--dsh-ui-space-1); min-height: 18px;
  border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-xs);
  font: var(--dsh-ui-weight-regular) var(--dsh-ui-text-xs)/1 var(--dsh-ui-font-ui);
  color: var(--dsh-ui-muted); background: var(--dsh-ui-surface);
}
`)
