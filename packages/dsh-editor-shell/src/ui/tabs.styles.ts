import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-tabs', `
.dsh-tabs { display: flex; flex-direction: column; min-height: 0; }
.dsh-tabs__list { display: flex; gap: var(--dsh-ui-space-4); border-bottom: 0.5px solid var(--dsh-ui-line); }
.dsh-tabs__tab {
  position: relative; height: 36px; padding: 0 2px; border: 0; background: transparent;
  color: var(--dsh-ui-muted); cursor: pointer; white-space: nowrap;
  font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-base)/1 var(--dsh-ui-font-ui);
}
.dsh-tabs__tab:hover:not(:disabled):not([data-state='active']) { color: var(--dsh-ui-text); }
.dsh-tabs__tab[data-state='active'] { color: var(--dsh-ui-text); }
.dsh-tabs__tab[data-state='active']::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -0.5px;
  height: 2px; background: var(--dsh-ui-accent); border-radius: var(--dsh-ui-radius-full);
}
.dsh-tabs__tab:disabled { opacity: 0.5; cursor: default; }
.dsh-tabs__panel { min-height: 0; }
@media (forced-colors: active) {
  .dsh-tabs__tab[data-state='active']::after { background: Highlight; }
}
`)
