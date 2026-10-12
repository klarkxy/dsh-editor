import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-switch', `
.dsh-switch-row {
  display: flex; align-items: center; gap: var(--dsh-ui-space-3);
  min-height: 40px; padding: var(--dsh-ui-space-1) 0; cursor: pointer; min-width: 0;
}
.dsh-switch-row[data-disabled] { cursor: default; }
.dsh-switch-row__text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.dsh-switch-row__label { font-size: var(--dsh-ui-text-base); }
.dsh-switch-row__desc { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-switch-row__kbd { flex: none; }
.dsh-switch {
  position: relative; flex: none; width: 36px; height: 20px; padding: 0;
  border: 0; border-radius: var(--dsh-ui-radius-full); cursor: pointer;
  background: var(--dsh-ui-line-strong);
  transition: background var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out);
}
.dsh-switch[data-state='checked'] { background: var(--dsh-ui-brand); }
.dsh-switch:disabled { opacity: 0.5; cursor: default; }
.dsh-switch__thumb {
  display: block; width: 16px; height: 16px; border-radius: var(--dsh-ui-radius-full);
  background: var(--dsh-ui-switch-thumb); box-shadow: var(--dsh-ui-elevation-soft);
  transform: translateX(2px);
  transition: transform var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out);
}
.dsh-switch__thumb[data-state='checked'] { transform: translateX(18px); }
@media (forced-colors: active) {
  .dsh-switch { border: 1px solid ButtonBorder; }
  .dsh-switch[data-state='checked'] { background: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-switch, .dsh-switch__thumb { transition: none; }
}
`)
