import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-search-field', `
.dsh-search-field__clear {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border: 0; border-radius: var(--dsh-ui-radius-full);
  background: transparent; color: var(--dsh-ui-muted); cursor: pointer; padding: 0;
}
.dsh-search-field__clear:hover { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); }
`)
