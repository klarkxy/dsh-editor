import { defineStyles } from '../design-system/layers.ts'

/*
 * 对话框面族（dialogs.tsx / export-dialog.tsx / history-dialog.tsx /
 * chapter-ops.tsx / components.tsx / import-dialog.tsx / root.tsx path-fallback）。
 * 共享遮罩 .file-dialog-overlay 与内容 .file-dialog；内部 Dialog 的 portal
 * 挂在 .dsh-root 内，仍是 .radix-themes 主题根的后代，后代选择器即可命中。
 */
defineStyles('dsh.surfaces', 'dsh-dialogs', `
.radix-themes .file-dialog-overlay { backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--dsh-ui-scrim); }

.radix-themes .file-dialog { max-width: min(520px, calc(100vw - 32px)); background: var(--dsh-ui-raised); border: 0; border-radius: var(--dsh-ui-radius-panel); box-shadow: var(--dsh-ui-elevation-prominent); }
/* 确认框叠在已打开的对话框之上：遮罩与内容各占一层，内容始终高于自身遮罩。 */
.radix-themes .confirm-overlay { z-index: calc(var(--dsh-ui-z-dialog) + 1); }
.radix-themes .file-dialog.confirm-dialog { z-index: calc(var(--dsh-ui-z-dialog) + 2); }
.radix-themes .file-dialog.chapter-ops-dialog { max-width: min(680px, calc(100vw - 32px)); }
.radix-themes .file-dialog.export-preview-dialog { max-width: min(640px, calc(100vw - 32px)); }
.radix-themes .chapter-ops-card { min-width: 0; }
.radix-themes .chapter-ops-dialog .proposal-card .proposal-actions { display: flex; width: auto; justify-content: flex-end; }
.radix-themes .chapter-ops-dialog .proposal-card .proposal-actions button { width: auto; }
.radix-themes .path-fallback { min-width: 0; }
.radix-themes .project-directory { overflow-wrap: anywhere; }

/* §8 导出预检：目录组三态复选 + 组内文档缩进。 */
.radix-themes .export-summary { min-width: 0; }
.radix-themes .export-chapters { max-height: 280px; }
.radix-themes .export-chapters ol { margin: 0; padding: 0; list-style: none; }
.radix-themes .export-group__dir .dsh-checkbox-row__label { font-weight: var(--dsh-ui-weight-medium); }
.radix-themes .export-group__docs { padding-inline-start: var(--dsh-ui-space-8); display: flex; flex-direction: column; }
.radix-themes .export-loading { display: grid; justify-items: center; gap: var(--dsh-ui-space-3); padding: var(--dsh-ui-space-5) 0 var(--dsh-ui-space-2); color: var(--dsh-ui-muted); }
.radix-themes .export-loading .activity-skeleton { width: min(320px, 100%); }

/* 图片预览：对话框 chrome 透明化，阴影落在 <img> 自身。 */
.radix-themes .file-dialog.image-preview-dialog {
  width: max-content; max-width: min(90vw, 1184px); max-height: min(80dvh, 780px);
  padding: 0; overflow: visible;
  background: transparent; border: 0; box-shadow: none;
}
.radix-themes .image-preview-dialog .dsh-dialog__body { padding: 0; overflow: visible; }
.radix-themes .image-preview-dialog img {
  display: block; max-width: min(90vw, 1184px); max-height: min(80dvh, 780px);
  object-fit: contain; box-shadow: var(--shadow-4);
  border-radius: var(--dsh-ui-radius-sm); background: var(--dsh-ui-raised);
}
.radix-themes .file-dialog.image-preview-dialog .image-preview-close {
  position: absolute; top: 8px; right: 8px; z-index: 1;
  width: 34px; height: 34px; min-width: 34px; min-height: 34px; padding: 0;
  font-size: var(--font-size-4); color: var(--dsh-ui-muted);
  background: var(--dsh-ui-raised); border-radius: var(--dsh-ui-radius-full);
  outline: 1px solid var(--dsh-ui-line-strong); corner-shape: round;
}

/* 导入进度行（import-dialog.tsx）。 */
.radix-themes .import-working { display: flex; align-items: center; gap: var(--dsh-ui-space-2); margin: 0; color: var(--dsh-ui-muted); }

/* ── 历史与回滚（history-dialog.tsx；原 history-styles.ts 并入本表） ── */
.radix-themes .file-dialog.history-dialog { max-width: min(860px, calc(100vw - 32px)); width: min(860px, calc(100vw - 32px)); }
.radix-themes .file-dialog.history-dialog-empty { width: min(560px, calc(100vw - 32px)); }
.radix-themes .history-split {
  display: grid;
  grid-template-columns: minmax(240px, 0.95fr) minmax(280px, 1.15fr);
  gap: var(--dsh-ui-space-3);
  min-height: 0;
  max-height: min(560px, calc(100dvh - 220px));
}
.radix-themes .history-commits,
.radix-themes .history-detail { min-width: 0; min-height: 0; overflow: auto; }
.radix-themes .history-commits { padding-left: 2px; }
.radix-themes .history-commit {
  position: relative;
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 10px 8px 18px;
  border: 0;
  border-radius: var(--dsh-ui-radius-md);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.radix-themes .history-commit::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--dsh-ui-line);
}
.radix-themes .history-commit:first-child::before { top: 14px; }
.radix-themes .history-commit:last-child::before { bottom: auto; height: 14px; }
.radix-themes .history-commit-dot {
  position: absolute;
  left: 3px;
  top: 12px;
  width: 7px;
  height: 7px;
  border-radius: var(--dsh-ui-radius-full);
  background: var(--dsh-ui-faint);
}
.radix-themes .history-commit:hover { background: var(--dsh-ui-hover); }
.radix-themes .history-commit[data-selected='true'],
.radix-themes .history-commit[aria-current="true"],
.radix-themes .history-commit[aria-selected="true"] { background: var(--dsh-ui-selected); color: var(--dsh-ui-text); }
.radix-themes .history-commit[data-selected='true'] .history-commit-dot { background: var(--dsh-ui-accent); }
.radix-themes .history-commit-body { display: grid; gap: 2px; min-width: 0; }
.radix-themes .history-commit-top { display: flex; align-items: baseline; gap: var(--dsh-ui-space-2); min-width: 0; }
.radix-themes .history-hash { font-family: var(--dsh-ui-font-mono); font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-accent); }
.radix-themes .history-hash-lg { font-size: var(--dsh-ui-text-base); }
.radix-themes .history-subject { min-width: 0; }
.radix-themes .history-commit-meta { min-width: 0; }
.radix-themes .history-changes { min-height: 0; overflow: auto; }
.radix-themes .history-change-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.radix-themes .history-change {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--dsh-ui-space-2);
  align-items: baseline;
  font-size: var(--dsh-ui-text-xs);
}
.radix-themes .history-change > :last-child { overflow-wrap: anywhere; }
.radix-themes .history-kind { font-family: var(--dsh-ui-font-mono); font-weight: var(--dsh-ui-weight-strong); }
.radix-themes .history-change-added .history-kind { color: var(--dsh-ui-success); }
.radix-themes .history-change-removed .history-kind { color: var(--dsh-ui-danger); }
.radix-themes .history-change-modified .history-kind { color: var(--dsh-ui-warning); }
.radix-themes .history-technical-details { color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); }
.radix-themes .history-technical-details > summary { cursor: pointer; min-height: var(--dsh-ui-control-sm); padding-block: var(--dsh-ui-space-2); }
@media (max-width: 720px) {
  .radix-themes .history-split { grid-template-columns: 1fr; max-height: min(70dvh, calc(100dvh - 180px)); }
}
`)
