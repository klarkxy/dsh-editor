export const proofreadPanelStyles = `
@keyframes proofread-panel-in { from { opacity: 0; transform: translateY(18px) scale(.97); filter: blur(3px); } }
@keyframes proofread-item-in { from { opacity: 0; transform: translateY(10px); } }
.shell .proofread-panel, .dsh-ui .proofread-panel {
  margin: 0 10px 8px; padding: 8px; border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring);
  display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: var(--text-chrome, 13px);
  animation: proofread-panel-in var(--duration-medium, 350ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both;
  will-change: transform, opacity, filter;
}
.shell .proofread-panel-header, .dsh-ui .proofread-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.shell .proofread-panel-header h2, .dsh-ui .proofread-panel-header h2 { margin: 0; font: 500 var(--text-base, 14px)/1.3 var(--font-sans); color: var(--fg); }
.shell .proofread-panel-header p, .dsh-ui .proofread-panel-header p { margin: 4px 0 0; }
.shell .proofread-toolbar, .dsh-ui .proofread-toolbar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.shell .proofread-scopes, .dsh-ui .proofread-scopes { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.shell .proofread-panel button, .dsh-ui .proofread-panel button {
  min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent);
  cursor: pointer; font-size: var(--text-chrome, 13px);
  transition: background-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out, ease), transform var(--duration-quick, 150ms) var(--ease-smooth-out, ease);
}
.shell .proofread-toolbar button:hover:not(:disabled), .shell .proofread-kinds button:hover:not(:disabled), .shell .proofread-row-actions button:hover:not(:disabled), .shell .proofread-panel-header .icon-button:hover:not(:disabled),
.dsh-ui .proofread-toolbar button:hover:not(:disabled), .dsh-ui .proofread-kinds button:hover:not(:disabled), .dsh-ui .proofread-row-actions button:hover:not(:disabled), .dsh-ui .proofread-panel-header .icon-button:hover:not(:disabled) { box-shadow: var(--elev-ring-accent); transform: translateY(-1px) scale(1.03); }
.shell .proofread-toolbar button:active:not(:disabled), .shell .proofread-kinds button:active:not(:disabled), .shell .proofread-row-actions button:active:not(:disabled), .shell .proofread-panel-header .icon-button:active:not(:disabled),
.dsh-ui .proofread-toolbar button:active:not(:disabled), .dsh-ui .proofread-kinds button:active:not(:disabled), .dsh-ui .proofread-row-actions button:active:not(:disabled), .dsh-ui .proofread-panel-header .icon-button:active:not(:disabled) { transform: translateY(0) scale(.97); }
.shell .proofread-panel button:disabled, .dsh-ui .proofread-panel button:disabled { opacity: .45; cursor: default; }
.shell .proofread-panel button[aria-pressed="true"], .shell .proofread-panel button.active,
.dsh-ui .proofread-panel button[aria-pressed="true"], .dsh-ui .proofread-panel button.active { background: var(--accent); color: var(--accent-on); }
.shell .proofread-kinds, .dsh-ui .proofread-kinds { display: flex; flex-wrap: wrap; gap: 4px; }
.shell .proofread-chip, .dsh-ui .proofread-chip { background: var(--bg) !important; color: var(--fg-2) !important; box-shadow: var(--elev-ring); }
.shell .proofread-chip[aria-pressed="true"], .dsh-ui .proofread-chip[aria-pressed="true"] { background: var(--accent-soft) !important; color: var(--accent) !important; }
.shell .proofread-summary, .dsh-ui .proofread-summary { display: flex; flex-wrap: wrap; gap: 6px; color: var(--meta); font-size: var(--text-chrome, 13px); animation: proofread-item-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both; }
.shell .proofread-batch, .dsh-ui .proofread-batch { align-self: start; min-height: var(--control-h, 34px); }
.shell .proofread-results, .dsh-ui .proofread-results { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; max-height: min(40vh, 320px); overflow: auto; }
.shell .proofread-file, .dsh-ui .proofread-file { display: grid; gap: 4px; min-width: 0; }
.shell .proofread-results > li, .dsh-ui .proofread-results > li { animation: proofread-item-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both; }
.shell .proofread-results > li:nth-child(2), .dsh-ui .proofread-results > li:nth-child(2) { animation-delay: var(--duration-stagger, 40ms); }
.shell .proofread-results > li:nth-child(3), .dsh-ui .proofread-results > li:nth-child(3) { animation-delay: calc(var(--duration-stagger, 40ms) * 2); }
.shell .proofread-results > li:nth-child(4), .dsh-ui .proofread-results > li:nth-child(4) { animation-delay: calc(var(--duration-stagger, 40ms) * 3); }
.shell .proofread-results > li:nth-child(n+5), .dsh-ui .proofread-results > li:nth-child(n+5) { animation-delay: calc(var(--duration-stagger, 40ms) * 4); }
.shell .proofread-file > strong, .dsh-ui .proofread-file > strong { font-size: var(--text-chrome, 13px); color: var(--fg-2); overflow-wrap: anywhere; }
.shell .proofread-file ul, .dsh-ui .proofread-file ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.shell .proofread-row, .dsh-ui .proofread-row { display: grid; gap: 3px; min-width: 0; }
.shell .proofread-hit, .dsh-ui .proofread-hit {
  width: 100%; display: grid; gap: 2px; text-align: left; min-height: 32px; padding: 6px 8px; border: 0; border-radius: var(--radius-xs);
  background: transparent !important; color: var(--fg-2) !important; cursor: pointer; font-size: var(--text-chrome, 13px);
  transition: background-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out, ease);
}
.shell .proofread-hit:hover:not([disabled]), .dsh-ui .proofread-hit:hover:not([disabled]) { background: var(--accent-soft) !important; color: var(--fg) !important; box-shadow: inset 3px 0 0 var(--accent); }
.shell .proofread-head, .dsh-ui .proofread-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; min-width: 0; }
.shell .proofread-message, .dsh-ui .proofread-message { min-width: 0; overflow-wrap: anywhere; }
.shell .proofread-hit .proofread-kind, .dsh-ui .proofread-hit .proofread-kind { color: var(--meta); }
.shell .proofread-severity, .dsh-ui .proofread-severity { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; vertical-align: middle; background: var(--muted); }
.shell .proofread-severity.error, .dsh-ui .proofread-severity.error { background: var(--danger); }
.shell .proofread-severity.warning, .dsh-ui .proofread-severity.warning { background: var(--accent); }
.shell .proofread-severity.info, .dsh-ui .proofread-severity.info { background: var(--muted); }
.shell .proofread-excerpt, .dsh-ui .proofread-excerpt { display: block; color: var(--meta); overflow-wrap: anywhere; }
.shell .proofread-excerpt mark, .dsh-ui .proofread-excerpt mark { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--fg); padding: 0 1px; border-radius: 2px; }
.shell .proofread-suggestion, .dsh-ui .proofread-suggestion { display: block; color: var(--accent); }
.shell .proofread-row-actions, .dsh-ui .proofread-row-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 2px; animation: proofread-item-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both; }
.shell .proofread-row-actions button, .dsh-ui .proofread-row-actions button { background: var(--bg); color: var(--fg-2); box-shadow: var(--elev-ring); }
.shell .proofread-habits, .dsh-ui .proofread-habits { display: grid; gap: 4px; min-width: 0; }
.shell .proofread-habits h3, .dsh-ui .proofread-habits h3 { margin: 4px 0 0; font: 500 var(--text-chrome, 13px)/1.3 var(--font-sans); color: var(--fg-2); }
.shell .proofread-habits table, .dsh-ui .proofread-habits table { width: 100%; border-collapse: collapse; font-size: var(--text-chrome, 13px); }
.shell .proofread-habits th, .shell .proofread-habits td, .dsh-ui .proofread-habits th, .dsh-ui .proofread-habits td { padding: 3px 4px; text-align: left; color: var(--fg-2); }
.shell .proofread-habits th, .dsh-ui .proofread-habits th { color: var(--meta); font-weight: 500; }
.shell .proofread-habits td:nth-child(2), .shell .proofread-habits td:nth-child(3),
.dsh-ui .proofread-habits td:nth-child(2), .dsh-ui .proofread-habits td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
.shell .proofread-habits button, .dsh-ui .proofread-habits button { width: 100%; text-align: left; background: transparent; color: var(--fg-2); padding: 2px 4px; }
.shell .proofread-fix, .dsh-ui .proofread-fix { min-width: 0; }
.shell .proofread-panel .proposal-card, .dsh-ui .proofread-panel .proposal-card { font-size: var(--text-chrome, 13px); }
.shell .proofread-panel .proposal-card header, .shell .proofread-panel .proposal-card footer,
.dsh-ui .proofread-panel .proposal-card header, .dsh-ui .proofread-panel .proposal-card footer { flex-wrap: wrap; }
.shell .proofread-panel .proposal-card pre, .dsh-ui .proofread-panel .proposal-card pre { max-height: 120px; }
/* 焦点环:面板可能渲染在 .shell/.dsh-ui 之外,自带 focus-visible 词汇(box-shadow 环,不用 outline)。 */
.proofread-panel :focus { outline: none; }
.proofread-panel button:focus-visible, .proofread-panel input:focus-visible, .proofread-panel select:focus-visible, .proofread-panel textarea:focus-visible, .proofread-panel a:focus-visible, .proofread-panel [tabindex]:focus-visible { box-shadow: var(--focus-ring); }
/* 活动反馈:.panel-activity-dots / .panel-skeleton 共享类由 shell styles.ts 统一提供,
   面板不再自带副本(跨包注入同名类会互相覆盖);reduced-motion 停掉循环,保留静态点与骨架条。 */
.shell .proofread-loading, .dsh-ui .proofread-loading { display: grid; gap: 8px; color: var(--muted); }
@media (prefers-reduced-motion: reduce) {
  .shell .proofread-panel, .shell .proofread-panel *, .dsh-ui .proofread-panel, .dsh-ui .proofread-panel *,
  .shell .panel-activity-dots i, .shell .panel-skeleton i::after, .dsh-ui .panel-activity-dots i, .dsh-ui .panel-skeleton i::after {
    animation: none !important; transition: none !important; filter: none !important; transform: none !important;
  }
}
`
