import { defineStyles } from '../../design-system/layers.ts'

/*
 * 搭档栏样式（shell-rewrite-spec §5）：页头、对话列表 Popover、空状态建议、
 * 作者气泡与单行执行记录 Disclosure。结构钩子沿用 .chat/.composer，新
 * 视觉只落在 dsh-partner__* 类上。
 */
defineStyles('dsh.surfaces', 'dsh-partner', `
/* ── 页头：标题按钮 + 右侧新对话 SplitButton ─────────────────── */
.chat-header.dsh-partner__head {
  display: flex; align-items: center; gap: var(--dsh-ui-space-2);
  min-width: 0; padding-inline: var(--dsh-ui-space-2);
}
.dsh-partner__title {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--dsh-ui-space-1);
  min-height: var(--dsh-ui-control-md); padding-inline: var(--dsh-ui-space-2);
  border: 0; border-radius: var(--dsh-ui-radius-md); background: transparent;
  color: var(--dsh-ui-text); font: inherit; font-weight: var(--dsh-ui-weight-medium); cursor: pointer;
}
.dsh-partner__title:hover:not(:disabled) { background: var(--dsh-ui-hover); }
.dsh-partner__title:disabled { cursor: default; }
.dsh-partner__title:focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: -2px; }
.dsh-partner__title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-partner__title > svg { flex: none; color: var(--dsh-ui-muted); }
.dsh-partner__actions { flex: none; display: flex; align-items: center; gap: var(--dsh-ui-space-1); }
.dsh-partner__actions .chat-status { display: inline-flex; align-items: center; gap: var(--dsh-ui-space-1); }

/* ── 对话列表 Popover ──────────────────────────────────────── */
.dsh-partner__list { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); width: 19rem; max-width: calc(100vw - 32px); }
.dsh-partner__list .dsh-segmented { flex: none; }
.dsh-partner__rows { display: flex; flex-direction: column; gap: 1px; max-height: min(20rem, 60dvh); overflow: auto; min-width: 0; }
.dsh-partner__list-empty { margin: 0; padding: var(--dsh-ui-space-3); color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); }
.dsh-partner__rows .dsh-list-row__leading { color: var(--dsh-ui-muted); }
.dsh-partner__rows .dsh-list-row__meta { color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs); }
.dsh-partner__row-menu { flex: none; display: inline-flex; }

/* ── 空状态起步建议 ────────────────────────────────────────── */
.dsh-partner__empty { margin-block: auto; padding-block: var(--dsh-ui-space-5); }
.dsh-partner__suggestions { display: flex; flex-direction: column; gap: var(--dsh-ui-space-2); width: min(19rem, 100%); }
.dsh-partner__suggest {
  display: block; width: 100%; text-align: start;
  min-height: var(--dsh-ui-control-md); padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3);
  border: 0.5px solid var(--dsh-ui-line-strong); border-radius: var(--dsh-ui-radius-lg);
  background: var(--dsh-ui-raised); color: var(--dsh-ui-text);
  font: inherit; font-size: var(--dsh-ui-text-sm); cursor: pointer;
}
.dsh-partner__suggest:hover { background: var(--dsh-ui-hover); }
.dsh-partner__suggest:focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; }

/* ── 作者气泡：右对齐、bubble 底、radius-xl，无卡片描边 ──────── */
.chat-row.user > .dsh-partner__bubble {
  background: var(--dsh-ui-bubble); border-radius: var(--dsh-ui-radius-xl);
  padding: var(--dsh-ui-space-3) var(--dsh-ui-space-4);
}
/* 气泡正文与搭档散文同一档：chat-markdown 正文 = text-base / relaxed。
   气泡里的 Radix Text 自带 size 阶梯，显式覆盖正文行（detail/状态行
   保持 size-1 小号）。 */
.chat-row.user > .dsh-partner__bubble > .rt-Text:first-child {
  font-size: var(--dsh-ui-text-base); line-height: var(--dsh-ui-leading-relaxed);
}

/* ── 执行记录：单行 Disclosure，箭头移到行尾，内容缩进对齐标题 ── */
.chat-step .dsh-disclosure__summary { min-height: var(--dsh-ui-space-8); border-radius: var(--dsh-ui-radius-md); }
.chat-step .dsh-disclosure__summary > .dsh-disclosure__chevron { order: 2; margin-left: auto; }
.chat-step .dsh-disclosure__summary > .chat-step-head { flex: 1 1 auto; }
.chat-step .dsh-disclosure__summary:hover { background: var(--dsh-ui-hover); }
.chat-step .dsh-disclosure__summary:focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; }
.chat-step .dsh-disclosure__content > .chat-step-body {
  margin: var(--dsh-ui-space-1) 0 0 calc(14px + var(--dsh-ui-space-2));
  overflow-wrap: anywhere; word-break: break-word;
  color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm); white-space: pre-wrap;
}
.chat-step .dsh-disclosure__content > .chat-step-body > :first-child { margin-top: 0; }

/* 回合过程组：状态词跟在计数标签后，不再套 sunken 卡。 */
.chat-process .dsh-disclosure__summary { min-height: var(--dsh-ui-space-8); color: var(--dsh-ui-muted); font-weight: var(--dsh-ui-weight-medium); }
.chat-process .dsh-disclosure__summary:hover { color: var(--dsh-ui-text); }
.chat-process-state { color: var(--dsh-ui-muted); font-weight: var(--dsh-ui-weight-regular); }
.chat-process-state.is-error { color: var(--dsh-ui-danger); }
.chat-process .dsh-disclosure__content > .chat-process-body {
  margin-top: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-2);
  border-top: 0.5px solid var(--dsh-ui-line);
  display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 100%;
}
.chat-process-stack .dsh-disclosure__summary { min-height: var(--dsh-ui-space-8); color: var(--dsh-ui-muted); font-weight: var(--dsh-ui-weight-medium); }
.chat-process-stack .dsh-disclosure__content { display: flex; flex-direction: column; gap: 2px; }

/* 空状态居中：历史列撑满视口高度，empty 用 margin auto 垂直居中。 */
.chat-history .rt-ScrollAreaViewport > div { display: flex; flex-direction: column; min-height: 100%; }

/* ── Composer：ui TextArea 去描边，焦点环留给整个 composer 表面 ── */
.composer .dsh-textarea {
  min-height: 48px; padding: var(--dsh-ui-space-2);
  background: transparent; border: 0; border-radius: 0; box-shadow: none;
  font-size: var(--dsh-ui-text-base); line-height: var(--dsh-ui-leading-relaxed);
}
.composer .dsh-textarea:focus-visible { box-shadow: none; outline: 0; }
.composer .composer-note { margin-block: var(--dsh-ui-space-1) 0; }

/* 模型/思考芯片：长名截断（全称在 title）、思考档不再被压成「思…」。
   窄栏（含 760/390 抽屉）里整条工具栏保持单行：模型芯片吃掉收缩量，
   思考档不缩到标签以下，语音与发送钉在行尾。 */
.composer-model { flex: 0 1 auto; min-width: 0; }
.composer-model .select { min-width: 0; flex: 0 1 auto; display: flex; }
.composer-model .select-trigger { min-width: 0; max-width: 100%; }
.composer-model .select-trigger .rt-SelectTriggerInner {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.composer-model .model-effort .select-trigger { flex: none; min-width: max-content; max-width: 12em; overflow: hidden; text-overflow: ellipsis; }
.composer-model .model-picker { min-width: 0; }

/* 发送/停止：填充色、禁用与悬停色归 UiIconButton data-variant（primary/
   secondary）；这里只定尺寸与圆形，层序在本文件（dsh.surfaces）成立。 */
.composer-actions .send {
  width: var(--dsh-ui-control-xl); height: var(--dsh-ui-control-xl);
  min-width: var(--dsh-ui-control-xl); min-height: var(--dsh-ui-control-xl);
  margin: 0; border-radius: var(--dsh-ui-radius-full); corner-shape: round;
  transition: background var(--dsh-ui-duration-base) var(--dsh-ui-ease-out), transform var(--dsh-ui-duration-fast) var(--dsh-ui-ease-out);
}
.composer-actions .send:hover:not(:disabled) { transform: scale(1.05); }
.composer-actions .chat-stop {
  width: var(--dsh-ui-space-8); height: var(--dsh-ui-space-8);
  margin: 0; border-radius: var(--dsh-ui-radius-full); corner-shape: round;
}
@media (prefers-reduced-motion: reduce) { .composer-actions .send { transition: none; } .composer-actions .send:hover { transform: none; } }
`)
