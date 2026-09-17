export const proofreadPanelStyles = `
@keyframes proofread-panel-in { from { opacity: 0; transform: translateY(8px); } }
.radix-themes .proofread-panel {
  margin: 0 var(--space-2) var(--space-2); padding: var(--space-2); border-radius: var(--radius-2); background: var(--color-panel-solid); box-shadow: var(--shadow-3);
  display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; font-size: var(--font-size-2);
  animation: proofread-panel-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.radix-themes .proofread-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.radix-themes .proofread-panel-header h2 { margin: 0; font: var(--font-weight-medium) var(--font-size-4)/var(--line-height-4) var(--default-font-family); color: var(--gray-12); }
.radix-themes .proofread-panel-header p { margin: var(--space-1) 0 0; }
.radix-themes .proofread-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-1); align-items: center; }
.radix-themes .proofread-scopes { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); }
.radix-themes .proofread-panel button:not([class^="rt-"]):not([class*=" rt-"]) {
  min-height: 32px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-2); background: var(--accent-a3); color: var(--accent-11);
  cursor: pointer; font-size: var(--font-size-2);
}
.radix-themes .proofread-panel button:disabled { opacity: .45; cursor: default; }
.radix-themes .proofread-panel button[aria-pressed="true"], .radix-themes .proofread-panel button.active { background: var(--accent-a3); color: var(--accent-11); }
.radix-themes .proofread-kinds { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.radix-themes .proofread-chip { background: var(--gray-2); color: var(--gray-11); }
.radix-themes .proofread-chip[aria-pressed="true"] { background: var(--accent-a3); color: var(--accent-11); }
.radix-themes .proofread-summary { display: flex; flex-wrap: wrap; gap: var(--space-2); color: var(--gray-10); font-size: var(--font-size-2); }
.radix-themes .proofread-batch { align-self: start; min-height: 32px; }
.radix-themes .proofread-results { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); max-height: min(40vh, 320px); overflow: auto; }
.radix-themes .proofread-file { display: grid; gap: var(--space-1); min-width: 0; }
.radix-themes .proofread-file > strong { font-size: var(--font-size-2); color: var(--gray-11); overflow-wrap: anywhere; }
.radix-themes .proofread-file ul { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.radix-themes .proofread-row { display: grid; gap: 3px; min-width: 0; }
.radix-themes .proofread-hit {
  width: 100%; display: grid; gap: 2px; text-align: left; min-height: 32px; padding: var(--space-2); border: 0; border-radius: var(--radius-2);
  background: transparent; color: var(--gray-11); cursor: pointer; font-size: var(--font-size-2);
}
.radix-themes .proofread-hit:hover:not([disabled]) { background: var(--gray-a3); color: var(--gray-12); box-shadow: inset 3px 0 0 var(--accent-9); }
.radix-themes .proofread-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1); min-width: 0; }
.radix-themes .proofread-message { min-width: 0; overflow-wrap: anywhere; }
.radix-themes .proofread-hit .proofread-kind { color: var(--gray-10); }
.radix-themes .proofread-severity { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; vertical-align: middle; background: var(--gray-9); }
.radix-themes .proofread-severity.error { background: var(--red-9); }
.radix-themes .proofread-severity.warning { background: var(--amber-9); }
.radix-themes .proofread-severity.info { background: var(--gray-9); }
.radix-themes .proofread-excerpt { display: block; color: var(--gray-10); overflow-wrap: anywhere; }
.radix-themes .proofread-excerpt mark { background: var(--accent-a4); color: var(--gray-12); padding: 0 1px; border-radius: var(--radius-2); }
.radix-themes .proofread-suggestion { display: block; color: var(--accent-11); }
.radix-themes .proofread-row-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); padding: 0 2px; }
.radix-themes .proofread-row-actions button:not([class^="rt-"]):not([class*=" rt-"]) { background: var(--gray-2); color: var(--gray-11); }
.radix-themes .proofread-habits { display: grid; gap: var(--space-1); min-width: 0; }
.radix-themes .proofread-habits h3 { margin: var(--space-1) 0 0; font: var(--font-weight-medium) var(--font-size-2)/var(--line-height-2) var(--default-font-family); color: var(--gray-11); }
.radix-themes .proofread-habits table { width: 100%; border-collapse: collapse; font-size: var(--font-size-2); }
.radix-themes .proofread-habits th, .radix-themes .proofread-habits td { padding: 3px var(--space-1); text-align: left; color: var(--gray-11); }
.radix-themes .proofread-habits th { color: var(--gray-10); font-weight: var(--font-weight-medium); }
.radix-themes .proofread-habits td:nth-child(2), .radix-themes .proofread-habits td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
.radix-themes .proofread-habits button { width: 100%; text-align: left; background: transparent; color: var(--gray-11); padding: 2px var(--space-1); }
.radix-themes .proofread-fix { min-width: 0; }
.radix-themes .proofread-panel .proposal-card { font-size: var(--font-size-2); }
.radix-themes .proofread-panel .proposal-card header, .radix-themes .proofread-panel .proposal-card footer { flex-wrap: wrap; }
.radix-themes .proofread-panel .proposal-card pre { max-height: 120px; }
/* 焦点环:面板可能渲染在 Theme 根之外,自带 focus-visible 词汇(box-shadow 环,不用 outline)。 */
.proofread-panel :focus { outline: none; }
.proofread-panel button:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel input:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel select:focus-visible:not([class^="rt-"]):not([class*=" rt-"]), .proofread-panel textarea:focus-visible, .proofread-panel a:focus-visible, .proofread-panel [tabindex]:focus-visible:not([class^="rt-"]):not([class*=" rt-"]) { box-shadow: 0 0 0 2px var(--accent-8); }
/* 活动反馈:.panel-activity-dots / .panel-skeleton 共享类由 shell styles.ts 统一提供,
   面板不再自带副本(跨包注入同名类会互相覆盖);reduced-motion 停掉循环,保留静态点与骨架条。 */
.radix-themes .proofread-loading { display: grid; gap: var(--space-2); color: var(--gray-11); }
@media (prefers-reduced-motion: reduce) {
  .radix-themes .proofread-panel, .radix-themes .proofread-panel *,
  .radix-themes .panel-activity-dots i, .radix-themes .panel-skeleton i::after {
    animation: none !important; transition: none !important; transform: none !important;
  }
}
`
