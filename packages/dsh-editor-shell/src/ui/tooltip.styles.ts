import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-tooltip', `
.dsh-tooltip {
  z-index: var(--dsh-ui-z-tooltip); max-width: 260px;
  padding: var(--dsh-ui-space-1) var(--dsh-ui-space-2);
  background: var(--dsh-ui-menu-fill); color: var(--dsh-ui-text);
  border-radius: var(--dsh-ui-radius-sm); box-shadow: var(--dsh-ui-elevation-panel);
  font-size: var(--dsh-ui-text-xs); line-height: var(--dsh-ui-leading-normal);
}
`)
