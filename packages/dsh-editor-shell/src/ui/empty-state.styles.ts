import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-empty-state', `
.dsh-empty-state {
  display: grid; gap: var(--dsh-ui-space-2); justify-items: center;
  padding: var(--dsh-ui-space-8) var(--dsh-ui-space-4); text-align: center;
}
.dsh-empty-state__title { font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-md)/var(--dsh-ui-leading-normal) var(--dsh-ui-font-ui); }
.dsh-empty-state__body { color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); max-width: 40ch; }
.dsh-empty-state__actions { display: flex; gap: var(--dsh-ui-space-2); margin-top: var(--dsh-ui-space-2); }
`)
