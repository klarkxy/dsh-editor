import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-notice', `
.dsh-notice {
  display: flex; align-items: flex-start; gap: var(--dsh-ui-space-2);
  padding: var(--dsh-ui-space-3); border-radius: var(--dsh-ui-radius-md);
  font-size: var(--dsh-ui-text-sm);
}
.dsh-notice[data-tone='info'] { background: var(--dsh-ui-accent-soft); color: var(--dsh-ui-text); }
.dsh-notice[data-tone='info'] .dsh-notice__icon { color: var(--dsh-ui-accent); }
.dsh-notice[data-tone='success'] { background: var(--dsh-ui-success-soft); color: var(--dsh-ui-text); }
.dsh-notice[data-tone='success'] .dsh-notice__icon { color: var(--dsh-ui-success); }
.dsh-notice[data-tone='warning'] { background: var(--dsh-ui-warning-soft); color: var(--dsh-ui-text); }
.dsh-notice[data-tone='warning'] .dsh-notice__icon { color: var(--dsh-ui-warning); }
.dsh-notice[data-tone='danger'] { background: var(--dsh-ui-danger-soft); color: var(--dsh-ui-text); }
.dsh-notice[data-tone='danger'] .dsh-notice__icon { color: var(--dsh-ui-danger); }
.dsh-notice__icon { display: inline-flex; flex: none; margin-top: 1px; }
.dsh-notice__body { display: grid; gap: 2px; min-width: 0; flex: 1; }
.dsh-notice__title { font-weight: var(--dsh-ui-weight-medium); }
.dsh-notice__action { flex: none; }
`)
