import { defineStyles } from '../design-system/layers.ts'

/* 钉住窗格（pinned-pane.tsx）：窄窗抽屉是 Portal（挂 .shell 之外），
   两条宿主用同一选择器族。页头度量与 adapter 一致：无下分割线。 */
defineStyles('dsh.surfaces', 'dsh-pinned-pane', `
:is(.shell, .dsh-drawer) .pinned-pane { min-width: 0; min-height: 0; overflow: hidden; }
:is(.shell, .dsh-drawer) .pinned-header { min-height: var(--dsh-ui-header-height); background: var(--dsh-ui-bg); border-bottom: 0; }
:is(.shell, .dsh-drawer) .pinned-body { min-height: 0; flex: 1 1 auto; }
:is(.shell, .dsh-drawer) .pinned-markdown { min-width: 0; overflow-wrap: anywhere; }
`)
