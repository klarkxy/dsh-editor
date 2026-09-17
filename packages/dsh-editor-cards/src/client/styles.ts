export const cardsPanelStyles = `
@keyframes cards-panel-in { from { opacity: 0; } }
.radix-themes .cards-panel {
  margin: 0 var(--space-2) var(--space-2); padding: var(--space-2); border-radius: var(--radius-2); background: var(--color-panel-solid); box-shadow: var(--shadow-3);
  display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; font-size: var(--font-size-2); color: var(--gray-12);
  animation: cards-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .cards-panel-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2);
}
.radix-themes .cards-panel-header h2 {
  margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--default-font-family); color: var(--gray-12);
}
.radix-themes .cards-tabs { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); }
.radix-themes .cards-tabs button:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-toolbar button:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-chip:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-ref-toggle:not([class^="rt-"]):not([class*=" rt-"]),
.radix-themes .cards-detail-actions button:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-relations button:not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: 32px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-2);
  background: var(--accent-a3); color: var(--accent-11); cursor: pointer; font-size: var(--font-size-2);
}
.radix-themes .cards-panel button:disabled, .radix-themes .cards-detail button:disabled { opacity: .45; cursor: default; }
.radix-themes .cards-tabs button[aria-selected="true"], .radix-themes .cards-chip[aria-pressed="true"] {
  background: var(--accent-a3); color: var(--accent-11);
}
.radix-themes .cards-tabs button:hover:not(:disabled) { background: var(--gray-a3); }
.radix-themes .cards-toolbar { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
.radix-themes .cards-toolbar input:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-toolbar select:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-fields input:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-fields select:not([class^="rt-"]):not([class*=" rt-"]), .radix-themes .cards-fields textarea {
  min-width: 0; width: 100%; min-height: 32px; padding: 0 var(--space-2); border: 1px solid var(--gray-6); border-radius: var(--radius-2);
  background: var(--gray-2); color: var(--gray-12); font: 400 var(--font-size-2)/var(--line-height-2) var(--default-font-family);
}
.radix-themes .cards-toolbar .ui-input, .radix-themes .cards-fields .ui-input { min-width: 0; width: 100%; }
.radix-themes .cards-fields textarea { min-height: 72px; padding: var(--space-2); resize: vertical; }
.radix-themes .cards-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.radix-themes .cards-chip:not([class^="rt-"]):not([class*=" rt-"]) { background: var(--gray-2); color: var(--gray-11); }
.radix-themes .cards-chip:hover:not(:disabled) { background: var(--gray-a3); color: var(--gray-12); }
.radix-themes .cards-groups { display: grid; gap: var(--space-2); max-height: min(40vh, 320px); overflow: auto; }
.radix-themes .cards-group h3 { margin: 0; font: var(--font-weight-medium) var(--font-size-1)/var(--line-height-1) var(--default-font-family); color: var(--gray-10); }
.radix-themes .cards-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.radix-themes .cards-item { display: grid; gap: var(--space-1); padding: var(--space-2); border-radius: var(--radius-2); }
.radix-themes .cards-item.selected { background: var(--accent-a3); }
.radix-themes .cards-item-main { display: grid; gap: 3px; width: 100%; text-align: left; border: 0; background: transparent; color: var(--gray-12); cursor: pointer; }
.radix-themes .cards-item-main:hover { background: var(--gray-a3); }
.radix-themes .cards-item-main:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: 0 0 0 2px var(--accent-8); }
.radix-themes .cards-item-main strong { font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--default-font-family); }
.radix-themes .cards-meta { display: flex; flex-wrap: wrap; gap: var(--space-2); color: var(--gray-10); font-size: var(--font-size-2); }
.radix-themes .cards-badge { padding: 1px var(--space-2); border-radius: 999px; background: var(--gray-3); color: var(--gray-11); font-style: normal; }
.radix-themes .cards-tags, .radix-themes .cards-item-main small { color: var(--gray-10); font-size: var(--font-size-1); overflow-wrap: anywhere; }
.radix-themes .cards-status { margin: 0; font-size: var(--font-size-2); }
.radix-themes .cards-refs { display: grid; gap: var(--space-1); }
.radix-themes .cards-ref-groups ol, .radix-themes .cards-ref-groups ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.radix-themes .cards-ref-groups button {
  width: 100%; text-align: left; min-height: 32px; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-2);
  background: transparent; color: var(--gray-11); cursor: pointer; font-size: var(--font-size-2);
}
.radix-themes .cards-ref-groups button:hover:not([disabled]) { background: var(--gray-a3); color: var(--gray-12); }
.radix-themes .cards-detail {
  min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--color-panel-solid);
  box-shadow: var(--shadow-4); font-size: var(--font-size-2);
}
.radix-themes .cards-detail-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-3); border-bottom: 1px solid var(--gray-a5);
}
.radix-themes .cards-detail-header-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.radix-themes .cards-detail-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-5)/var(--line-height-5) var(--default-font-family); color: var(--gray-12); }
.radix-themes .cards-detail-header p { margin: var(--space-2) 0 0; }
.radix-themes .cards-detail-body { display: grid; gap: var(--space-4); padding: var(--space-4) var(--space-5) var(--space-6); }
.radix-themes .cards-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); }
.radix-themes .cards-field { display: grid; gap: var(--space-1); min-width: 0; font-size: var(--font-size-2); color: var(--gray-11); }
.radix-themes .cards-field-wide { grid-column: 1 / -1; }
.radix-themes .cards-relations { display: grid; gap: var(--space-2); }
.radix-themes .cards-relation-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: var(--space-1); align-items: center; }
.radix-themes .cards-relation-link { background: transparent; color: var(--accent-11); }
.radix-themes .cards-detail-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.radix-themes .cards-detail-header-actions button:not(.icon-button):not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: 32px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-2); background: var(--accent-a3); color: var(--accent-11); cursor: pointer; font-size: var(--font-size-2);
}
.radix-themes .file-dialog.prompt-dialog, .file-dialog.prompt-dialog { width: min(520px, 100%); }
/* 焦点环:面板/详情/新建对话框可能渲染在 Theme 根之外,自带 focus-visible 词汇(box-shadow 环,不用 outline)。 */
.cards-panel :focus, .cards-detail :focus, .file-dialog.prompt-dialog :focus { outline: none; }
.cards-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-panel textarea:focus-visible,
.cards-detail button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .cards-detail textarea:focus-visible,
.file-dialog.prompt-dialog button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .file-dialog.prompt-dialog textarea:focus-visible { box-shadow: 0 0 0 2px var(--accent-8); }
/* 活动反馈:.panel-activity-dots / .panel-skeleton 共享类由 shell styles.ts 统一提供,
   面板不再自带副本(跨包注入同名类会互相覆盖);reduced-motion 停掉循环,保留静态点与骨架条。 */
.radix-themes .cards-loading { display: grid; gap: var(--space-2); color: var(--gray-10); }
@media (max-width: 720px) {
  .radix-themes .cards-fields, .radix-themes .cards-relation-row { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .radix-themes .cards-panel, .radix-themes .cards-panel *, .radix-themes .cards-detail, .radix-themes .cards-detail *,
  .file-dialog.prompt-dialog, .file-dialog.prompt-dialog * {
    animation: none !important; transition: none !important;
  }
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after { animation: none !important; }
}
`
