import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-confirm', `
.dsh-confirm { padding: var(--dsh-ui-space-4); display: flex; flex-direction: column; gap: var(--dsh-ui-space-3); }
.dsh-confirm .dsh-dialog__title { padding: 0; }
.dsh-confirm__message { padding: 0; }
.dsh-confirm .dsh-dialog__footer { padding: 0; }
`)
