import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-badge', `
.dsh-badge {
  display: inline-flex; align-items: center; gap: var(--dsh-ui-space-1);
  padding: 0 var(--dsh-ui-space-2); min-height: 20px; border-radius: var(--dsh-ui-radius-full);
  font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-xs)/1 var(--dsh-ui-font-ui);
  background: var(--dsh-ui-hover); color: var(--dsh-ui-muted);
}
.dsh-badge[data-tone='accent'] { background: var(--dsh-ui-accent-soft); color: var(--dsh-ui-accent); }
.dsh-badge[data-tone='success'] { background: var(--dsh-ui-success-soft); color: var(--dsh-ui-success); }
.dsh-badge[data-tone='warning'] { background: var(--dsh-ui-warning-soft); color: var(--dsh-ui-warning); }
.dsh-badge[data-tone='danger'] { background: var(--dsh-ui-danger-soft); color: var(--dsh-ui-danger); }
`)
