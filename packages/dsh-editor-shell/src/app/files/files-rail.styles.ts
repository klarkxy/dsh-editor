import { defineStyles } from '../../design-system/layers.ts'

/*
 * 文件栏样式（shell-rewrite-spec §3）：栏头 Tabs + 两个菜单按钮、目录树
 * （当前文档 selected 填充 + 朱色 marker 圆点、右键目标行 line-strong 内
 * 描边、按文件类型图标）、Notice 提示条与搜索页。颜色一律走 --dsh-ui-*。
 */
defineStyles('dsh.surfaces', 'dsh-files-rail', `
.dsh-files-rail {
  display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0;
  background: var(--dsh-ui-sidebar); color: var(--dsh-ui-text);
}
.dsh-files-rail__tabs { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.dsh-files-rail__head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--dsh-ui-space-2);
  flex: none; min-height: var(--dsh-ui-header-height); padding-inline: var(--dsh-ui-space-2) var(--dsh-ui-space-1);
}
.dsh-files-rail__actions { display: flex; align-items: center; gap: var(--dsh-ui-space-1); flex: none; }
.dsh-files-rail__panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dsh-files-rail .dsh-tabs__panel[hidden] { display: none; }
.dsh-files-rail__files { overflow: hidden; }
.dsh-files-rail__notice { margin: var(--dsh-ui-space-2) var(--dsh-ui-space-3) 0; flex: none; }
.dsh-files-rail__search { padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3) var(--dsh-ui-space-3); gap: var(--dsh-ui-space-2); overflow-x: hidden; overflow-y: auto; }
.dsh-files-rail__search-field { flex: none; }
.dsh-files-rail__search-panel { border: 0; margin: 0; padding: 0; min-width: 0; min-height: 0; display: flex; flex-direction: column; flex: 1 1 auto; }

/* ── 目录树 ────────────────────────────────────────────── */
.dsh-files-rail .tree {
  flex: 1 1 auto; min-height: 72px; outline: none;
  overflow-x: hidden; overflow-y: auto;
  padding: 2px var(--dsh-ui-space-1) var(--dsh-ui-space-4);
}
.dsh-files-rail .tree .tree-row {
  position: relative;
  display: flex; align-items: center; justify-content: flex-start;
  gap: var(--dsh-ui-space-2);
  width: 100%; min-width: 0; min-height: var(--dsh-ui-control-xs);
  padding: 0 var(--dsh-ui-space-2);
  border: 0; border-radius: var(--dsh-ui-radius-xs); background: transparent;
  color: var(--dsh-ui-text); font: inherit; font-size: var(--dsh-ui-text-sm);
  text-align: start; cursor: pointer; white-space: nowrap;
}
.dsh-files-rail .tree .tree-directory-row {
  display: flex; align-items: center; gap: var(--dsh-ui-space-1);
  width: 100%; min-width: 0; padding-right: var(--dsh-ui-space-2);
}
.dsh-files-rail .tree .tree-directory-row .tree-row { flex: 1 1 auto; }
.dsh-files-rail .tree .tree-row:hover { background: var(--dsh-ui-hover); box-shadow: none; }
.dsh-files-rail .tree .tree-row[aria-current="page"] {
  background: var(--dsh-ui-selected); color: var(--dsh-ui-text);
  font-weight: var(--dsh-ui-weight-medium); box-shadow: none;
}
/* 当前文档名字前的朱色 marker 圆点（目录行的 marker 槽被折叠箭头占用）。 */
.dsh-files-rail .tree .tree-row[aria-current="page"] .tree-marker:empty::before {
  content: ''; width: 6px; height: 6px; border-radius: var(--dsh-ui-radius-full);
  background: var(--dsh-ui-accent);
}
/* 右键菜单目标行：line-strong 内描边，与当前文档区分开。 */
.dsh-files-rail .tree .tree-row[data-menu-target="true"],
.dsh-files-rail .tree .tree-directory-row[data-menu-target="true"] .tree-row {
  box-shadow: inset 0 0 0 1px var(--dsh-ui-line-strong);
}
.dsh-files-rail .tree .tree-row[data-drop="true"] {
  background: var(--dsh-ui-accent-soft); box-shadow: inset 0 0 0 0.5px var(--dsh-ui-accent);
}
.dsh-files-rail .tree[data-drop="true"] { box-shadow: inset 0 0 0 1px var(--dsh-ui-accent); }
.dsh-files-rail .tree .tree-children { animation: shell-panel-enter 160ms var(--dsh-ui-ease-out); }
.dsh-files-rail .tree .tree-marker {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; flex: none; color: var(--dsh-ui-muted);
}
.dsh-files-rail .tree .tree-icon { display: inline-flex; flex: none; color: var(--dsh-ui-muted); }
.dsh-files-rail .tree .tree-row[aria-current="page"] .tree-icon { color: var(--dsh-ui-accent); }
.dsh-files-rail .tree .tree-row svg { flex: none; }
.dsh-files-rail .tree .tree-name {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  line-height: var(--dsh-ui-leading-tight); text-align: start;
}
.dsh-files-rail .tree .tree-empty { padding-inline: var(--dsh-ui-space-3); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); }
.dsh-files-rail .tree .tree-notice { margin: var(--dsh-ui-space-2) var(--dsh-ui-space-3); }
.dsh-files-rail .tree-row-actions { display: flex; align-items: center; gap: var(--dsh-ui-space-1); flex: none; visibility: hidden; }
.dsh-files-rail .tree-directory-row:hover .tree-row-actions,
.dsh-files-rail .tree-directory-row:focus-within .tree-row-actions { visibility: visible; }
.dsh-files-rail .tree-directory-add {
  display: grid; place-items: center; width: 20px; height: 20px; padding: 0;
  border: 0; border-radius: var(--dsh-ui-radius-xs); background: transparent;
  color: var(--dsh-ui-muted); cursor: pointer;
}
.dsh-files-rail .tree-directory-add:hover { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); }
.dsh-files-rail .tree-directory-add svg { width: 12px; height: 12px; }

/* ── 搜索页 ────────────────────────────────────────────── */
.dsh-files-rail .search-panel { flex: 1 1 auto; min-height: 0; display: flex; background: transparent; color: var(--dsh-ui-text); }
.dsh-files-rail .search-panel-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.dsh-files-rail .search-panel-stack { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); flex: 1 1 auto; min-height: 0; min-width: 0; }
.dsh-files-rail .search-form { display: flex; align-items: center; gap: var(--dsh-ui-space-2); flex-wrap: wrap; }
.dsh-files-rail .search-query-input, .dsh-files-rail .search-replace-input { flex: 1 1 auto; min-width: 0; }
.dsh-files-rail .search-replace { display: flex; align-items: center; gap: var(--dsh-ui-space-2); }
.dsh-files-rail .search-replace-confirm { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); }
.dsh-files-rail .search-replace-actions { display: flex; align-items: center; gap: var(--dsh-ui-space-2); margin-top: var(--dsh-ui-space-2); }
.dsh-files-rail .search-replace-result { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); }
.dsh-files-rail .search-replace-result-text { margin: 0; font-size: var(--dsh-ui-text-sm); }
.dsh-files-rail .search-note { margin: 0; font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-files-rail .search-file-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-files-rail .search-file-count { flex: none; font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-files-rail .search-file-head { display: flex; justify-content: space-between; gap: var(--dsh-ui-space-2); min-width: 0; padding: var(--dsh-ui-space-2) var(--dsh-ui-space-2) 0; }
.dsh-files-rail .search-results-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dsh-files-rail .search-replace-toggle { align-self: flex-start; padding-inline: 0; color: var(--dsh-ui-muted); }
.dsh-files-rail .search-file-head { min-width: 0; padding: var(--dsh-ui-space-2) var(--dsh-ui-space-2) 0; }
.dsh-files-rail .search-hit {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  width: 100%; min-height: var(--dsh-ui-control-sm);
  padding: var(--dsh-ui-space-1) var(--dsh-ui-space-2);
  border: 0; border-radius: var(--dsh-ui-radius-sm); background: transparent;
  color: var(--dsh-ui-text); text-align: start; font: inherit;
  font-size: var(--dsh-ui-text-sm); line-height: var(--dsh-ui-leading-normal);
  cursor: pointer; overflow-wrap: anywhere;
}
.dsh-files-rail .search-hit:hover { background: var(--dsh-ui-hover); }
.dsh-files-rail .search-hit:disabled { color: var(--dsh-ui-muted); cursor: not-allowed; }
.dsh-files-rail .search-hit-line { color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); font-variant-numeric: tabular-nums; }
.dsh-files-rail .search-results, .dsh-files-rail .search-results ul { margin: 0; padding: 0; list-style: none; }
.dsh-files-rail .search-results { padding-inline: var(--dsh-ui-space-1); }
.dsh-files-rail .search-file { display: grid; gap: var(--dsh-ui-space-1); }
.dsh-files-rail .search-results-scroll { max-height: none; }
.dsh-files-rail .search-summary { display: flex; flex-wrap: wrap; gap: var(--dsh-ui-space-2); font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }

/* 右键菜单的隐藏锚点：菜单内容按指针坐标定位（fixed 包裹层提供锚点）。 */
.file-menu-anchor { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
`)
