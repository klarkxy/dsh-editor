import { defineStyles } from '../../design-system/layers.ts'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/* 活动反馈语法（activity.tsx + 面板共享类 .panel-skeleton）：点阵、环、
   微光、骨架、成功勾。适配层语义：typing 退化为 pulse、面板骨架不发光、
   shimmer 收敛为 2px 细线 —— 不再保留装饰性动效。 */
defineStyles('dsh.components', 'dsh-activity', `
.radix-themes .activity-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; }
.radix-themes .activity-text .activity-dots { margin-inline-end: 0; }
.radix-themes button .activity-dots:only-child { margin-inline-end: 0; }
.radix-themes .activity-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: var(--dsh-ui-radius-full); corner-shape: round; background: currentColor; }
.radix-themes .activity-dots.is-pulse i { animation: shell-activity-pulse 1.4s ${EASE} infinite; }
/* typing 档退化为同一脉冲（旧适配层只改 animation-name），时长/延迟保留原档。 */
.radix-themes .activity-dots.is-typing i { animation: shell-activity-pulse .6s ease-in-out infinite; }
.radix-themes .activity-dots.is-pulse i:nth-child(2) { animation-delay: .2s; }
.radix-themes .activity-dots.is-pulse i:nth-child(3) { animation-delay: .4s; }
.radix-themes .activity-dots.is-typing i:nth-child(2) { animation-delay: .15s; }
.radix-themes .activity-dots.is-typing i:nth-child(3) { animation-delay: .3s; }
.radix-themes .activity-ring { display: inline-block; vertical-align: middle; color: var(--dsh-ui-accent); }
.radix-themes .activity-shimmer { position: relative; display: block; width: 96px; height: 2px; border-radius: var(--dsh-ui-radius-full); corner-shape: round; background: var(--dsh-ui-line); overflow: hidden; }
.radix-themes .activity-shimmer i { position: absolute; top: 0; bottom: 0; left: 0; width: 33%; border-radius: inherit; background: var(--dsh-ui-accent); opacity: .5; animation: shell-activity-shimmer 1.5s ease-in-out infinite; }
.radix-themes .activity-skeleton { display: grid; gap: 8px; }
.radix-themes .activity-skeleton__line { position: relative; display: block; border-radius: var(--dsh-ui-radius-sm); background: var(--dsh-ui-line); overflow: hidden; }
.radix-themes .activity-skeleton__line::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--dsh-ui-hover), transparent); animation: shell-activity-sheen 1.5s linear infinite; }
.radix-themes .panel-skeleton { display: grid; gap: var(--dsh-ui-space-2); }
.radix-themes .panel-skeleton i { position: relative; display: block; height: 10px; border-radius: var(--dsh-ui-radius-sm); background: var(--dsh-ui-line); overflow: hidden; }
.radix-themes .panel-skeleton i::after { display: none; }
.radix-themes .activity-text { display: inline-flex; align-items: center; gap: 6px; animation: shell-fade-in 250ms ${EASE} both; }
.radix-themes .success-mark { display: inline-block; width: 1.1em; height: 1.1em; color: var(--dsh-ui-success); vertical-align: -.15em; }
.radix-themes .success-mark path { stroke: currentColor; stroke-dasharray: 42; stroke-dashoffset: 0; animation: shell-success-draw 250ms ${EASE}; }
.radix-themes .activity-reveal { animation: shell-fade-in 250ms ${EASE} both; }
`)
