import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.reset', 'dsh-root', `
/* height 撑满宿主：.shell/.plugin-workspace 的 100% 高度链都从这里起算。 */
.dsh-root { height: 100%; min-height: 0; color: var(--dsh-ui-text); font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-base); line-height: var(--dsh-ui-leading-normal); }
.dsh-root, .dsh-root *, .dsh-root *::before, .dsh-root *::after { box-sizing: border-box; }
.dsh-root [data-dsh-portal-root] { display: contents; }
.dsh-root :focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; }
`)
