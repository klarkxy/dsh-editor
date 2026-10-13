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

/* 窄窗：导航收成紧凑列；写作预览落回文档流。 */
@media (max-width: 900px) {
  .dsh-settings-page__layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .dsh-settings-page__nav {
    flex-direction: row; flex-wrap: wrap; align-items: flex-start; gap: var(--dsh-ui-space-1);
    padding: var(--dsh-ui-space-3); border-right: 0; border-bottom: 0.5px solid var(--dsh-ui-line);
    max-height: 40vh;
  }
  .dsh-settings-nav-group { flex: 1 1 100%; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .dsh-settings-nav-group + .dsh-settings-nav-group { margin-top: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-2); }
  .dsh-settings-nav-group__label { flex: 1 1 100%; padding-bottom: 0; }
  .dsh-settings-nav-group .dsh-list-row { width: auto; flex: none; }
  .dsh-settings-config { flex-direction: row; flex-wrap: wrap; align-items: center; }
  .dsh-settings-config__label { flex: 1 1 100%; }
  .dsh-settings-config .dsh-input, .dsh-settings-config .dsh-search-field { flex: 1 1 12rem; min-width: 0; }
  .dsh-settings-config__links { flex: 1 1 100%; }
  .dsh-settings-page__content { padding: var(--dsh-ui-space-4) var(--dsh-ui-space-3) var(--dsh-ui-space-8); }
  .dsh-writing-settings { grid-template-columns: minmax(0, 1fr); }
  .dsh-settings-preview { position: static; }
  .dsh-settings-preview__paper { max-width: none; }
}
`)
