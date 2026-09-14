export const memoryPanelStyles = `
@keyframes memory-panel-in { from { opacity: 0; transform: translateY(18px) scale(.97); filter: blur(3px); } }
@keyframes memory-row-in { from { opacity: 0; transform: translateY(10px); } }
@keyframes memory-detail-in { from { opacity: 0; transform: translateY(8px) scale(.98); filter: blur(2px); } }
.shell .memory-panel, .dsh-ui .memory-panel {
  margin: 0 10px 8px; padding: 8px; max-height: 420px; overflow: auto; display: flex; flex-direction: column; gap: 8px;
  border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring); font-size: var(--text-chrome, 13px);
  animation: memory-panel-in var(--duration-medium, 350ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both;
  will-change: transform, opacity, filter;
}
.shell .memory-panel-header, .dsh-ui .memory-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.shell .memory-panel-header h2, .dsh-ui .memory-panel-header h2 { margin: 0; font: 500 var(--text-base, 14px)/1.3 var(--font-sans); color: var(--fg); }
.shell .memory-panel-header p, .dsh-ui .memory-panel-header p { margin: 4px 0 0; color: var(--meta); }
.shell .memory-filters, .dsh-ui .memory-filters { display: flex; flex-wrap: wrap; gap: 4px; }
.shell .memory-filters button, .dsh-ui .memory-filters button,
.shell .memory-panel button, .dsh-ui .memory-panel button {
  min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent);
  cursor: pointer; font-size: var(--text-chrome, 13px);
  transition: background-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out, ease), transform var(--duration-quick, 150ms) var(--ease-smooth-out, ease);
}
.shell .memory-panel button:not(.memory-row-main):hover:not(:disabled), .dsh-ui .memory-panel button:not(.memory-row-main):hover:not(:disabled) { box-shadow: var(--elev-ring-accent); transform: translateY(-1px) scale(1.03); }
.shell .memory-panel button:not(.memory-row-main):active:not(:disabled), .dsh-ui .memory-panel button:not(.memory-row-main):active:not(:disabled) { transform: translateY(0) scale(.97); }
.shell .memory-filters button[aria-pressed="true"], .dsh-ui .memory-filters button[aria-pressed="true"] { background: var(--accent); color: var(--accent-on); }
.shell .memory-panel button:disabled, .dsh-ui .memory-panel button:disabled { opacity: .45; cursor: default; }
.shell .memory-panel .icon-button, .dsh-ui .memory-panel .icon-button { min-width: 32px; }
.shell .memory-change-meta, .dsh-ui .memory-change-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.shell .memory-panel .memory-list, .dsh-ui .memory-panel .memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.shell .memory-panel .memory-list > li, .dsh-ui .memory-panel .memory-list > li { animation: memory-row-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both; }
.shell .memory-panel .memory-list > li:nth-child(2), .dsh-ui .memory-panel .memory-list > li:nth-child(2) { animation-delay: var(--duration-stagger, 40ms); }
.shell .memory-panel .memory-list > li:nth-child(3), .dsh-ui .memory-panel .memory-list > li:nth-child(3) { animation-delay: calc(var(--duration-stagger, 40ms) * 2); }
.shell .memory-panel .memory-list > li:nth-child(4), .dsh-ui .memory-panel .memory-list > li:nth-child(4) { animation-delay: calc(var(--duration-stagger, 40ms) * 3); }
.shell .memory-panel .memory-list > li:nth-child(5), .dsh-ui .memory-panel .memory-list > li:nth-child(5) { animation-delay: calc(var(--duration-stagger, 40ms) * 4); }
.shell .memory-panel .memory-list > li:nth-child(n+6), .dsh-ui .memory-panel .memory-list > li:nth-child(n+6) { animation-delay: calc(var(--duration-stagger, 40ms) * 5); }
.shell .memory-panel .memory-row-main, .dsh-ui .memory-panel .memory-row-main {
  display: flex; align-items: center; gap: 6px; width: 100%; min-height: 36px; padding: 4px 6px; border: 0; border-radius: var(--radius-sm);
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.shell .memory-panel .memory-row-main::before, .dsh-ui .memory-panel .memory-row-main::before { content: '›'; flex: none; color: var(--meta); transform: rotate(0); transition: transform 220ms var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)); }
.shell .memory-panel .memory-row-main[aria-expanded="true"]::before, .dsh-ui .memory-panel .memory-row-main[aria-expanded="true"]::before { transform: rotate(90deg); }
.shell .memory-panel .memory-row-main:hover, .dsh-ui .memory-panel .memory-row-main:hover { background: var(--accent-soft); }
.shell .memory-panel .memory-label, .dsh-ui .memory-panel .memory-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.shell .memory-panel .memory-meta, .dsh-ui .memory-panel .memory-meta { flex: none; color: var(--muted); font-size: var(--text-chrome, 13px); }
.shell .memory-panel .proposal-card, .dsh-ui .memory-panel .proposal-card { font-size: var(--text-chrome, 13px); }
.shell .memory-panel .proposal-card pre, .dsh-ui .memory-panel .proposal-card pre { max-height: 120px; }
.shell .memory-panel .memory-reason, .dsh-ui .memory-panel .memory-reason { display: grid; gap: 4px; }
.shell .memory-panel .memory-reason ul, .dsh-ui .memory-panel .memory-reason ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.shell .memory-panel .memory-reason small, .dsh-ui .memory-panel .memory-reason small { color: var(--meta); }
.shell .memory-panel .proposal-diff, .dsh-ui .memory-panel .proposal-diff { display: grid; gap: 7px; }
.shell .memory-panel .proposal-card.memory-change, .dsh-ui .memory-panel .proposal-card.memory-change { min-width: 0; }
.shell details.proposal-card.memory-change-chat > summary, .dsh-ui details.proposal-card.memory-change-chat > summary {
  cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; list-style: none; min-width: 0;
}
.shell details.proposal-card.memory-change-chat > summary::-webkit-details-marker, .dsh-ui details.proposal-card.memory-change-chat > summary::-webkit-details-marker { display: none; }
.shell details.proposal-card.memory-change-chat > summary > strong, .dsh-ui details.proposal-card.memory-change-chat > summary > strong { min-width: 0; overflow-wrap: anywhere; }
.shell details.proposal-card.memory-change-chat > summary > code, .dsh-ui details.proposal-card.memory-change-chat > summary > code { overflow-wrap: anywhere; }
.shell details.proposal-card.memory-change-chat[open] > summary, .dsh-ui details.proposal-card.memory-change-chat[open] > summary { margin-bottom: 2px; }
.shell details.proposal-card.memory-change-chat[open] > :not(summary), .dsh-ui details.proposal-card.memory-change-chat[open] > :not(summary),
.shell .memory-panel .memory-row-main[aria-expanded="true"] + *, .dsh-ui .memory-panel .memory-row-main[aria-expanded="true"] + * { animation: memory-detail-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both; }
.shell .memory-panel .proposal-card.expired, .dsh-ui .memory-panel .proposal-card.expired { border-color: var(--danger); }
.shell .memory-panel .proposal-card.checking, .dsh-ui .memory-panel .proposal-card.checking { color: var(--muted); }
.shell .memory-status, .dsh-ui .memory-status { margin: 0; animation: memory-detail-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both; }
/* 活动反馈:三点呼吸(pulse-dots)与骨架光泽(fluid-skeleton),参数改写自
   Amicro(MIT License, Copyright (c) 2026 Syed Subhan Uddin),1.4s 交错明灭 /
   1.5s linear 光泽扫过;reduced-motion 停掉循环,保留静态点与骨架条。 */
@keyframes memory-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes memory-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
.shell .panel-activity-dots, .dsh-ui .panel-activity-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; }
.shell .panel-activity-dots i, .dsh-ui .panel-activity-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: memory-activity-pulse 1.4s var(--ease-smooth-out, ease) infinite; }
.shell .panel-activity-dots i:nth-child(2), .dsh-ui .panel-activity-dots i:nth-child(2) { animation-delay: .2s; }
.shell .panel-activity-dots i:nth-child(3), .dsh-ui .panel-activity-dots i:nth-child(3) { animation-delay: .4s; }
.shell .panel-skeleton, .dsh-ui .panel-skeleton { display: grid; gap: 8px; }
.shell .panel-skeleton i, .dsh-ui .panel-skeleton i { position: relative; display: block; height: 10px; border-radius: var(--radius-sm, 6px); background: var(--hairline-strong, rgba(20, 20, 19, .12)); overflow: hidden; }
.shell .panel-skeleton i::after, .dsh-ui .panel-skeleton i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--surface, #fdfcf6) 65%, transparent), transparent); animation: memory-activity-sheen 1.5s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .shell .memory-panel, .shell .memory-panel *, .dsh-ui .memory-panel, .dsh-ui .memory-panel * {
    animation: none !important; transition: none !important; filter: none !important; transform: none !important;
  }
}
`
