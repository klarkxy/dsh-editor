export const overviewPanelStyles = `
@keyframes overview-panel-in { from { opacity: 0; transform: translateY(20px) scale(.98); filter: blur(3px); } }
@keyframes overview-item-in { from { opacity: 0; transform: translateY(12px); } }
@keyframes overview-bar-in { from { transform: scaleY(0); opacity: .35; } }
@keyframes overview-meter-in { from { transform: scaleX(0); opacity: .35; } }
/* 概览打开时优先于其他中栏 overlay（沿用旧 Shell 的 overview-open 行为）。 */
.shell.layout-shell:has(.overview-panel[data-dsh-center-overlay]) [data-dsh-center-overlay]:not(.overview-panel) { display: none; }
.shell .overview-panel, .dsh-ui .overview-panel {
  min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--surface);
  box-shadow: var(--elev-raised); font-size: var(--text-chrome, 13px);
  animation: overview-panel-in var(--duration-medium, 350ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both;
  will-change: transform, opacity, filter;
}
.shell .overview-header, .dsh-ui .overview-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3, 12px);
  padding: 16px 24px 12px; border-bottom: 1px solid var(--hairline);
}
.shell .overview-header h2, .dsh-ui .overview-header h2 { margin: 0; font: 500 20px/1.2 var(--font-serif); letter-spacing: -.02em; color: var(--fg); }
.shell .overview-header p, .dsh-ui .overview-header p { margin: 6px 0 0; }
.shell .overview-body, .dsh-ui .overview-body { display: grid; gap: var(--space-5, 20px); padding: 16px 24px 32px; }
.shell .overview-totals, .dsh-ui .overview-totals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3, 12px); }
.shell .overview-totals > article, .dsh-ui .overview-totals > article {
  display: grid; gap: 6px; padding: var(--space-3, 12px); border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg);
  transition: transform var(--duration-quick, 150ms) var(--ease-smooth-out, ease), box-shadow var(--duration-quick, 150ms) var(--ease-smooth-out, ease);
  animation: overview-item-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both;
}
.shell .overview-totals > article:hover, .dsh-ui .overview-totals > article:hover { transform: translateY(-2px); box-shadow: var(--elev-raised); }
.shell .overview-totals > article:nth-child(2), .dsh-ui .overview-totals > article:nth-child(2) { animation-delay: var(--duration-stagger, 40ms); }
.shell .overview-chapters, .shell .overview-chart, .dsh-ui .overview-chapters, .dsh-ui .overview-chart { min-width: 0; }
.shell .overview-totals span, .dsh-ui .overview-totals span { font: 500 var(--text-chrome, 13px)/1.4 var(--font-sans); color: var(--meta); letter-spacing: .04em; }
.shell .overview-totals strong, .dsh-ui .overview-totals strong { font: 600 var(--text-base, 14px)/1.2 var(--font-sans); color: var(--fg); font-variant-numeric: tabular-nums; }
.shell .overview-body h3, .dsh-ui .overview-body h3 { margin: 0 0 var(--space-2, 8px); font: 500 var(--text-base, 14px)/1.4 var(--font-sans); letter-spacing: .04em; color: var(--fg-2); }
.shell .overview-filter, .dsh-ui .overview-filter {
  width: 100%; min-height: var(--control-h, 34px); margin: 0 0 8px; padding: 0 10px; box-sizing: border-box;
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--fg);
  font: 400 var(--text-chrome, 13px)/1.3 var(--font-sans);
}
.shell .overview-chapter-list, .dsh-ui .overview-chapter-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.shell .overview-chapter, .dsh-ui .overview-chapter {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius-sm);
  transition: background-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), transform var(--duration-quick, 150ms) var(--ease-smooth-out, ease);
  animation: overview-item-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both;
}
/* 文档行错峰入场(40ms 逐级),与统计卡节奏一致。 */
.shell .overview-chapter-list > :nth-child(2), .dsh-ui .overview-chapter-list > :nth-child(2) { animation-delay: var(--duration-stagger, 40ms); }
.shell .overview-chapter-list > :nth-child(3), .dsh-ui .overview-chapter-list > :nth-child(3) { animation-delay: calc(var(--duration-stagger, 40ms) * 2); }
.shell .overview-chapter-list > :nth-child(4), .dsh-ui .overview-chapter-list > :nth-child(4) { animation-delay: calc(var(--duration-stagger, 40ms) * 3); }
.shell .overview-chapter-list > :nth-child(n+5), .dsh-ui .overview-chapter-list > :nth-child(n+5) { animation-delay: calc(var(--duration-stagger, 40ms) * 4); }
.shell .overview-chapter:hover, .dsh-ui .overview-chapter:hover { background: var(--bg); transform: translateX(2px); }
.shell .overview-chapter.empty, .dsh-ui .overview-chapter.empty { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 22%, transparent); }
.shell .overview-chapter-title, .dsh-ui .overview-chapter-title {
  text-align: left; min-height: 32px; color: var(--fg); font: 500 var(--text-base, 14px)/1.4 var(--font-sans); border: 0; background: transparent; cursor: pointer;
}
.shell .overview-chapter-title:hover, .dsh-ui .overview-chapter-title:hover { color: var(--accent); }
.shell .overview-chapter-chars, .shell .overview-chapter-time, .dsh-ui .overview-chapter-chars, .dsh-ui .overview-chapter-time {
  color: var(--meta); font-size: var(--text-chrome, 13px); font-variant-numeric: tabular-nums;
}
.shell .overview-chapter-meta, .dsh-ui .overview-chapter-meta { display: inline-flex; gap: 4px; min-height: 16px; }
.shell .overview-meta-pill, .dsh-ui .overview-meta-pill {
  display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 6px;
  border-radius: 999px; box-shadow: var(--elev-ring); background: var(--surface-warm); color: var(--fg-2); font-size: var(--text-chrome, 13px); font-weight: 500;
}
.shell .overview-empty-flag, .dsh-ui .overview-empty-flag {
  padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); font-size: var(--text-chrome, 13px);
}
.shell .overview-char-bars, .shell .overview-curve, .dsh-ui .overview-char-bars, .dsh-ui .overview-curve {
  display: flex; align-items: flex-end; gap: 6px; min-height: 96px; padding: var(--space-3, 12px); border: 1px solid var(--hairline);
  border-radius: var(--radius-md); background: var(--bg); overflow-x: auto;
}
.shell .overview-curve.weekly, .dsh-ui .overview-curve.weekly { min-height: 96px; }
.shell .overview-char-col, .shell .overview-curve-col, .dsh-ui .overview-char-col, .dsh-ui .overview-curve-col {
  flex: 1 1 18px; min-width: 18px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px;
}
.shell .overview-char-col i, .shell .overview-curve-col i, .dsh-ui .overview-char-col i, .dsh-ui .overview-curve-col i {
  display: block; width: 70%; max-width: 28px; min-height: 0; border-radius: 3px 3px 1px 1px; background: var(--accent);
  transform-origin: bottom center; animation: overview-bar-in var(--duration-medium, 350ms) var(--ease-smooth-out, ease) both;
}
.shell .overview-char-col.empty i, .dsh-ui .overview-char-col.empty i { background: color-mix(in srgb, var(--danger) 45%, var(--surface-warm)); }
.shell .overview-curve-col.today i, .dsh-ui .overview-curve-col.today i { background: var(--confirm); }
.shell .overview-curve-col.negative i, .dsh-ui .overview-curve-col.negative i { background: var(--danger); }
.shell .overview-char-value, .shell .overview-curve-col small, .dsh-ui .overview-char-value, .dsh-ui .overview-curve-col small {
  color: var(--meta); font-size: var(--text-chrome, 13px); font-variant-numeric: tabular-nums;
}
.shell .overview-char-label, .dsh-ui .overview-char-label {
  max-width: 4.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-size: var(--text-chrome, 13px);
  min-height: 32px; border: 0; background: transparent; cursor: pointer;
}
.shell .overview-recent ul, .dsh-ui .overview-recent ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.shell .overview-recent li, .dsh-ui .overview-recent li { display: grid; gap: 2px; animation: overview-item-in var(--duration-fast, 250ms) var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)) both; }
.shell .overview-recent li:nth-child(2), .dsh-ui .overview-recent li:nth-child(2) { animation-delay: var(--duration-stagger, 40ms); }
.shell .overview-recent li:nth-child(3), .dsh-ui .overview-recent li:nth-child(3) { animation-delay: calc(var(--duration-stagger, 40ms) * 2); }
.shell .overview-recent li:nth-child(n+4), .dsh-ui .overview-recent li:nth-child(n+4) { animation-delay: calc(var(--duration-stagger, 40ms) * 3); }
.shell .overview-recent button, .dsh-ui .overview-recent button { text-align: left; min-height: 32px; color: var(--fg); font-weight: 500; border: 0; background: transparent; cursor: pointer; font-size: var(--text-base, 14px); }
.shell .overview-recent button:hover, .dsh-ui .overview-recent button:hover { color: var(--accent); }
.shell .overview-recent small, .dsh-ui .overview-recent small { color: var(--meta); }
.shell .overview-panel button, .dsh-ui .overview-panel button { font-size: var(--text-chrome, 13px); }
.shell .overview-panel .icon-button, .dsh-ui .overview-panel .icon-button { min-height: 32px; min-width: 32px; }
/* 活动反馈:.panel-activity-dots / .panel-skeleton 共享类由 shell styles.ts 统一提供,
   面板不再自带副本(跨包注入同名类会互相覆盖);reduced-motion 停掉循环。
   概览载入卡片是面板私有骨架条(非共享类),保留本地 sheen 关键帧。 */
@keyframes overview-activity-sheen { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
.shell .overview-loading, .dsh-ui .overview-loading { display: grid; gap: var(--space-5, 20px); padding: 16px 24px 32px; }
.shell .overview-loading-cards, .dsh-ui .overview-loading-cards { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3, 12px); }
.shell .overview-loading-cards i, .dsh-ui .overview-loading-cards i { position: relative; display: block; height: 56px; border: 1px solid var(--hairline); border-radius: var(--radius-md); background: var(--bg); overflow: hidden; }
.shell .overview-loading-cards i::after, .dsh-ui .overview-loading-cards i::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--surface, #fdfcf6) 65%, transparent), transparent); animation: overview-activity-sheen 1.5s linear infinite; }
/* 焦点环:概览可能渲染在 .shell/.dsh-ui 之外,自带 focus-visible 词汇(box-shadow 环,不用 outline)。 */
.overview-panel :focus { outline: none; }
.overview-panel button:focus-visible, .overview-panel input:focus-visible, .overview-panel select:focus-visible, .overview-panel textarea:focus-visible, .overview-panel a:focus-visible, .overview-panel [tabindex]:focus-visible { box-shadow: var(--focus-ring); }
@media (max-width: 720px) {
  .shell .overview-totals, .shell .overview-chapter, .dsh-ui .overview-totals, .dsh-ui .overview-chapter { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .shell .overview-panel, .shell .overview-panel *, .dsh-ui .overview-panel, .dsh-ui .overview-panel *,
  .shell .panel-activity-dots i, .shell .panel-skeleton i::after, .dsh-ui .panel-activity-dots i, .dsh-ui .panel-skeleton i::after {
    animation: none !important; transition: none !important; filter: none !important; transform: none !important;
  }
}
`
