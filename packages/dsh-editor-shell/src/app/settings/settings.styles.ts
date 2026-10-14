import { defineStyles } from '../../design-system/layers.ts'

/*
 * 全页设置（shell-rewrite-spec §7）：顶栏 = 工作台同款 chrome（返回写作 +
 * 页面标题 + 窗口控制），左侧分组导航，右侧滚动内容。工作台宿主仍占据
 * 同一网格单元，inert+hidden 由 SettingsWorkspace 负责，不在这里写。
 * 插件目录/配置行的样式留在 design-system/styles.ts 的 plugins-catalog 规则。
 */
defineStyles('dsh.surfaces', 'dsh-settings-page', `
.dsh-settings-workspace {
  display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
  width: 100%; height: 100%; min-height: 0;
}
.dsh-settings-workspace__under, .dsh-settings-workspace__page {
  grid-area: 1 / 1; min-width: 0; min-height: 0;
}
.dsh-settings-workspace__under.is-covered { visibility: hidden; pointer-events: none; }
.dsh-settings-workspace__page { display: flex; flex-direction: column; min-height: 0; }
.dsh-settings-workspace__page[hidden], .dsh-settings-section[hidden] { display: none; }

.dsh-settings-page {
  display: grid; grid-template-columns: minmax(0, 1fr);
  grid-template-rows: var(--dsh-ui-header-height) minmax(0, 1fr);
  background: var(--dsh-ui-bg); color: var(--dsh-ui-text); height: 100%; min-height: 0;
}
.dsh-settings-page__top {
  display: flex; align-items: center; gap: var(--dsh-ui-space-3);
  padding-inline: var(--dsh-ui-space-3);
  border-bottom: 0.5px solid var(--dsh-ui-line);
  -webkit-app-region: drag;
}
.dsh-settings-page__top :is(button, a, input, .dsh-icon-button) { -webkit-app-region: no-drag; }
.dsh-settings-page__title {
  margin: 0; font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-medium);
  min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-settings-page__tools {
  margin-inline-start: auto; display: flex; align-items: center;
  gap: var(--dsh-ui-space-3); min-width: 0;
}

.dsh-settings-page__layout {
  display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 0;
}
.dsh-settings-page__nav {
  display: flex; flex-direction: column; gap: var(--dsh-ui-space-1);
  padding: var(--dsh-ui-space-4) var(--dsh-ui-space-2);
  overflow-y: auto; overflow-x: hidden;
  background: var(--dsh-ui-sidebar); border-right: 0.5px solid var(--dsh-ui-line);
}
.dsh-settings-page__nav > * { flex-shrink: 0; }
.dsh-settings-nav-group { display: flex; flex-direction: column; gap: var(--dsh-ui-space-1); }
.dsh-settings-nav-group + .dsh-settings-nav-group {
  margin-top: var(--dsh-ui-space-5); padding-top: var(--dsh-ui-space-4);
  border-top: 0.5px solid var(--dsh-ui-line);
}
.dsh-settings-nav-group__label {
  padding: 0 var(--dsh-ui-space-3) var(--dsh-ui-space-1);
  color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs);
  font-weight: var(--dsh-ui-weight-medium);
}
.dsh-settings-nav-item[data-warn] .dsh-list-row__leading { color: var(--dsh-ui-muted); }

.dsh-settings-config { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); padding: var(--dsh-ui-space-1) var(--dsh-ui-space-1) 0; }
.dsh-settings-config__label {
  padding: 0 var(--dsh-ui-space-2);
  color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); font-weight: var(--dsh-ui-weight-medium);
}
.dsh-settings-config__links { display: flex; flex-direction: column; gap: 1px; list-style: none; margin: 0; padding: 0; }
.dsh-settings-config__links .dsh-list-row { padding-inline-start: var(--dsh-ui-space-4); }
.dsh-settings-config__empty { margin: 0; padding: 0 var(--dsh-ui-space-2); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); }
.dsh-settings-config__advanced > summary {
  cursor: pointer; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs);
  font-weight: var(--dsh-ui-weight-medium); padding: var(--dsh-ui-space-2);
}

.dsh-settings-page__content {
  padding: var(--dsh-ui-space-5) var(--dsh-ui-space-6) var(--dsh-ui-space-8);
  overflow-y: auto; overflow-x: hidden; min-width: 0; min-height: 0; overflow-wrap: anywhere;
}
.dsh-settings-section { display: flex; flex-direction: column; gap: var(--dsh-ui-space-4); min-width: 0; max-width: 880px; }
.dsh-settings-section__title {
  margin: 0; font-size: var(--dsh-ui-text-xl); font-weight: var(--dsh-ui-weight-medium);
}
.dsh-settings-section__head { display: flex; align-items: center; gap: var(--dsh-ui-space-3); min-width: 0; }
.dsh-settings-section__head .dsh-settings-section__title { flex: none; }
.dsh-settings-section__tools { margin-inline-start: auto; display: flex; align-items: center; gap: var(--dsh-ui-space-2); min-width: 0; }
.dsh-settings-section__tools .dsh-search-field { width: 16rem; }
.dsh-settings-error { margin: 0; color: var(--dsh-ui-danger, var(--dsh-ui-text)); font-size: var(--dsh-ui-text-sm); }

/* ── 设置卡片：0.5px 描边无阴影的平面卡片，space-4 横向 / space-3-4 纵向内边距；
     标题 text-sm 加粗、下方留 space-2；行分隔线自然缩进在内边距内。 ── */
.dsh-settings-page .settings-block {
  padding: var(--dsh-ui-space-3) var(--dsh-ui-space-4) var(--dsh-ui-space-4);
  border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-xl);
  background: var(--dsh-ui-raised);
}
.dsh-settings-page .settings-block-head { margin-bottom: var(--dsh-ui-space-2); }
.dsh-settings-page .settings-block-title {
  font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-medium);
}
/* 分区页里的裸 h3 与卡片标题同一档（旧 settings-block-title/h3 规则的合并）。 */
.radix-themes .dsh-settings-page h3 { margin: 0; font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-medium); line-height: 1.5; }
/* 跳转型操作（查看全部快捷键等）按链接上色，不用 Radix 默认 accent。 */
.dsh-settings-page .settings-link-button { color: var(--dsh-ui-link); }
/* ghost 按钮自带 -8px 光学外溢 + 内边距（让文字对齐外缘）；卡片内的
   可点目标盒子仍须留在内边距里、文字要与同列正文同一起点，外溢和内边距
   都关掉。只作用在设置卡片内的 ghost 按钮，外面的光学对齐保持不变。 */
.dsh-settings-page .settings-block .dsh-button[data-variant='ghost'] {
  --margin-left-override: 0px; --margin-right-override: 0px;
  padding-inline: 0;
}

/* ── 窄窗导航（<760px）：导航列收成「当前分区」触发行，抽屉里放同一棵导航树 ── */
.dsh-settings-nav-mobile { display: none; }
.dsh-settings-nav-trigger {
  display: flex; align-items: center; gap: var(--dsh-ui-space-2);
  width: 100%; min-height: 40px; padding: 0 var(--dsh-ui-space-3);
  background: none; border: 0; border-bottom: 0.5px solid var(--dsh-ui-line);
  font: inherit; font-weight: var(--dsh-ui-weight-medium); color: var(--dsh-ui-text);
  cursor: pointer;
}
.dsh-settings-nav-trigger:hover { background: var(--dsh-ui-hover); }
.dsh-settings-nav-trigger:focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: -2px; }
.dsh-settings-nav-trigger__label { flex: 1 1 auto; min-width: 0; text-align: start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-settings-nav-trigger svg { flex: none; color: var(--dsh-ui-muted); }
.dsh-settings-nav-drawer {
  display: flex; flex-direction: column; gap: var(--dsh-ui-space-1);
  flex: 1 1 auto;
  padding: var(--dsh-ui-space-4) var(--dsh-ui-space-2);
  overflow-y: auto; overflow-x: hidden; min-height: 0;
}
@media (max-width: 759px) {
  .dsh-settings-page__layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .dsh-settings-page__nav { display: none; }
  .dsh-settings-nav-mobile { display: block; min-width: 0; }
}

/* ── 写作分区：控件列 + 实时预览列，预览与编辑器共用 --paper-* 变量 ── */
.dsh-writing-settings {
  display: grid; grid-template-columns: minmax(280px, 430px) minmax(0, 1fr);
  gap: var(--dsh-ui-space-6); align-items: start;
}
.dsh-writing-settings__controls { display: flex; flex-direction: column; gap: var(--dsh-ui-space-4); min-width: 0; }
.dsh-settings-preview { position: sticky; top: 0; min-width: 0; }
.dsh-settings-preview__paper {
  margin-inline: auto; width: 100%; max-width: var(--paper-max-width, none);
  padding: var(--dsh-ui-space-5) var(--dsh-ui-space-6);
  background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-xl);
  font-family: var(--paper-font-family); font-size: var(--paper-font-size);
  line-height: var(--paper-line-height); color: var(--dsh-ui-text);
  max-height: 70vh; overflow: hidden;
}
.dsh-settings-preview__para {
  margin: 0; text-indent: var(--paper-first-indent, 0);
}
.dsh-settings-preview__para + .dsh-settings-preview__para {
  margin-top: var(--paper-paragraph-spacing, 0.25em);
}
.dsh-settings-preview__section, .dsh-settings-preview__mark {
  margin: 0; padding-block: 1em; text-align: start; text-indent: 0;
}
.dsh-settings-preview__section { font-family: var(--dsh-ui-font-display, var(--paper-font-family)); }
.dsh-settings-preview__mark { color: var(--dsh-ui-muted); }
.dsh-settings-preview__section--centered { text-align: center; }
.dsh-settings-preview__mark + .dsh-settings-preview__para,
.dsh-settings-preview__section + .dsh-settings-preview__para { margin-top: 0; }

.writing-slider-group { display: flex; flex-direction: column; gap: var(--dsh-ui-space-3); padding-block: var(--dsh-ui-space-3); }
.writing-slider-group .dsh-slider-row { width: 100%; }
.writing-slider-group .dsh-slider-row__value { font-variant-numeric: tabular-nums; }

/* 用量统计卡与快捷键表（原 Radix Grid/Table 的原稿等价）：双列起步，
   ≥768px 四列；表格沿用 hairline 行分隔。 */
.usage-cards { display: grid; gap: var(--dsh-ui-space-3); grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 768px) {
  .usage-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.dsh-shortcuts-table { width: 100%; border-collapse: collapse; font-size: var(--dsh-ui-text-sm); }
.dsh-shortcuts-table th, .dsh-shortcuts-table td {
  padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3) var(--dsh-ui-space-2) 0;
  text-align: start; vertical-align: top;
  border-bottom: 0.5px solid var(--dsh-ui-line);
}
.dsh-shortcuts-table thead th { font-weight: var(--dsh-ui-weight-medium); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); }
.dsh-shortcuts-table tbody tr:last-child th, .dsh-shortcuts-table tbody tr:last-child td { border-bottom: 0; }
.dsh-shortcuts-table tbody th { font-weight: var(--dsh-ui-weight-regular); }

/* 窄窗：内容内边距收窄、写作预览落回文档流；导航列在 <760px 换成触发行+抽屉。 */
@media (max-width: 900px) {
  .dsh-settings-page__content { padding: var(--dsh-ui-space-4) var(--dsh-ui-space-3) var(--dsh-ui-space-8); }
  .dsh-writing-settings { grid-template-columns: minmax(0, 1fr); }
  .dsh-settings-preview { position: static; }
  .dsh-settings-preview__paper { max-width: none; }
}

/* ── 分区内容（自 legacy styles.ts 迁入）：行/块度量与控件高度的局部覆盖 ── */
.radix-themes .dsh-settings-page { font: 400 var(--dsh-ui-text-base)/1.5 var(--dsh-ui-font-ui); color: var(--dsh-ui-text); --control-h: 34px; }
.radix-themes .dsh-settings-section > :is(.settings-general,.models-page,.usage-page) { display: grid; gap: var(--dsh-ui-space-5); }
.radix-themes .dsh-settings-page .settings-row { min-height: 56px; gap: var(--dsh-ui-space-4); padding-block: var(--dsh-ui-space-3); }
.radix-themes .settings-row-title { font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-regular); }
.radix-themes .settings-row-text { flex: 1; }
.radix-themes .settings-row-description { font-size: var(--dsh-ui-text-sm); line-height: 1.5; color: var(--dsh-ui-muted); }
.radix-themes .dsh-settings-page .dsh-button { font-size: var(--dsh-ui-text-base); min-height: var(--control-h); }
.radix-themes .dsh-settings-page :is(input,textarea,select) { font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-base); }
.radix-themes .dsh-settings-page .dsh-input { min-height: var(--control-h); }
.radix-themes .dsh-settings-page .dsh-notice { color: var(--dsh-ui-accent); }
.radix-themes .dsh-settings-page :is(p,small,.muted) { line-height: 1.5; }
.radix-themes .dsh-settings-page :is(button,input,textarea,summary,a,[tabindex]):focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; }
.radix-themes .dsh-settings-page :is(.models-hint,.models-warning,.about-note) { overflow-wrap: anywhere; }
.radix-themes .dsh-settings-page .author-preferences textarea { field-sizing: content; min-height: 156px; max-height: min(320px, 40dvh); line-height: 1.7; }
.radix-themes .dsh-settings-page .models-writing-route { display: grid; grid-template-columns: 112px minmax(0,1fr) 16px; }
.radix-themes .dsh-settings-page .models-writing-route-controls { justify-content: flex-end; }
.radix-themes .dsh-settings-page .models-writing-route-controls > .select { flex: 1; min-width: 0; }
.radix-themes .dsh-settings-page .models-writing-route-controls .select-trigger { width: 100%; }
.radix-themes .dsh-settings-page .models-writing-route .model-effort .select-trigger { min-width: 72px; }
.radix-themes .dsh-settings-page .models-field-row { grid-template-columns: 112px minmax(0,1fr); }
.radix-themes .dsh-settings-page .models-editor-actions { flex-wrap: wrap; }
.radix-themes .dsh-settings-page .models-row-card, .radix-themes .dsh-settings-page .models-add-card { padding: var(--dsh-ui-space-4); }
.radix-themes .dsh-settings-page .usage-section-title { margin-bottom: var(--dsh-ui-space-3); }
.radix-themes .dsh-settings-page .usage-card-value { font-size: var(--dsh-ui-text-2xl); font-weight: 600; font-variant-numeric: tabular-nums; }
.radix-themes .about-page { display: block; flex: 1; min-width: 0; }
.radix-themes .about-copy { min-width: 0; }
.radix-themes .about-status, .radix-themes .about-status .dsh-notice { width: fit-content; max-width: 100%; }
.radix-themes .about-error { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.radix-themes .app-mascot { display: block; height: auto; user-select: none; pointer-events: none; }
.radix-themes .about-release-body { white-space: pre-wrap; max-height: 220px; overflow: auto; margin-block: var(--dsh-ui-space-2) var(--dsh-ui-space-3); }
@media(max-width:1100px) {
  .radix-themes .dsh-settings-page .settings-row { flex-wrap: wrap; }
  .radix-themes .dsh-settings-page .models-writing-route { grid-template-columns: 96px minmax(0,1fr) 16px; }
}
@media(max-width:760px) {
  .radix-themes .dsh-settings-page .settings-row { align-items: flex-start; flex-direction: column; gap: var(--dsh-ui-space-2); }
  .radix-themes .dsh-settings-page .models-writing-route { display: flex; }
  .radix-themes .dsh-settings-page .models-writing-route-controls { width: 100%; }
  .radix-themes .dsh-settings-page .models-field-row { grid-template-columns: minmax(0,1fr); }
}

/* 写作/助手分区容器与排版预览行。 */
.radix-themes .writing-settings,
.radix-themes .assistant-settings { display: flex; flex-direction: column; gap: var(--dsh-ui-space-5); width: 100%; }
.radix-themes .writing-settings .paper-typography .slider-row { width: 100%; padding-block: var(--dsh-ui-space-3); }
.radix-themes .writing-settings .slider-value { font-variant-numeric: tabular-nums; }
.radix-themes .writing-progress-settings .goal-saving { display: inline-flex; align-items: center; margin-inline-start: 6px; color: var(--dsh-ui-muted); vertical-align: middle; }
.radix-themes .writing-progress-settings .goal-saving .activity-dots { margin-inline-end: 0; }

/* 宿主 Select 在设置页的尺寸约束（触发器本体在 ui/select.styles.ts）。 */
.radix-themes .dsh-settings-page .select-trigger { min-width: 184px; max-width: 100%; min-height: var(--control-h); font-size: var(--dsh-ui-text-base); }
.radix-themes .dsh-settings-page .select-trigger[data-placeholder] { color: var(--dsh-ui-muted); }
.radix-themes .models-writing-route-controls > .select { flex: 0 1 18rem; min-width: 12rem; max-width: 100%; }
.radix-themes .models-writing-route .model-effort .select-trigger { width: auto; }

/* 模型分区：行卡、编辑器、凭据点、候选对话框。 */
.radix-themes .models-rows { margin: 0; padding: 0; list-style: none; }
.radix-themes .models-add-card { border: 0; }
.radix-themes .models-editor { display: grid; gap: var(--dsh-ui-space-3); }
.radix-themes .models-input-id { flex: 1 1 200px; }
.radix-themes .models-input-name { flex: 1 1 200px; }
.radix-themes .models-field-row { display: grid; grid-template-columns: 120px minmax(0, 1fr); align-items: center; gap: var(--dsh-ui-space-3); }
.radix-themes .models-credential-dot { width: 8px; height: 8px; flex: none; border-radius: var(--dsh-ui-radius-full); corner-shape: round; }
.radix-themes .models-credential-dot-configured { background: var(--dsh-ui-success); }
.radix-themes .models-credential-dot-missing { background: var(--dsh-ui-danger); }
.radix-themes .models-button-add { align-self: flex-start; }
.radix-themes .models-customized > summary { cursor: pointer; list-style: none; }
.radix-themes .models-customized > summary::-webkit-details-marker { display: none; }
.radix-themes .models-overlay { z-index: 50; }
.radix-themes .models-candidate-dialog { width: min(560px, 100%); max-height: min(640px, calc(100dvh - 48px)); }
.radix-themes .models-candidate-list { display: grid; gap: var(--dsh-ui-space-1); margin: 0; padding: 0; list-style: none; max-height: 360px; overflow: auto; }
.radix-themes .models-candidate-dialog .models-candidate-label { display: flex; align-items: center; gap: var(--dsh-ui-space-2); }
.radix-themes .models-loading { max-width: 480px; margin-top: 12px; }

/* 用量分区：图表与日志行。 */
.radix-themes .usage-chart-plot { width: 100%; height: 200px; min-height: 160px; max-height: 220px; }
.usage-chart-tooltip { max-width: min(280px, calc(100vw - 32px)); white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.radix-themes .usage-chart-legend { margin: 0; padding: 0; list-style: none; }
.radix-themes .usage-chart-legend li { display: inline-flex; align-items: center; gap: var(--dsh-ui-space-2); }
.radix-themes .usage-chart-chip { width: 10px; height: 10px; flex: none; border-radius: var(--dsh-ui-radius-sm); }
.radix-themes .usage-log-list { margin: 0; padding: 0; list-style: none; }
.radix-themes .usage-log-row {
  display: grid; grid-template-columns: 7.5rem minmax(0, 1fr) auto; align-items: center; gap: var(--dsh-ui-space-3);
  padding: var(--dsh-ui-space-2) 0; border-bottom: 1px solid var(--dsh-ui-line);
}
.radix-themes .usage-log-row:last-child { border-bottom: 0; }
.radix-themes .usage-log-time { font-variant-numeric: tabular-nums; white-space: nowrap; }
.radix-themes .usage-log-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.radix-themes .usage-log-tokens { font-variant-numeric: tabular-nums; white-space: nowrap; }
.radix-themes .usage-loading { max-width: 420px; margin-top: 12px; }

/* ── 插件目录（自适配层迁入）：一行一张平卡，一个主控件，无阴影 ── */
.radix-themes .plugins-trigger:not(:where([data-dsh-plugin-surface], [data-dsh-plugin-surface] *)) { -webkit-app-region: no-drag; }
.radix-themes .plugins-catalog { display: flex; flex-direction: column; gap: var(--dsh-ui-space-6); min-width: 0; }
.radix-themes .plugins-catalog-section { display: flex; flex-direction: column; gap: var(--dsh-ui-space-3); min-width: 0; }
.radix-themes .plugins-catalog-head { min-width: 0; }
.radix-themes .plugins-catalog-rows { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); list-style: none; margin: 0; padding: 0; }
.radix-themes .plugins-catalog-row {
  display: flex; align-items: center; gap: var(--dsh-ui-space-3);
  padding: var(--dsh-ui-space-3); min-width: 0;
  background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-xl); box-shadow: none;
}
.radix-themes .plugins-catalog-icon {
  width: var(--dsh-ui-control-lg); height: var(--dsh-ui-control-lg); flex: none;
  border-radius: var(--dsh-ui-radius-md); background: var(--dsh-ui-surface); color: var(--dsh-ui-muted);
  display: flex; align-items: center; justify-content: center; font-weight: var(--dsh-ui-weight-strong);
}
/* 品牌图占满同一图标位；contain 保证超大 SVG 落在圆角瓦片内。 */
.radix-themes .plugins-catalog-icon-image { width: 100%; height: 100%; object-fit: contain; border-radius: inherit; display: block; }
.radix-themes .plugins-catalog-row-text { display: flex; flex-direction: column; gap: var(--dsh-ui-space-1); flex: 1 1 auto; min-width: 0; }
.radix-themes .plugins-catalog-row-head { flex-wrap: wrap; min-width: 0; }
.radix-themes .plugins-catalog-row-title { min-width: 0; overflow-wrap: anywhere; font-weight: var(--dsh-ui-weight-medium); }
/* 行内描述单行截断，全文在行 tooltip。 */
.radix-themes .plugins-catalog-row-desc { margin: 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.radix-themes .plugins-catalog-row-action { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: var(--dsh-ui-space-2); min-width: var(--dsh-ui-control-lg); }
/* 配置/详情是同类控件：ghost 按钮 hover 出底。详情是目录里最高频动作，
   --dsh-ui-text 在 raised 行面上两主题均过 4.5:1，行内唯一填充控件是开关。 */
.radix-themes .plugins-catalog-action {
  height: auto; min-height: var(--dsh-ui-control-sm); padding: 0 var(--dsh-ui-space-2);
  border: 0; background: transparent; box-shadow: none;
  color: var(--dsh-ui-text); font-weight: var(--dsh-ui-weight-medium);
}
.radix-themes .plugins-catalog-action:hover { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); }
/* 新装的用户卡在原地宣告：一过性 accent 染色回落到常态卡面；时长由
   slow 动效 token 合成，客户端读同一计算值移除 class。 */
.radix-themes .plugins-catalog-row.is-new { animation: plugins-catalog-installed calc(var(--dsh-ui-duration-slow) * 4) var(--dsh-ui-ease-out); }
@keyframes plugins-catalog-installed { from, 30% { background: var(--dsh-ui-accent-soft); border-color: var(--dsh-ui-accent-border); } to { background: var(--dsh-ui-raised); border-color: var(--dsh-ui-line-strong); } }
.radix-themes .plugins-catalog-subsection { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-3); border-top: 0.5px solid var(--dsh-ui-line); }
.radix-themes .plugins-catalog-subsection-title { color: var(--dsh-ui-muted); font-weight: var(--dsh-ui-weight-medium); }
.radix-themes .plugins-catalog-hint, .radix-themes .plugins-catalog-empty, .radix-themes .plugins-catalog-preset-locked { margin: 0; color: var(--dsh-ui-muted); }
.radix-themes .plugins-catalog-advanced > summary { cursor: pointer; color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); font-weight: var(--dsh-ui-weight-medium); min-height: var(--dsh-ui-control-sm); padding-block: var(--dsh-ui-space-2); }
.radix-themes .plugins-catalog-advanced[open] > summary, .radix-themes .plugins-catalog-advanced .plugins-catalog-hint { margin-bottom: var(--dsh-ui-space-2); }
`)
