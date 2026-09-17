export const memoryPanelStyles = `
@keyframes memory-panel-in { from { opacity: 0; transform: translateY(8px); } }
.radix-themes .memory-panel {
  margin: 0 var(--space-2) var(--space-2); padding: var(--space-2); max-height: min(40vh, 320px); overflow: auto; display: flex; flex-direction: column; gap: var(--space-2);
  border-radius: var(--radius-2); background: var(--color-panel-solid); box-shadow: var(--shadow-3); font-size: var(--font-size-2);
  animation: memory-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .memory-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.radix-themes .memory-panel-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--default-font-family); color: var(--gray-12); }
.radix-themes .memory-panel-header p { margin: var(--space-1) 0 0; color: var(--gray-10); }
.radix-themes .memory-filters { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.radix-themes .memory-panel button:not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: 32px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-2); background: var(--accent-a3); color: var(--accent-11);
  cursor: pointer; font-size: var(--font-size-2);
}
.radix-themes .memory-filters button[aria-pressed="true"] { background: var(--accent-a3); color: var(--accent-11); }
.radix-themes .memory-panel button:disabled { opacity: .45; cursor: default; }
.radix-themes .memory-panel .icon-button { min-width: 32px; }
.radix-themes .memory-change-meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.radix-themes .memory-panel .memory-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.radix-themes .memory-panel .memory-row-main {
  display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 36px; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-2);
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.radix-themes .memory-panel .memory-row-main::before { content: '›'; flex: none; color: var(--gray-10); transform: rotate(0); transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1); }
.radix-themes .memory-panel .memory-row-main[aria-expanded="true"]::before { transform: rotate(90deg); }
.radix-themes .memory-panel .memory-row-main:hover { background: var(--gray-a3); }
.radix-themes .memory-panel .memory-row-main[aria-expanded="true"] { background: var(--accent-a3); color: var(--accent-11); }
.radix-themes .memory-panel .memory-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gray-12); }
.radix-themes .memory-panel .memory-meta { flex: none; color: var(--gray-11); font-size: var(--font-size-2); }
.radix-themes .memory-panel .proposal-card { font-size: var(--font-size-2); }
.radix-themes .memory-panel .proposal-card pre { max-height: 120px; }
.radix-themes .memory-panel .memory-reason { display: grid; gap: var(--space-1); }
.radix-themes .memory-panel .memory-reason ul { margin: 0; padding-left: 18px; display: grid; gap: var(--space-1); }
.radix-themes .memory-panel .memory-reason small { color: var(--gray-10); }
.radix-themes .memory-panel .proposal-diff { display: grid; gap: var(--space-2); }
.radix-themes .memory-panel .proposal-card.memory-change { min-width: 0; }
.radix-themes details.proposal-card.memory-change-chat > summary {
  cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); list-style: none; min-width: 0;
}
.radix-themes details.proposal-card.memory-change-chat > summary::-webkit-details-marker { display: none; }
.radix-themes details.proposal-card.memory-change-chat > summary > strong { min-width: 0; overflow-wrap: anywhere; }
.radix-themes details.proposal-card.memory-change-chat > summary > code { overflow-wrap: anywhere; }
.radix-themes details.proposal-card.memory-change-chat[open] > summary { margin-bottom: 2px; }
.radix-themes .memory-panel .proposal-card.expired { border-color: var(--red-9); }
.radix-themes .memory-panel .proposal-card.checking { color: var(--gray-11); }
.radix-themes .memory-status { margin: 0; }
/* 焦点环:面板可能渲染在 Theme 根之外,自带 focus-visible 词汇(box-shadow 环,不用 outline)。 */
.memory-panel :focus { outline: none; }
.memory-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .memory-panel textarea:focus-visible, .memory-panel a:focus-visible, .memory-panel [tabindex]:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: 0 0 0 2px var(--accent-8); }
/* 活动反馈:.panel-activity-dots / .panel-skeleton 共享类由 shell styles.ts 统一提供,
   面板不再自带副本(跨包注入同名类会互相覆盖);reduced-motion 停掉循环,保留静态点与骨架条。 */
@media (prefers-reduced-motion: reduce) {
  .radix-themes .memory-panel, .radix-themes .memory-panel *,
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after {
    animation: none !important; transition: none !important; transform: none !important;
  }
}
`
