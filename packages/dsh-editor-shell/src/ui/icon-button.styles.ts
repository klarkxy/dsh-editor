import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-icon-button', `
.dsh-icon-button {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: var(--dsh-ui-control-md); height: var(--dsh-ui-control-md);
  border: 0; border-radius: var(--dsh-ui-radius-md); cursor: pointer;
  background: transparent; color: var(--dsh-ui-text);
  transition: background var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out), color var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out);
}
.dsh-icon-button[data-size='sm'] { width: var(--dsh-ui-control-sm); height: var(--dsh-ui-control-sm); border-radius: var(--dsh-ui-radius-sm); }
.dsh-icon-button[data-variant='secondary'] { background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong); }
.dsh-icon-button[data-variant='primary'] { background: var(--dsh-ui-brand); color: var(--dsh-ui-on-brand); }
.dsh-icon-button[data-variant='primary']:hover:not(:disabled) { background: var(--dsh-ui-brand-hover); }
.dsh-icon-button[data-variant='ghost']:hover:not(:disabled),
.dsh-icon-button[data-variant='secondary']:hover:not(:disabled) { background: var(--dsh-ui-hover); }
.dsh-icon-button[aria-pressed='true'] { color: var(--dsh-ui-accent); }
.dsh-icon-button:disabled { color: var(--dsh-ui-muted); background: transparent; border-color: transparent; cursor: default; }
@media (prefers-reduced-motion: reduce) { .dsh-icon-button { transition: none; } }
`)
