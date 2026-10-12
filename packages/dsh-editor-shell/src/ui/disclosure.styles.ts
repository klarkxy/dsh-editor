import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-disclosure', `
.dsh-disclosure { min-width: 0; }
.dsh-disclosure__summary {
  display: flex; align-items: center; gap: var(--dsh-ui-space-1); width: 100%;
  min-height: 32px; padding: 0; border: 0; background: transparent; cursor: pointer;
  color: var(--dsh-ui-text); text-align: start;
  font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-sm)/1 var(--dsh-ui-font-ui);
}
.dsh-disclosure__chevron { display: inline-flex; flex: none; color: var(--dsh-ui-muted); transition: transform var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out); }
.dsh-disclosure__summary[data-state='open'] .dsh-disclosure__chevron { transform: rotate(90deg); }
.dsh-disclosure__content { min-width: 0; }
@media (prefers-reduced-motion: reduce) {
  .dsh-disclosure__chevron { transition: none; }
}
`)
