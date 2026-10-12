import { defineStyles } from '../design-system/layers.ts'

defineStyles('dsh.components', 'dsh-slider', `
.dsh-slider-row { display: flex; align-items: center; gap: var(--dsh-ui-space-3); min-height: 32px; }
.dsh-slider-row__label { font-size: var(--dsh-ui-text-sm); flex: none; }
.dsh-slider-row__value { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); flex: none; min-width: 3ch; text-align: end; }
.dsh-slider {
  position: relative; display: flex; align-items: center; flex: 1;
  height: 20px; min-width: 80px; touch-action: none; user-select: none;
}
.dsh-slider__track {
  position: relative; flex: 1; height: 3px; border-radius: var(--dsh-ui-radius-full);
  background: var(--dsh-ui-line-strong); overflow: hidden;
}
.dsh-slider__range { position: absolute; height: 100%; background: var(--dsh-ui-brand); }
.dsh-slider__thumb {
  display: block; width: 14px; height: 14px; border-radius: var(--dsh-ui-radius-full);
  background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong);
  box-shadow: var(--dsh-ui-elevation-soft); cursor: pointer;
}
.dsh-slider__thumb:focus-visible { box-shadow: var(--dsh-ui-elevation-focus); }
.dsh-slider[data-disabled] .dsh-slider__thumb { cursor: default; }
.dsh-slider[data-disabled] { opacity: 0.5; }
@media (forced-colors: active) {
  .dsh-slider__range { background: Highlight; }
}
`)
