import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-data-list', `
.dsh-data-list { display: grid; gap: var(--dsh-ui-space-2); margin: 0; }
.dsh-data-list__item {
  display: grid; grid-template-columns: auto minmax(0, 1fr);
  gap: var(--dsh-ui-space-2) var(--dsh-ui-space-3); align-items: baseline;
}
.dsh-data-list__item[data-align='center'] { align-items: center; }
.dsh-data-list__item[data-align='start'] { align-items: start; }
.dsh-data-list__item[data-align='end'] { align-items: end; }
.dsh-data-list__item[data-align='stretch'] { align-items: stretch; }
.dsh-data-list__label { color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); min-width: 0; }
.dsh-data-list__value { margin: 0; color: var(--dsh-ui-text); font-size: var(--dsh-ui-text-sm); min-width: 0; }
.dsh-data-list[data-size='1'] .dsh-data-list__label,
.dsh-data-list[data-size='1'] .dsh-data-list__value { font-size: var(--dsh-ui-text-xs); }
.dsh-data-list[data-size='3'] .dsh-data-list__label,
.dsh-data-list[data-size='3'] .dsh-data-list__value { font-size: var(--dsh-ui-text-md); }
`)
