import { defineStyles } from '../design-system/layers.ts'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/*
 * 搭档对话（chat.tsx / chat-history.tsx / chat-cards.tsx）：结构与外观合一。
 * 窄窗抽屉是 Portal，挂在 .shell 之外，所有规则对 :is(.shell, .dsh-drawer)
 * 两种宿主一致。dsh-partner__* 的搭档栏细节在 app/assistant 同层 sheet。
 */
defineStyles('dsh.surfaces', 'dsh-chat', `
:is(.shell, .dsh-drawer) .chat {
  height: 100%; position: relative; width: 100%; max-width: 100%;
  min-width: 0; min-height: 0; overflow-x: hidden;
  display: flex; flex-direction: column;
  background: var(--dsh-ui-sidebar);
}
:is(.shell, .dsh-drawer) .chat > * { min-width: 0; max-width: 100%; }
:is(.shell, .dsh-drawer) .chat-header {
  flex-shrink: 0; min-height: var(--dsh-ui-header-height);
  border-bottom: 0; background: var(--dsh-ui-sidebar);
}
:is(.shell, .dsh-drawer) .chat-status { font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted); }
:is(.shell, .dsh-drawer) .chat > .chat-history { flex: 1 1 0%; min-width: 0; min-height: 0; height: auto; overflow: hidden; }
:is(.shell, .dsh-drawer) .chat-history .dsh-scroll-area { overscroll-behavior: contain; }
:is(.shell, .dsh-drawer) .chat-history .dsh-scroll-area > .dsh-flex { min-height: 100%; gap: var(--dsh-ui-space-6); padding: var(--dsh-ui-space-5); }

.radix-themes .chat-row { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
:is(.shell, .dsh-drawer) .chat-row.user { align-self: flex-end; width: fit-content; max-width: 92%; }
/* 搭档回复与作者气泡同用 UI 正文号（无独立聊天字号设置；原稿基准 14px），
   标题/列表在 prose 内保持相对层级。 */
:is(.shell, .dsh-drawer) :is(.chat-row.assistant, .chat-markdown) {
  font-family: var(--dsh-ui-font-ui); font-size: var(--dsh-ui-text-base);
  font-weight: var(--dsh-ui-weight-regular); line-height: var(--dsh-ui-leading-relaxed);
  color: var(--dsh-ui-text);
}
:is(.shell, .dsh-drawer) .chat-row.notice {
  padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3);
  background: var(--dsh-ui-surface); border-left: 2px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-sm); color: var(--dsh-ui-muted);
}
.radix-themes .chat-row.chat-row-enter { animation: shell-message-in 200ms both; }
:is(.shell, .dsh-drawer) .chat > .composer {
  flex-shrink: 0; width: auto;
  margin: var(--dsh-ui-space-2) var(--dsh-ui-space-2) var(--dsh-ui-space-3);
  padding: var(--dsh-ui-space-2);
  background: var(--dsh-ui-raised); border: 0;
  border-radius: var(--dsh-ui-radius-panel); box-shadow: var(--dsh-ui-elevation-soft);
  transition: box-shadow var(--dsh-ui-duration-base) var(--dsh-ui-ease-out);
}
:is(.shell, .dsh-drawer) .chat > .composer:focus-within { border: 0; box-shadow: var(--dsh-ui-elevation-focus); }
:is(.shell, .dsh-drawer) .composer-toolbar {
  gap: var(--dsh-ui-space-2); min-height: var(--dsh-ui-space-8);
  margin-top: var(--dsh-ui-space-2); padding-top: var(--dsh-ui-space-2);
  border-top: 0.5px solid var(--dsh-ui-line);
}
/* 语音输入是可选插件面：空闲时是发送旁一枚紧凑触发，激活采集占首个换行。
   order/flex-basis 是结构放置；插件缺席时不产生 flex 项。 */
:is(.shell, .dsh-drawer) .composer-voice { display: flex; align-items: center; flex-shrink: 0; min-width: 0; }
:is(.shell, .dsh-drawer) .composer-voice:not(:has(> div:not(:empty))) { display: none; }
:is(.shell, .dsh-drawer) .composer-voice-expanded { order: -1; flex-basis: 100%; }
:is(.shell, .dsh-drawer) .composer-model { min-width: 0; }
:is(.shell, .dsh-drawer) .composer-model .select-trigger {
  min-height: var(--dsh-ui-control-sm); max-width: 100%;
  border: 0; box-shadow: none; background: transparent;
  color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-sm);
}
@media (max-width: 760px) {
  :is(.shell, .dsh-drawer) .chat > .composer { margin: var(--dsh-ui-space-2); }
}

/* ── 提案卡（chat-cards.tsx）：扁平 raised + line-strong，无侧边色条 ── */
:is(.shell, .dsh-drawer) .proposal-card {
  background: var(--dsh-ui-raised); border: 0.5px solid var(--dsh-ui-line-strong);
  border-radius: var(--dsh-ui-radius-xl); box-shadow: none; padding: var(--dsh-ui-space-5);
}
:is(.shell, .dsh-drawer) .proposal-card > strong {
  font-size: var(--dsh-ui-text-md); font-weight: var(--dsh-ui-weight-strong);
  color: var(--dsh-ui-text); display: block; margin-bottom: var(--dsh-ui-space-3);
}
:is(.shell, .dsh-drawer) .proposal-card pre {
  max-height: min(48dvh, 28rem); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  border: 0.5px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-md);
  padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3);
  background: var(--dsh-ui-surface); color: var(--dsh-ui-text);
  box-shadow: none; scrollbar-gutter: stable;
}
:is(.shell, .dsh-drawer) .proposal-actions { display: flex; flex-wrap: wrap; gap: var(--dsh-ui-space-2); align-items: center; }
/* 主操作组占据整行剩余宽度,把 ghost「稍后处理」顶到行尾;放不下时
   「稍后处理」整行落到第二行左对齐,不留单行右飘的孤儿按钮。 */
:is(.shell, .dsh-drawer) .proposal-actions__main { display: flex; flex: 1 1 auto; min-width: 0; flex-wrap: wrap; gap: var(--dsh-ui-space-2); justify-content: inherit; }
:is(.shell, .dsh-drawer) .proposal-path-line {
  font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-muted);
  margin: var(--dsh-ui-space-1) 0 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* §5 已结算卡：Disclosure 摘要单行 —— chevron + 路径/标题/状态。 */
:is(.shell, .dsh-drawer) .proposal-card-settled .dsh-disclosure__summary { min-height: var(--dsh-ui-space-8); border-radius: var(--dsh-ui-radius-md); padding-inline: var(--dsh-ui-space-1); }
:is(.shell, .dsh-drawer) .proposal-card-settled .dsh-disclosure__summary:hover { background: var(--dsh-ui-hover); }
:is(.shell, .dsh-drawer) .proposal-card-settled .dsh-disclosure__summary:focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: 2px; }
:is(.shell, .dsh-drawer) .proposal-settled__row { flex: 1 1 auto; min-width: 0; flex-wrap: nowrap; }
:is(.shell, .dsh-drawer) .proposal-settled__row .proposal-meta { flex: none; flex-wrap: nowrap; min-width: 0; }
:is(.shell, .dsh-drawer) .proposal-settled__row .proposal-path { max-width: 12em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:is(.shell, .dsh-drawer) .proposal-settled__row .proposal-heading { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; }
:is(.shell, .dsh-drawer) .proposal-settled__row .proposal-status { flex: none; }
:is(.shell, .dsh-drawer) .proposal-card-settled .dsh-disclosure__content { min-width: 0; margin-top: var(--dsh-ui-space-3); padding-top: var(--dsh-ui-space-3); border-top: 0.5px solid var(--dsh-ui-line); }

/* 待处理提案粘性条：吸顶满宽实底条 + 底部分隔线,按钮居中;
   不再用浮起的圆角药丸,滚动内容从条下经过时不再压住卡片头。 */
:is(.shell, .dsh-drawer) .chat-proposal-pill {
  position: sticky; top: 0; z-index: var(--dsh-ui-z-sticky);
  align-self: stretch;
  /* 内容列内边距是 space-5（.chat-history .dsh-scroll-area > .dsh-flex）：
     负 margin 让实底条与底线吃满整条线宽，而不是停在内容列内。 */
  margin-inline: calc(-1 * var(--dsh-ui-space-5));
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
  gap: var(--dsh-ui-space-2); padding: var(--dsh-ui-space-2) var(--dsh-ui-space-5);
  background: var(--dsh-ui-surface);
  border-bottom: 0.5px solid var(--dsh-ui-line);
}
/* 吸顶条高度约 control-sm + 2×space-2 + 0.5px 线;滚到卡片时让卡片头
   落在条下方(scrollIntoView 也吃 scroll-margin)。 */
:is(.shell, .dsh-drawer) .proposal-card { scroll-margin-top: calc(var(--dsh-ui-control-sm) + var(--dsh-ui-space-5)); }

/* 编辑提案 hunk 差异：3 行上下文、加删按 token 着色、未改动段折叠，
   超过 max-height 内部滚动（新建文件提案仍是全文块，不走这里）。 */
:is(.shell, .dsh-drawer) .proposal-hunks {
  max-height: min(48dvh, 28rem); overflow: auto; scrollbar-gutter: stable;
  border: 0.5px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-md);
  background: var(--dsh-ui-surface); color: var(--dsh-ui-text);
  font-family: var(--dsh-ui-font-mono); font-size: var(--dsh-ui-text-sm);
  line-height: var(--dsh-ui-leading-normal);
}
:is(.shell, .dsh-drawer) .proposal-hunk-line {
  display: flex; min-width: 0; padding-inline: var(--dsh-ui-space-2);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
:is(.shell, .dsh-drawer) .proposal-hunk-line.is-context { color: var(--dsh-ui-muted); }
:is(.shell, .dsh-drawer) .proposal-hunk-line.is-del { background: var(--dsh-ui-danger-soft); color: var(--dsh-ui-danger); }
:is(.shell, .dsh-drawer) .proposal-hunk-line.is-add { background: var(--dsh-ui-success-soft); color: var(--dsh-ui-success); }
:is(.shell, .dsh-drawer) .proposal-hunk-sign { flex: none; width: 1ch; user-select: none; }
:is(.shell, .dsh-drawer) .proposal-hunk-gap {
  display: block; width: 100%; min-height: var(--dsh-ui-control-sm);
  padding-inline: var(--dsh-ui-space-3); border: 0;
  border-block: 0.5px solid var(--dsh-ui-line);
  background: var(--dsh-ui-raised); color: var(--dsh-ui-muted);
  font: inherit; font-size: var(--dsh-ui-text-xs); text-align: center; cursor: pointer;
}
:is(.shell, .dsh-drawer) .proposal-hunk-gap:hover { background: var(--dsh-ui-hover); color: var(--dsh-ui-text); }
:is(.shell, .dsh-drawer) .proposal-hunk-gap:focus-visible { outline: 2px solid var(--dsh-ui-accent); outline-offset: -2px; }

/* 迁移提示横幅（chat-cards.tsx）。 */
.radix-themes .migration-banner .migration-banner-actions { display: inline-flex; align-items: center; gap: var(--dsh-ui-space-2); margin-top: var(--dsh-ui-space-2); }

/* DSH TurnProcessNodeView + DisclosureRow：执行过程块。 */
:is(.shell, .dsh-drawer) .chat-process,
:is(.shell, .dsh-drawer) .chat-process-stack { min-width: 0; max-width: 100%; overflow-x: hidden; }
:is(.shell, .dsh-drawer) .chat-process-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: normal;
}
:is(.shell, .dsh-drawer) .chat-process-body,
:is(.shell, .dsh-drawer) .chat-process-stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 100%; }
:is(.shell, .dsh-drawer) .chat-process-body { padding-top: var(--dsh-ui-space-1); }
:is(.shell, .dsh-drawer) .chat-step { min-width: 0; max-width: 100%; overflow-x: hidden; }
:is(.shell, .dsh-drawer) .chat-step-head { min-width: 0; max-width: 100%; height: var(--dsh-ui-space-8); overflow: hidden; font-size: var(--dsh-ui-text-sm); }
:is(.shell, .dsh-drawer) .chat-step-mark { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 14px; width: 14px; height: 14px; color: var(--dsh-ui-faint); }
:is(.shell, .dsh-drawer) .chat-step-status,
:is(.shell, .dsh-drawer) .chat-step-error-dot { width: 6px; height: 6px; border-radius: var(--dsh-ui-radius-full); background: var(--dsh-ui-faint); }
:is(.shell, .dsh-drawer) .chat-step-status.is-ok { background: var(--dsh-ui-success); }
:is(.shell, .dsh-drawer) .chat-step-status.is-error,
:is(.shell, .dsh-drawer) .chat-step-error-dot { background: var(--dsh-ui-danger); }
:is(.shell, .dsh-drawer) .chat-step-mark .activity-dots { margin-inline-end: 0; }
:is(.shell, .dsh-drawer) .chat-step-label { flex: none; }
:is(.shell, .dsh-drawer) .chat-step-dot { flex: none; width: 2px; height: 2px; border-radius: var(--radius-1); background: var(--dsh-ui-faint); }
:is(.shell, .dsh-drawer) .chat-step-preview { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:is(.shell, .dsh-drawer) .chat-step-body {
  min-width: 0; max-width: 100%;
  margin: var(--dsh-ui-space-1) 0 0 calc(14px + var(--dsh-ui-space-2));
  overflow-wrap: anywhere; word-break: break-word;
  color: var(--dsh-ui-muted); font-size: var(--dsh-ui-text-xs);
  line-height: var(--line-height-1); white-space: pre-wrap;
}
:is(.shell, .dsh-drawer) .chat-step-body > :first-child { margin-top: 0; }
:is(.shell, .dsh-drawer) .chat-step-code,
:is(.shell, .dsh-drawer) .chat-step-body pre {
  max-height: 16rem; overflow: auto; margin: var(--dsh-ui-space-1) 0 0; max-width: 100%;
  padding: var(--dsh-ui-space-3); border: 0.5px solid var(--dsh-ui-line);
  border-radius: var(--dsh-ui-radius-lg); background: var(--dsh-ui-surface); box-shadow: none;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  font-family: var(--dsh-ui-font-mono); font-size: var(--dsh-ui-text-xs); color: var(--dsh-ui-text);
}

/* 正文 prose：Markdown 渲染块。 */
:is(.shell, .dsh-drawer) .chat-markdown > :first-child { margin-top: 0; }
:is(.shell, .dsh-drawer) .chat-markdown > :last-child { margin-bottom: 0; }
:is(.shell, .dsh-drawer) .chat-markdown h1, :is(.shell, .dsh-drawer) .chat-markdown h2, :is(.shell, .dsh-drawer) .chat-markdown h3,
:is(.shell, .dsh-drawer) .chat-markdown h4, :is(.shell, .dsh-drawer) .chat-markdown h5, :is(.shell, .dsh-drawer) .chat-markdown h6 {
  margin-top: var(--dsh-ui-space-3); margin-bottom: var(--dsh-ui-space-2);
  font-weight: var(--dsh-ui-weight-strong); line-height: var(--dsh-ui-leading-normal);
}
:is(.shell, .dsh-drawer) .chat-markdown h1,
:is(.shell, .dsh-drawer) .chat-markdown h2 { font-size: var(--dsh-ui-text-2xl); margin-bottom: var(--dsh-ui-space-3); line-height: var(--dsh-ui-leading-tight); }
:is(.shell, .dsh-drawer) .chat-markdown h3 { font-size: var(--dsh-ui-text-xl); line-height: var(--dsh-ui-leading-tight); }
:is(.shell, .dsh-drawer) .chat-markdown h4 { font-size: var(--dsh-ui-text-md); }
:is(.shell, .dsh-drawer) .chat-markdown h5, :is(.shell, .dsh-drawer) .chat-markdown h6 { font-size: var(--dsh-ui-text-base); }
:is(.shell, .dsh-drawer) .chat-markdown p { margin: 0 0 var(--dsh-ui-space-4); }
:is(.shell, .dsh-drawer) .chat-markdown ul, :is(.shell, .dsh-drawer) .chat-markdown ol { margin: 0 0 var(--dsh-ui-space-2); padding-left: var(--dsh-ui-space-5); }
:is(.shell, .dsh-drawer) .chat-markdown li { margin-block: var(--dsh-ui-space-2); }
:is(.shell, .dsh-drawer) .chat-markdown blockquote {
  margin: 0 0 var(--dsh-ui-space-2); padding-left: var(--dsh-ui-space-3);
  border-left: 2px solid var(--dsh-ui-line); color: var(--dsh-ui-muted);
}
:is(.shell, .dsh-drawer) .chat-markdown hr { margin: var(--dsh-ui-space-3) 0; border: 0; border-top: 1px solid var(--dsh-ui-line); }
:is(.shell, .dsh-drawer) .chat-markdown code {
  padding: 0 var(--dsh-ui-space-1); border-radius: var(--dsh-ui-radius-xs);
  background: var(--dsh-ui-surface); font-family: var(--dsh-ui-font-mono);
}
:is(.shell, .dsh-drawer) .chat-markdown pre {
  max-height: 15rem; overflow: auto; margin: 0 0 var(--dsh-ui-space-2);
  padding: var(--dsh-ui-space-2) var(--dsh-ui-space-3);
  border: 0.5px solid var(--dsh-ui-line); border-radius: var(--dsh-ui-radius-lg);
  background: var(--dsh-ui-surface); box-shadow: none;
  white-space: pre-wrap; max-width: 100%; font-family: var(--dsh-ui-font-mono);
}
:is(.shell, .dsh-drawer) .chat-markdown pre code { padding: 0; background: transparent; }
:is(.shell, .dsh-drawer) .chat-markdown a { color: var(--dsh-ui-link); font-weight: var(--dsh-ui-weight-medium); text-decoration: none; text-underline-offset: 3px; }
:is(.shell, .dsh-drawer) .chat-markdown a:hover, :is(.shell, .dsh-drawer) .chat-markdown a:focus-visible { text-decoration: underline dotted; text-underline-offset: 3px; }
:is(.shell, .dsh-drawer) .chat-markdown table { border-collapse: collapse; width: 100%; margin: 0 0 var(--dsh-ui-space-2); }
:is(.shell, .dsh-drawer) .chat-markdown th, :is(.shell, .dsh-drawer) .chat-markdown td { border: 0.5px solid var(--dsh-ui-line); padding: var(--dsh-ui-space-2); }
`)

/* .chat[hidden] 压过 surfaces 的 display:flex —— 层序代替 !important。 */
defineStyles('dsh.state', 'dsh-chat-state', `
:is(.shell, .dsh-drawer) .chat[hidden] { display: none; pointer-events: none; }
`)
