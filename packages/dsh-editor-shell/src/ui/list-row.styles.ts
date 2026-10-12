import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-list-row', `
.dsh-list-row {
  display: flex; align-items: center; gap: var(--dsh-ui-space-2);
  min-height: 36px; padding: 0 var(--dsh-ui-space-2); border-radius: var(--dsh-ui-radius-sm);
  font-size: var(--dsh-ui-text-sm); min-width: 0;
}
.dsh-list-row[data-density='compact'] { min-height: 28px; font-size: var(--dsh-ui-text-sm); }
.dsh-list-row[role='button'] { cursor: pointer; }
.dsh-list-row[role='button']:hover { background: var(--dsh-ui-hover); }
.dsh-list-row[data-selected] { background: var(--dsh-ui-selected); color: var(--dsh-ui-accent); }
.dsh-list-row__leading { display: inline-flex; flex: none; color: var(--dsh-ui-muted); }
.dsh-list-row__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dsh-list-row__meta { color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); flex: none; }
.dsh-list-row__trailing { display: inline-flex; flex: none; }
`)
