import { defineStyles } from '../design-system/layers.ts'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/*
 * 稿纸编辑器（shell-rewrite-spec §4）：editor.tsx / components.tsx 的
 * .editor、.paper-*、.ghost、.editor-tools 钩子。外观沿用原稿 token；写作区
 * 字体、字号、行距、行宽仍由作者设置经 --paper-* 变量驱动，这里不改排版契约。
 * CodeMirror 基础主题自带 .cm-scroller { align-items: flex-start !important }，
 * 不再需要我们的 !important 声明。
 */
defineStyles('dsh.surfaces', 'dsh-editor', `
.radix-themes .editor {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--dsh-ui-bg);
  position: relative;
  z-index: 1;
  --paper-pad-inline: clamp(24px, 4vw, 64px);
  --paper-pad-block: 32px;
  --paper-header-space: 96px;
}

/* 稿纸页内页眉：挂在 .cm-scroller 顶部的宿主里，随文档滚走（不吸顶）。
   页眉不显示标题文字（正文一级标题即章节名），只留右侧「⋯」菜单；
   天头细线改由 live-preview 一级标题的底线承担。 */
.radix-themes .paper-page-header { height: 100%; box-sizing: border-box; padding-top: 28px; color: var(--dsh-ui-text); }
.radix-themes .paper-page-headline { position: relative; max-width: var(--paper-measure, 100%); margin-inline: auto; padding-inline: var(--paper-pad-inline); box-sizing: border-box; }
.radix-themes .paper-page-menu { position: absolute; inset-inline-end: var(--paper-pad-inline); top: 0; display: inline-flex; align-items: center; }

.radix-themes .editor-action-menu { min-width: 220px; }

/* 稿纸页脚状态行：版心居中、12px muted，固定在可视稿纸下沿。 */
.radix-themes .paper-footer-status { margin-inline: auto; display: flex; gap: 12px; align-items: baseline; font-size: var(--font-size-1); color: var(--s-muted, var(--dsh-ui-muted)); }

/* 选段改写浮层（§4）：预设一行 + 指令一行 + 操作行。 */
.dsh-popover .rewrite-popover { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2, 8px); min-width: 300px; }
.dsh-popover .rewrite-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-popover .rewrite-presets-custom .dsh-textarea { resize: vertical; }
.radix-themes .rewrite-instruction { width: 100%; min-height: 88px; }
.dsh-popover .rewrite-popover-actions { display: flex; gap: 8px; justify-content: flex-end; }

.radix-themes .paper-input {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  color: var(--dsh-ui-text);
}
/* 版心两侧各一条 1px margin-rule 竖线：横坐标由 editor.tsx 按 .cm-content
   实际内容盒量出后写进 --paper-rule-left / --paper-rule-right（线内缘距
   文字区 24px）；变量未写入时退回 --paper-measure 中线推算。
   pointer-events 关掉，不遮挡选区与光标。 */
.radix-themes .paper-input::before,
.radix-themes .paper-input::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--dsh-ui-margin-rule);
  pointer-events: none;
}
.radix-themes .paper-input::before { left: var(--paper-rule-left, max(0px, calc(50% - var(--paper-measure, 100%) / 2))); }
.radix-themes .paper-input::after { right: max(0px, calc(50% - var(--paper-measure, 100%) / 2)); left: var(--paper-rule-right, auto); }
.radix-themes .paper-input[data-rules-hidden]::before,
.radix-themes .paper-input[data-rules-hidden]::after { content: none; }
.radix-themes .paper-input .cm-editor { width: 100%; height: 100%; background: transparent; }
.radix-themes .paper-input .cm-scroller {
  justify-content: flex-start;
  font-family: var(--paper-font-family, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif);
}
.radix-themes .paper-input .cm-content {
  width: 100%;
  max-width: var(--paper-max-width, none);
  margin-inline: auto;
  box-sizing: border-box;
  text-align: start;
}
.radix-themes .paper-input .cm-line { text-align: start; }
.radix-themes .paper-input .cm-placeholder { color: var(--dsh-ui-muted); font-style: normal; }
.radix-themes .paper-scroll { max-width: 36em; margin: 0 auto; }

.radix-themes .ghost { color: var(--dsh-ui-faint); font: inherit; letter-spacing: inherit; line-height: inherit; }
.radix-themes .ghost.is-loading { color: var(--dsh-ui-muted); background: none; animation: none; }

.radix-themes .editor-tools {
  display: flex; align-items: center; flex-wrap: wrap; gap: var(--dsh-ui-space-2);
  min-height: var(--dsh-ui-space-8); padding: var(--dsh-ui-space-2) var(--dsh-ui-space-4);
  border-top: 0.5px solid var(--dsh-ui-line); background: var(--dsh-ui-bg);
  color: var(--dsh-ui-muted); flex-shrink: 0;
}
.radix-themes .editor-tools button {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: var(--dsh-ui-control-sm); padding-inline: var(--dsh-ui-space-3);
  border: 0.5px solid transparent; border-radius: var(--dsh-ui-radius-md);
  background: transparent; color: var(--dsh-ui-muted); box-shadow: none;
  cursor: pointer; font-size: var(--dsh-ui-text-xs);
  transition: background-color 150ms ${EASE}, border-color 150ms ${EASE}, box-shadow 150ms ${EASE};
}
.radix-themes .editor-tools button:hover:not(:disabled) { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); border-color: transparent; box-shadow: none; }
.radix-themes .editor-ghost-tip { display: flex; align-items: center; gap: var(--dsh-ui-space-2); padding: var(--dsh-ui-space-1) var(--dsh-ui-space-4); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); }
.radix-themes .editor-tools .ghost-actions { display: flex; gap: var(--dsh-ui-space-1); align-items: center; padding: 0 var(--dsh-ui-space-1); }
.radix-themes .editor-tools .ghost-actions > small { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.radix-themes .editor-tools .ghost-actions .kbd { font-family: var(--dsh-ui-font-mono); font-size: var(--dsh-ui-text-xs); padding: 2px var(--dsh-ui-space-1); border-radius: var(--dsh-ui-radius-sm); background: var(--dsh-ui-surface); color: var(--dsh-ui-muted); margin-right: var(--dsh-ui-space-1); }
.radix-themes .editor-tools .ghost-actions .fim-sep { color: var(--dsh-ui-line-strong); padding: 0 var(--dsh-ui-space-1); user-select: none; }

/* 页头行（paperHeader 关闭时的兜底 header 槽）。 */
.radix-themes .editor-header { min-height: var(--dsh-ui-header-height); background: var(--dsh-ui-bg); border-bottom: 0; }
.radix-themes .editor-doc-title { color: var(--dsh-ui-text); font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-medium); }
.radix-themes .editor-header [data-testid="paper-wordcount"],
.radix-themes .editor-header [data-testid="paper-save-state"] { color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); font-variant-numeric: tabular-nums; }

/* 选段建议卡（editor.tsx slot proposal）：扁平 raised + line-strong。 */
.radix-themes .proposal {
  position: relative; max-width: 100%;
  padding: var(--dsh-ui-space-5); margin: var(--dsh-ui-space-3) 0 var(--dsh-ui-space-2);
  background: var(--dsh-ui-raised);
  border: 0.5px solid var(--dsh-ui-line-strong);
  outline: 1px solid var(--dsh-ui-line); outline-offset: -1px;
  border-radius: var(--dsh-ui-radius-xl); box-shadow: none;
  display: grid; gap: var(--dsh-ui-space-2);
}
.radix-themes .proposal > strong { font: var(--dsh-ui-weight-medium) var(--dsh-ui-text-base)/1.4 var(--dsh-ui-font-ui); color: var(--dsh-ui-text); display: block; margin-bottom: var(--dsh-ui-space-3); }
.radix-themes .proposal p { margin: 0; white-space: pre-wrap; color: var(--dsh-ui-muted); }
.radix-themes .proposal-actions {
  display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--dsh-ui-space-2);
  padding-top: var(--dsh-ui-space-4); margin-top: var(--dsh-ui-space-4); border-top: 0.5px solid var(--dsh-ui-line);
}
.radix-themes .selection-diff { display: grid; gap: var(--dsh-ui-space-2); }
.radix-themes .selection-diff section small { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.radix-themes .proposal-conflict {
  padding: var(--dsh-ui-space-3);
  background: var(--dsh-ui-raised); color: var(--dsh-ui-text);
  border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-md);
  font-size: var(--dsh-ui-text-xs);
}

.radix-themes .editor-stack { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; }
.radix-themes .editor-stack .editor-pane { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }

@media (max-width: 1040px) {
  .radix-themes .editor { --paper-pad-inline: 20px; }
}
@media (max-width: 760px) {
  .radix-themes .editor { --paper-pad-inline: 22px; --paper-pad-block: 28px; }
  .radix-themes .editor-header { gap: var(--dsh-ui-space-2); padding-inline: var(--dsh-ui-space-3); flex-wrap: wrap; }
  .radix-themes .editor-doc-title { padding-inline-start: 0; }
}
@supports (container-type: inline-size) {
  .radix-themes .editor-stack { container-type: inline-size; }
  .radix-themes .editor { --paper-pad-inline: clamp(24px, 7cqi, 64px); }
}
`)
