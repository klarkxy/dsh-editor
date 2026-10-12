import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-popover', `
.dsh-popover {
  z-index: var(--dsh-ui-z-dropdown); min-width: 180px; max-width: 320px;
  padding: var(--dsh-ui-space-3);
  background: var(--dsh-ui-menu-fill); color: var(--dsh-ui-text);
  border-radius: var(--dsh-ui-radius-lg); box-shadow: var(--dsh-ui-elevation-panel);
  border: 0;
}
`)
