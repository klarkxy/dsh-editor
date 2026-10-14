import { defineStyles } from '../design-system/layers.ts'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/* 命令面板（command-palette.tsx，cmdk）：结构、动画与原稿外观合一。
   顶栏触发器与首页 chrome 触发器同一类名 .palette-trigger。 */
defineStyles('dsh.surfaces', 'dsh-palette', `
.palette-overlay { position: fixed; z-index: 40; inset: 0; backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--dsh-ui-scrim); }
.palette-overlay[data-state="open"] { animation: palette-overlay-in 150ms ${EASE}; }
.palette-overlay[data-state="closed"] { animation: palette-overlay-out 150ms ${EASE}; }
.palette-content {
  position: fixed; z-index: 41; top: 20vh; left: 50%; transform: translateX(-50%);
  width: min(560px, calc(100vw - 32px)); max-height: min(540px, 64dvh);
  display: flex; flex-direction: column; padding: 0; overflow: hidden;
  border: 0; border-radius: var(--dsh-ui-radius-panel);
  background: var(--dsh-ui-raised); box-shadow: var(--dsh-ui-elevation-prominent);
}
.palette-content[data-state="open"] { animation: palette-content-in 250ms ${EASE}; }
.palette-content[data-state="closed"] { animation: palette-content-out 150ms ${EASE} forwards; }
@keyframes palette-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes palette-overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes palette-content-in { from { opacity: 0; transform: translate(-50%, -16px) scale(.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes palette-content-out { from { opacity: 1; transform: translate(-50%, 0) scale(1); } to { opacity: 0; transform: translate(-50%, 8px) scale(.98); } }

.palette-command { display: flex; flex-direction: column; min-height: 0; }
.palette-search { display: flex; align-items: center; gap: var(--dsh-ui-space-3); padding: var(--dsh-ui-space-3) var(--dsh-ui-space-4); border-bottom: 0.5px solid var(--dsh-ui-line); }
.palette-search:focus-within { border-bottom-color: var(--dsh-ui-accent); }
.palette-search-icon { display: grid; place-items: center; color: var(--dsh-ui-muted); }
.palette-input, input[cmdk-input] {
  flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; outline: 0;
  font: 500 var(--font-size-4)/1.3 var(--dsh-ui-font-ui);
  color: var(--dsh-ui-text); min-height: var(--dsh-ui-control-sm);
}
.palette-input::placeholder, input[cmdk-input]::placeholder { font-weight: 400; color: var(--dsh-ui-muted); }
.palette-kbd { display: inline-grid; place-items: center; }
.palette-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: var(--dsh-ui-space-2); }
.palette-empty { padding: var(--dsh-ui-space-5) var(--dsh-ui-space-3); text-align: center; color: var(--dsh-ui-muted); }
.palette-group { padding: var(--dsh-ui-space-1) 0; }
.palette-group + .palette-group { margin-top: var(--dsh-ui-space-1); padding-top: var(--dsh-ui-space-2); border-top: 0.5px solid var(--dsh-ui-line); }
.palette-group [cmdk-group-heading], [cmdk-group-heading] {
  padding: var(--dsh-ui-space-1) var(--dsh-ui-space-3);
  font-size: var(--dsh-ui-text-xs); font-weight: var(--dsh-ui-weight-medium);
  letter-spacing: .08em; color: var(--dsh-ui-faint);
}
.palette-item, [cmdk-item] {
  display: flex; align-items: center; gap: var(--dsh-ui-space-3); width: 100%;
  padding: var(--dsh-ui-space-2); border-radius: var(--dsh-ui-radius-md);
  color: var(--dsh-ui-muted); cursor: pointer;
}
.palette-item[data-disabled="true"], [cmdk-item][data-disabled="true"] { opacity: .5; cursor: not-allowed; }
.palette-item[data-selected="true"], [cmdk-item][data-selected="true"] { background: var(--dsh-ui-selected); color: var(--dsh-ui-text); }
.palette-item-icon { display: grid; place-items: center; width: var(--dsh-ui-space-6); height: var(--dsh-ui-space-6); flex: none; background: transparent; color: var(--dsh-ui-muted); }
.palette-item[data-selected="true"] .palette-item-icon { color: var(--dsh-ui-accent); }
.palette-item-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.palette-item-label { font: 500 var(--dsh-ui-text-base)/1.3 var(--dsh-ui-font-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsh-ui-text); }
.palette-item-hint { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-footer { display: flex; align-items: center; gap: var(--dsh-ui-space-3); padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3); background: var(--dsh-ui-surface); border-top: 0.5px solid var(--dsh-ui-line); color: var(--dsh-ui-muted); }
.palette-footer > span { display: inline-flex; align-items: center; gap: var(--dsh-ui-space-1); }

/* 键位提示：12px 下限；顶栏触发器里的 Kbd 是独立元素。 */
.radix-themes .palette-kbd, .radix-themes .palette-trigger-kbd {
  font-size: var(--dsh-ui-text-xs); background: transparent;
  box-shadow: inset 0 0 0 0.5px var(--dsh-ui-line-strong); color: var(--dsh-ui-muted);
}
/* 工作台顶栏触发器：弱字色、透明底。 */
.radix-themes .dsh-topbar .palette-trigger { font-size: var(--dsh-ui-text-xs); background: transparent; color: var(--dsh-ui-muted); box-shadow: none; }
.radix-themes .dsh-topbar .palette-trigger:hover { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); }

@media (max-width: 760px) {
  .palette-content { top: 12vh; max-height: 70dvh; }
}
`)
