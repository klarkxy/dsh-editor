import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-split', `
.dsh-split { display: inline-flex; align-items: stretch; }
.dsh-split__main, .dsh-split__trigger {
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; cursor: pointer; background: var(--dsh-ui-brand); color: var(--dsh-ui-on-brand);
  font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-base)/1 var(--dsh-ui-font-ui);
  height: var(--dsh-ui-control-md);
}
.dsh-split__main { padding: 0 var(--dsh-ui-space-3) 0 var(--dsh-ui-space-4); border-radius: var(--dsh-ui-radius-md) 0 0 var(--dsh-ui-radius-md); }
.dsh-split__trigger { width: var(--dsh-ui-control-sm); border-radius: 0 var(--dsh-ui-radius-md) var(--dsh-ui-radius-md) 0; border-left: 0.5px solid var(--dsh-ui-accent-border); }
.dsh-split__main:hover:not(:disabled), .dsh-split__trigger:hover:not(:disabled) { background: var(--dsh-ui-brand-hover); }
.dsh-split__main:disabled, .dsh-split__trigger:disabled { background: var(--dsh-ui-hover); color: var(--dsh-ui-muted); cursor: default; }
`)
