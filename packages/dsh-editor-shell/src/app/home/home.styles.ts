import { defineStyles } from '../../design-system/layers.ts'

/*
 * 首页（shell-rewrite-spec §6）：版式取 B 稿 —— 上方「继续写作」，下方目录式
 * 最近作品（楷体名 + 点线引导 + 右对齐信息，第二行 muted 的时间与章节分开
   排）。390 宽时点线让位：第一行允许折行，信息落到自己的一行。
 */
defineStyles('dsh.surfaces', 'dsh-home', `
/* 首页自有 chrome：左侧品牌锁链（小标志），右侧命令/插件/设置。 */
.brand-lockup { display: flex; align-items: center; gap: var(--dsh-ui-space-2); flex: none; }
.brand-lockup__name { font-size: var(--dsh-ui-text-base); font-weight: var(--dsh-ui-weight-strong); color: var(--dsh-ui-text); }
.workspace-checking {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--dsh-ui-space-3); padding: var(--dsh-ui-space-8);
}
.workspace-checking__title { font-size: var(--dsh-ui-text-lg); font-weight: var(--dsh-ui-weight-strong); }
.workspace-checking__path, .dsh-home__error-path {
  font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted);
}
.dsh-home { min-height: 0; min-width: 0; overflow-y: auto; }
.dsh-home__inner {
  width: min(780px, 100%);
  margin-inline: auto;
  padding-bottom: var(--dsh-ui-space-8);
}
.dsh-home__head {
  display: flex; align-items: baseline; gap: var(--dsh-ui-space-3);
  margin-bottom: var(--dsh-ui-space-4); flex-wrap: wrap;
}
.dsh-home__title {
  margin: 0; font-family: var(--dsh-ui-font-display);
  font-size: 22px; font-weight: var(--dsh-ui-weight-regular); color: var(--dsh-ui-text);
}
.dsh-home__actions { margin-inline-start: auto; display: flex; gap: var(--dsh-ui-space-2); }

/* ── 继续写作 ─────────────────────────────────────────── */
.dsh-home-continue {
  display: flex; align-items: center; gap: var(--dsh-ui-space-4);
  padding: var(--dsh-ui-space-4) var(--dsh-ui-space-5);
  margin-bottom: var(--dsh-ui-space-6);
  background: var(--dsh-ui-raised);
  border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-xl);
}
.dsh-home-continue__text { flex: 1 1 auto; min-width: 0; }
.dsh-home-continue__label {
  display: block; font-size: var(--dsh-ui-text-xs); font-weight: var(--dsh-ui-weight-medium);
  color: var(--dsh-ui-muted); margin-bottom: var(--dsh-ui-space-1);
}
.dsh-home-continue__title {
  margin: 0; font-family: var(--dsh-ui-font-display);
  font-size: 22px; font-weight: var(--dsh-ui-weight-regular); color: var(--dsh-ui-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-home-continue__meta {
  display: flex; align-items: baseline; gap: var(--dsh-ui-space-2);
  margin-top: var(--dsh-ui-space-1); font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted);
  min-width: 0;
}
.dsh-home-continue__chapter { flex: none; color: var(--dsh-ui-text); }
.dsh-home-continue__excerpt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-home-continue__action { flex: none; }

/* ── 目录式最近作品 ───────────────────────────────────── */
.dsh-home__list { list-style: none; margin: 0; padding: 0; }
.dsh-home-row { position: relative; border-bottom: 0.5px solid var(--dsh-ui-line); }
.dsh-home-row__main {
  display: block; width: 100%; padding: var(--dsh-ui-space-3) var(--dsh-ui-space-1);
  padding-inline-end: var(--dsh-ui-control-md);
  border: 0; border-radius: var(--dsh-ui-radius-md);
  background: transparent; color: var(--dsh-ui-text); font: inherit;
  text-align: start; cursor: pointer; min-width: 0;
}
.dsh-home-row__main:hover:not(:disabled) { background: var(--dsh-ui-hover); }
.dsh-home-row__main:focus-visible { outline: 0; box-shadow: var(--dsh-ui-elevation-focus); }
.dsh-home-row__main:disabled { color: var(--dsh-ui-muted); cursor: default; }
.dsh-home-row__line1 {
  display: flex; align-items: baseline; gap: var(--dsh-ui-space-2); min-width: 0;
}
.dsh-home-row__title {
  font-family: var(--dsh-ui-font-display); font-size: var(--dsh-ui-text-xl);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.dsh-home-row__leader {
  flex: 1 1 24px; min-width: 24px;
  border-bottom: 1px dotted var(--dsh-ui-muted); transform: translateY(-4px); opacity: 0.8;
}
.dsh-home-row__info {
  flex: none; font-size: var(--dsh-ui-text-sm); color: var(--dsh-ui-muted);
  font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 50%;
}
.dsh-home-row__line2 {
  display: flex; gap: var(--dsh-ui-space-4); flex-wrap: wrap;
  margin-top: var(--dsh-ui-space-1); font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted);
}
.dsh-home-row__meta { min-width: 0; color: var(--dsh-ui-muted); }
.dsh-home-row__manage {
  position: absolute; inset-inline-end: 0; top: var(--dsh-ui-space-3);
}
.dsh-home-row__menu-anchor { width: 0; height: 0; padding: 0; border: 0; background: transparent; }
.dsh-home-row__relocation { margin: var(--dsh-ui-space-2) var(--dsh-ui-space-1) var(--dsh-ui-space-3); }
.dsh-home-row__relocation .dsh-home-row__relocation-actions,
.dsh-home-row__relocation-actions { display: inline-flex; gap: var(--dsh-ui-space-2); margin-top: var(--dsh-ui-space-2); }
.dsh-home__empty { margin-top: var(--dsh-ui-space-8); }
.dsh-home__empty .dsh-empty-state__actions { display: inline-flex; gap: var(--dsh-ui-space-2); }
.dsh-home__intent { margin-bottom: var(--dsh-ui-space-4); }
.dsh-home__intent code { display: block; font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
.dsh-home__intent-actions { display: inline-flex; gap: var(--dsh-ui-space-2); margin-top: var(--dsh-ui-space-2); }

/* 390 抽屉宽度：继续卡片允许竖排，点线引号让位（信息折到自己的一行）。 */
@media (max-width: 520px) {
  .dsh-home-continue { flex-direction: column; align-items: stretch; }
  .dsh-home-continue__action { align-self: flex-start; }
  .dsh-home-row__line1 { flex-wrap: wrap; }
  .dsh-home-row__leader { display: none; }
  .dsh-home-row__info { flex-basis: 100%; max-width: 100%; }
}
`)
