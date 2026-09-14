export const cardsPanelStyles = `
.shell .cards-panel, .dsh-ui .cards-panel {
  margin: 0 10px 8px; padding: 8px; border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--elev-ring);
  display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: var(--text-chrome, 13px); color: var(--fg);
}
.shell .cards-panel-header, .dsh-ui .cards-panel-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2, 8px);
}
.shell .cards-panel-header h2, .dsh-ui .cards-panel-header h2 {
  margin: 0; font: 500 var(--text-base, 14px)/1.3 var(--font-sans); color: var(--fg);
}
.shell .cards-tabs, .dsh-ui .cards-tabs { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.shell .cards-tabs button, .shell .cards-toolbar button, .shell .cards-chip, .shell .cards-ref-toggle,
.shell .cards-detail-actions button, .shell .cards-relations button,
.dsh-ui .cards-tabs button, .dsh-ui .cards-toolbar button, .dsh-ui .cards-chip, .dsh-ui .cards-ref-toggle,
.dsh-ui .cards-detail-actions button, .dsh-ui .cards-relations button {
  min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-sm);
  background: var(--accent-soft); color: var(--accent); cursor: pointer; font-size: var(--text-chrome, 13px);
}
.shell .cards-panel button:disabled, .shell .cards-detail button:disabled,
.dsh-ui .cards-panel button:disabled, .dsh-ui .cards-detail button:disabled { opacity: .45; cursor: default; }
.shell .cards-tabs button[aria-selected="true"], .shell .cards-chip[aria-pressed="true"],
.dsh-ui .cards-tabs button[aria-selected="true"], .dsh-ui .cards-chip[aria-pressed="true"] {
  background: var(--accent); color: var(--accent-on);
}
.shell .cards-toolbar, .dsh-ui .cards-toolbar { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.shell .cards-toolbar input, .shell .cards-toolbar select, .shell .cards-fields input, .shell .cards-fields select, .shell .cards-fields textarea,
.dsh-ui .cards-toolbar input, .dsh-ui .cards-toolbar select, .dsh-ui .cards-fields input, .dsh-ui .cards-fields select, .dsh-ui .cards-fields textarea {
  min-width: 0; width: 100%; min-height: var(--control-h, 34px); padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--fg); font: 400 var(--text-chrome, 13px)/1.3 var(--font-sans);
}
.shell .cards-fields textarea, .dsh-ui .cards-fields textarea { min-height: 72px; padding: 8px 10px; resize: vertical; }
.shell .cards-chips, .dsh-ui .cards-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.shell .cards-chip, .dsh-ui .cards-chip { background: var(--bg); color: var(--fg-2); box-shadow: var(--elev-ring); }
.shell .cards-groups, .dsh-ui .cards-groups { display: grid; gap: 8px; max-height: 320px; overflow: auto; }
.shell .cards-group h3, .dsh-ui .cards-group h3 { margin: 0; font: 500 var(--text-chrome, 13px)/1.3 var(--font-sans); color: var(--meta); letter-spacing: .04em; }
.shell .cards-list, .dsh-ui .cards-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.shell .cards-item, .dsh-ui .cards-item { display: grid; gap: 4px; padding: 8px; border-radius: var(--radius-sm); }
.shell .cards-item.selected, .dsh-ui .cards-item.selected { background: var(--accent-soft); }
.shell .cards-item-main, .dsh-ui .cards-item-main { display: grid; gap: 3px; width: 100%; text-align: left; border: 0; background: transparent; color: var(--fg); cursor: pointer; }
.shell .cards-item-main strong, .dsh-ui .cards-item-main strong { font: 500 var(--text-base, 14px)/1.3 var(--font-sans); }
.shell .cards-meta, .dsh-ui .cards-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--meta); font-size: var(--text-chrome, 13px); }
.shell .cards-badge, .dsh-ui .cards-badge { padding: 1px 6px; border-radius: 999px; background: var(--surface-warm); color: var(--fg-2); font-style: normal; }
.shell .cards-tags, .shell .cards-item-main small, .dsh-ui .cards-tags, .dsh-ui .cards-item-main small { color: var(--meta); font-size: var(--text-chrome, 13px); overflow-wrap: anywhere; }
.shell .cards-status, .dsh-ui .cards-status { margin: 0; font-size: var(--text-chrome, 13px); }
.shell .cards-refs, .dsh-ui .cards-refs { display: grid; gap: 4px; }
.shell .cards-ref-groups ol, .shell .cards-ref-groups ul, .dsh-ui .cards-ref-groups ol, .dsh-ui .cards-ref-groups ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.shell .cards-ref-groups button, .dsh-ui .cards-ref-groups button {
  width: 100%; text-align: left; min-height: 32px; padding: 4px 8px; border: 0; border-radius: var(--radius-xs);
  background: transparent; color: var(--fg-2); cursor: pointer; font-size: var(--text-chrome, 13px);
}
.shell .cards-ref-groups button:hover:not([disabled]), .dsh-ui .cards-ref-groups button:hover:not([disabled]) { background: var(--accent-soft); color: var(--fg); }
.shell .cards-detail, .dsh-ui .cards-detail {
  min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--surface);
  box-shadow: var(--elev-raised); font-size: var(--text-chrome, 13px);
}
.shell .cards-detail-header, .dsh-ui .cards-detail-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3, 12px);
  padding: 16px 24px 12px; border-bottom: 1px solid var(--hairline);
}
.shell .cards-detail-header-actions, .dsh-ui .cards-detail-header-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.shell .cards-detail-header h2, .dsh-ui .cards-detail-header h2 { margin: 0; font: 500 20px/1.2 var(--font-serif); letter-spacing: -.02em; color: var(--fg); }
.shell .cards-detail-header p, .dsh-ui .cards-detail-header p { margin: 6px 0 0; }
.shell .cards-detail-body, .dsh-ui .cards-detail-body { display: grid; gap: var(--space-4, 16px); padding: 16px 24px 32px; }
.shell .cards-fields, .dsh-ui .cards-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
.shell .cards-field, .dsh-ui .cards-field { display: grid; gap: 4px; min-width: 0; font-size: var(--text-chrome, 13px); color: var(--muted); }
.shell .cards-field-wide, .dsh-ui .cards-field-wide { grid-column: 1 / -1; }
.shell .cards-relations, .dsh-ui .cards-relations { display: grid; gap: 6px; }
.shell .cards-relation-row, .dsh-ui .cards-relation-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; gap: 4px; align-items: center; }
.shell .cards-relation-link, .dsh-ui .cards-relation-link { background: transparent; color: var(--accent); }
.shell .cards-detail-actions, .dsh-ui .cards-detail-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.shell .cards-detail-header-actions button:not(.icon-button), .dsh-ui .cards-detail-header-actions button:not(.icon-button) {
  min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); cursor: pointer; font-size: var(--text-chrome, 13px);
}
.dsh-ui.file-dialog.prompt-dialog, .shell .file-dialog.prompt-dialog, .dsh-ui .file-dialog.prompt-dialog { width: min(520px, 100%); }
/* 活动反馈:三点呼吸(pulse-dots)与骨架光泽(fluid-skeleton),参数改写自
   Amicro(MIT License, Copyright (c) 2026 Syed Subhan Uddin);reduced-motion
   停掉循环,保留静态点与骨架条。卡片列表载入用骨架,出现仅淡入(不位移)。 */
@keyframes cards-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes cards-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
@keyframes cards-item-in { from { opacity: 0; } }
.shell .panel-activity-dots, .dsh-ui .panel-activity-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; }
.shell .panel-activity-dots i, .dsh-ui .panel-activity-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: cards-activity-pulse 1.4s var(--ease-smooth-out, ease) infinite; }
.shell .panel-activity-dots i:nth-child(2), .dsh-ui .panel-activity-dots i:nth-child(2) { animation-delay: .2s; }
.shell .panel-activity-dots i:nth-child(3), .dsh-ui .panel-activity-dots i:nth-child(3) { animation-delay: .4s; }
.shell .panel-skeleton, .dsh-ui .panel-skeleton { display: grid; gap: 8px; }
.shell .panel-skeleton i, .dsh-ui .panel-skeleton i { position: relative; display: block; height: 10px; border-radius: var(--radius-sm, 6px); background: var(--hairline-strong, rgba(20, 20, 19, .12)); overflow: hidden; }
.shell .panel-skeleton i::after, .dsh-ui .panel-skeleton i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--surface, #fdfcf6) 65%, transparent), transparent); animation: cards-activity-sheen 1.5s linear infinite; }
.shell .cards-loading, .dsh-ui .cards-loading { display: grid; gap: 8px; color: var(--meta); }
.shell .cards-item, .dsh-ui .cards-item { animation: cards-item-in var(--duration-fast, 250ms) var(--ease-smooth-out, ease) both; }
@media (max-width: 720px) {
  .shell .cards-fields, .shell .cards-relation-row, .dsh-ui .cards-fields, .dsh-ui .cards-relation-row { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .shell .cards-panel, .shell .cards-panel *, .shell .cards-detail, .shell .cards-detail *,
  .dsh-ui .cards-panel, .dsh-ui .cards-panel *, .dsh-ui .cards-detail, .dsh-ui .cards-detail *,
  .dsh-ui.file-dialog.prompt-dialog, .dsh-ui.file-dialog.prompt-dialog * {
    animation: none !important; transition: none !important;
  }
}
`
