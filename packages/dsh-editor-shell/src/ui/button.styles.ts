import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-button', `
.dsh-button {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--dsh-ui-space-2);
  height: var(--dsh-ui-control-md); padding: 0 var(--dsh-ui-space-4);
  border: 0; border-radius: var(--dsh-ui-radius-md); cursor: pointer;
  font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-base)/1 var(--dsh-ui-font-ui);
  white-space: nowrap; user-select: none;
  transition: background var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out), color var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out);
}
.dsh-button[data-size='sm'] { height: var(--dsh-ui-control-sm); padding: 0 var(--dsh-ui-space-3); font-size: var(--dsh-ui-text-sm); border-radius: var(--dsh-ui-radius-sm); }
.dsh-button[data-size='lg'] { height: var(--dsh-ui-control-lg); padding: 0 var(--dsh-ui-space-5); }
.dsh-button[data-variant='primary'] { background: var(--dsh-ui-brand); color: var(--dsh-ui-on-brand); }
.dsh-button[data-variant='primary']:hover:not(:disabled) { background: var(--dsh-ui-brand-hover); }
.dsh-button[data-variant='secondary'] { background: var(--dsh-ui-raised); color: var(--dsh-ui-text); border: 0.5px solid var(--dsh-ui-line-strong); }
.dsh-button[data-variant='secondary']:hover:not(:disabled) { background: var(--dsh-ui-hover); }
.dsh-button[data-variant='ghost'] { background: transparent; color: var(--dsh-ui-text); }
.dsh-button[data-variant='ghost']:hover:not(:disabled) { background: var(--dsh-ui-hover); }
.dsh-button[data-variant='danger'] { background: var(--dsh-ui-danger); color: var(--dsh-ui-raised); }
.dsh-button[data-variant='danger']:hover:not(:disabled) { background: var(--dsh-ui-danger); filter: brightness(0.94); }
.dsh-button:disabled { background: var(--dsh-ui-hover); color: var(--dsh-ui-muted); border-color: transparent; cursor: default; }
.dsh-button__icon { display: inline-flex; flex: none; }
.dsh-button__spinner { flex: none; }
@media (prefers-reduced-motion: reduce) { .dsh-button { transition: none; } }
`)
