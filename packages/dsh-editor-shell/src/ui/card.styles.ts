import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-card', `
.dsh-card {
  background: var(--dsh-ui-raised);
  border: 0.5px solid var(--dsh-ui-line);
  border-radius: var(--dsh-ui-radius-md);
  padding: var(--dsh-ui-space-4);
  box-shadow: none;
}
.dsh-card[data-size='1'] { padding: var(--dsh-ui-space-3); }
.dsh-card[data-size='2'] { padding: var(--dsh-ui-space-4); }
.dsh-card[data-size='3'] { padding: var(--dsh-ui-space-6); }
`)
