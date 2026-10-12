import { defineStyles } from './layers.ts'

/* gallery 只服务 Ctrl+Alt+Shift+D 预览，不进产品界面；外观仍走 token，
   不写散落的 style={}（check-ui-drift 的 inline-appearance 规则）。 */
defineStyles('dsh.components', 'dsh-gallery', `
.dsh-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: var(--dsh-ui-space-4); }
.dsh-gallery__col { display: grid; gap: var(--dsh-ui-space-5); padding: var(--dsh-ui-space-3); background: var(--dsh-ui-bg); border-radius: var(--dsh-ui-radius-lg); color: var(--dsh-ui-text); font-size: var(--dsh-ui-text-base); align-content: start; }
.dsh-gallery__col-title { margin: 0; font-size: var(--dsh-ui-text-md); }
.dsh-gallery__section { display: grid; gap: var(--dsh-ui-space-2); }
.dsh-gallery__section-title { margin: 0; font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-strong); }
.dsh-gallery__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--dsh-ui-space-2); }
.dsh-gallery__swatch { display: grid; gap: 2px; min-width: 52px; }
.dsh-gallery__swatch-fill { height: 24px; border-radius: var(--dsh-ui-radius-xs); border: 1px solid var(--dsh-ui-line); background: var(--swatch, transparent); }
.dsh-gallery__caption { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-gallery__radius { display: grid; gap: 2px; }
.dsh-gallery__radius-box { width: 44px; height: 28px; background: var(--dsh-ui-surface); border: 1px solid var(--dsh-ui-line-strong); border-radius: var(--r, 0); }
.dsh-gallery__elevation-box { width: 72px; height: 40px; border-radius: var(--dsh-ui-radius-lg); background: var(--dsh-ui-raised); box-shadow: var(--e, none); }
.dsh-gallery__type { font-size: var(--t, inherit); }
.dsh-gallery__type-display { font-family: var(--dsh-ui-font-display); font-size: var(--dsh-ui-text-2xl); }
.dsh-gallery__type-mono { font-family: var(--dsh-ui-font-mono); font-size: var(--dsh-ui-text-sm); }
.dsh-gallery__footnote { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-gallery__disclosure-body { padding: var(--dsh-ui-space-2) 0; color: var(--dsh-ui-muted); }
.dsh-gallery__popover-body { display: grid; gap: 4px; }

/* 静态快照看不到 :hover/:focus-visible；画廊用 data-demo-state 复用同一套
   外观做演示，只作用于画廊列内，不改组件行为。 */
.dsh-gallery__col .dsh-button[data-demo-state="hover"][data-variant="secondary"] { background: var(--dsh-ui-hover); }
.dsh-gallery__col .dsh-button[data-demo-state="focus"] { outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; }
.dsh-gallery__col .dsh-input:has(> .dsh-input__control[data-demo-state="focus"]) { box-shadow: var(--dsh-ui-elevation-focus); }
.dsh-gallery__ctx-target {
  display: inline-flex; align-items: center; height: var(--dsh-ui-control-md); padding: 0 var(--dsh-ui-space-4);
  border: 0.5px dashed var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-md);
  color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); user-select: none;
}
`)
