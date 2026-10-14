import { panelChromeStyles } from 'dsh-editor-panel-base/chrome'

/*
 * 记忆维护面板：共享外观在 dsh-editor-panel-base/chrome（.dsh-panel 根、页头、
 * 提示、焦点环、standalone 按钮兜底、reduced-motion），这里只写本面板的结构差异。
 */
export const memoryPanelStyles = `${panelChromeStyles}
@keyframes memory-panel-in { from { opacity: 0; transform: translateY(8px); } }
.memory-panel {
  margin: 0; padding: var(--s-space-3); max-height: min(40vh, 320px); overflow: auto; gap: var(--s-space-2);
  border: 0; border-radius: 0; border-bottom: 0.5px solid var(--s-line); background: transparent; box-shadow: none;
  animation: memory-panel-in var(--s-duration-slow) var(--s-ease-out) both;
}
.memory-panel-header { padding-bottom: var(--s-space-1); }
.memory-filters { display: flex; flex-wrap: wrap; gap: var(--s-space-1); }
.memory-change-meta { display: flex; align-items: center; gap: var(--s-space-2); flex-wrap: wrap; }
.memory-list { display: flex; flex-direction: column; gap: var(--s-space-1); }
.memory-row-main {
  display: flex; align-items: center; gap: var(--s-space-2); width: 100%; min-height: var(--s-control);
  padding: var(--s-space-1) var(--s-space-2); border: 0; border-radius: var(--s-radius-md);
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; box-shadow: none;
}
.memory-panel .memory-row-main::before { content: '›'; flex: none; color: var(--s-faint); transform: rotate(0); transition: transform var(--s-duration-base) var(--s-ease-out); }
.memory-panel .memory-row-main[aria-expanded='true']::before { transform: rotate(90deg); }
.memory-panel .memory-row-main:hover { background: var(--s-hover); }
.memory-panel .memory-row-main[aria-expanded='true'] { background: var(--s-selected); color: var(--s-text); }
.memory-panel .memory-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--s-text); }
.memory-panel .memory-meta { flex: none; color: var(--s-muted); font-size: var(--s-text-xs); }
.memory-panel .proposal-card { font-size: var(--s-text-sm); }
.memory-panel .proposal-card pre { max-height: 120px; }
.memory-panel .memory-reason { display: grid; gap: var(--s-space-1); }
.memory-panel .memory-reason ul { margin: 0; padding-left: var(--s-space-5); display: grid; gap: var(--s-space-1); }
.memory-panel .memory-reason small { color: var(--s-faint); }
.memory-panel .proposal-diff { display: grid; gap: var(--s-space-2); }
.memory-panel .proposal-card.memory-change { min-width: 0; }
details.proposal-card.memory-change-chat > summary {
  cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-space-1) var(--s-space-2); list-style: none; min-width: 0;
}
details.proposal-card.memory-change-chat > summary::-webkit-details-marker { display: none; }
details.proposal-card.memory-change-chat > summary > strong { min-width: 0; overflow-wrap: anywhere; }
details.proposal-card.memory-change-chat > summary > code { overflow-wrap: anywhere; }
details.proposal-card.memory-change-chat[open] > summary { margin-bottom: var(--s-space-1); }
.memory-panel .proposal-card.expired { border: 1px solid var(--s-danger); }
.memory-panel .proposal-card.checking { color: var(--s-muted); }
.memory-status { margin: 0; color: var(--s-muted); }
`
