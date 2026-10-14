import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-progress', `
.dsh-progress {
  position: relative; overflow: hidden;
  height: 6px; border-radius: var(--dsh-ui-radius-sm);
  background: var(--dsh-ui-sunken);
}
.dsh-progress__fill {
  height: 100%; border-radius: inherit; background: var(--dsh-ui-accent);
  transition: width 200ms var(--dsh-ui-ease, ease);
}
.dsh-progress[data-state='indeterminate'] .dsh-progress__fill {
  width: 40%; animation: dsh-progress-slide 1.2s ease-in-out infinite;
}
@keyframes dsh-progress-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(260%); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-progress__fill { transition: none; }
  .dsh-progress[data-state='indeterminate'] .dsh-progress__fill { animation: none; }
}
`)
