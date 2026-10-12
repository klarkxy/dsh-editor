import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-spinner', `
.dsh-spinner {
  display: inline-block; width: var(--dsh-ui-icon-md); height: var(--dsh-ui-icon-md);
  border-radius: var(--dsh-ui-radius-full);
  border: 1.5px solid var(--dsh-ui-line-strong); border-top-color: var(--dsh-ui-accent);
  animation: dsh-spin var(--dsh-ui-duration-slow) linear infinite;
}
@keyframes dsh-spin { to { transform: rotate(1turn); } }
.dsh-activity-dots { display: inline-flex; gap: 3px; align-items: center; }
.dsh-activity-dots i {
  width: 4px; height: 4px; border-radius: var(--dsh-ui-radius-full); background: var(--dsh-ui-muted);
  animation: dsh-activity-blink 1.2s ease-in-out infinite;
}
.dsh-activity-dots i:nth-child(2) { animation-delay: 0.15s; }
.dsh-activity-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes dsh-activity-blink { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dsh-spinner, .dsh-activity-dots i { animation: none; }
}
`)
