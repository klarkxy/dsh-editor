/** Structural styles composed in the shell stylesheet; visual overrides remain in the design adapter. */
export const chatMessageStyles = `
/* DSH TurnProcessNodeView + DisclosureRow: settled blocks collapse through
   dsh-disclosure; these rules keep the row metrics the Disclosure wraps. */
.radix-themes .chat-process,
.radix-themes .chat-process-stack { min-width: 0; max-width: 100%; overflow-x: hidden; }
.radix-themes .chat-process-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: normal;
}
.radix-themes .chat-process-body,
.radix-themes .chat-process-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
}
.radix-themes .chat-process-body { padding-top: var(--space-1); }
.radix-themes .chat-step { min-width: 0; max-width: 100%; overflow-x: hidden; }
.radix-themes .chat-step-head {
  min-width: 0;
  max-width: 100%;
  height: var(--space-6);
  overflow: hidden;
}
.radix-themes .chat-step-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  color: var(--gray-9);
}
.radix-themes .chat-step-status,
.radix-themes .chat-step-error-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--dsh-ui-radius-full);
  background: var(--gray-8);
}
.radix-themes .chat-step-status.is-ok { background: var(--green-9); }
.radix-themes .chat-step-status.is-error,
.radix-themes .chat-step-error-dot { background: var(--red-9); }
.radix-themes .chat-step-mark .activity-dots { margin-inline-end: 0; }
.radix-themes .chat-step-label { flex: none; }
.radix-themes .chat-step-dot {
  flex: none;
  width: 2px;
  height: 2px;
  border-radius: var(--radius-1);
  background: var(--gray-8);
}
.radix-themes .chat-step-preview {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.radix-themes .chat-step-body {
  min-width: 0;
  max-width: 100%;
  margin: var(--space-1) 0 0 calc(14px + var(--space-2));
  overflow-wrap: anywhere;
  word-break: break-word;
  color: var(--gray-11);
  font-size: var(--font-size-1);
  line-height: var(--line-height-1);
  white-space: pre-wrap;
}
.radix-themes .chat-step-body > :first-child { margin-top: 0; }
.radix-themes .chat-step-code,
.radix-themes .chat-step-body pre {
  max-height: 16rem;
  overflow: auto;
  margin: var(--space-1) 0 0;
  max-width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--gray-a5);
  border-radius: var(--radius-4);
  background: var(--gray-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: var(--code-font-family);
  font-size: var(--font-size-1);
  color: var(--gray-12);
}
:is(.shell, .dsh-drawer) .chat-markdown > :first-child { margin-top: 0; }
:is(.shell, .dsh-drawer) .chat-markdown > :last-child { margin-bottom: 0; }
:is(.shell, .dsh-drawer) .chat-markdown h1, :is(.shell, .dsh-drawer) .chat-markdown h2, :is(.shell, .dsh-drawer) .chat-markdown h3,
:is(.shell, .dsh-drawer) .chat-markdown h4, :is(.shell, .dsh-drawer) .chat-markdown h5, :is(.shell, .dsh-drawer) .chat-markdown h6 { margin: var(--space-3) 0 var(--space-2); font-weight: var(--dsh-ui-weight-strong); line-height: var(--line-height-2); }
:is(.shell, .dsh-drawer) .chat-markdown h1 { font-size: var(--font-size-4); line-height: var(--line-height-4); }
:is(.shell, .dsh-drawer) .chat-markdown h2 { font-size: var(--font-size-3); line-height: var(--line-height-3); }
:is(.shell, .dsh-drawer) .chat-markdown h3, :is(.shell, .dsh-drawer) .chat-markdown h4, :is(.shell, .dsh-drawer) .chat-markdown h5, :is(.shell, .dsh-drawer) .chat-markdown h6 { font-size: var(--font-size-2); }
:is(.shell, .dsh-drawer) .chat-markdown p { margin: 0 0 var(--space-3); }
:is(.shell, .dsh-drawer) .chat-markdown ul, :is(.shell, .dsh-drawer) .chat-markdown ol { margin: 0 0 var(--space-2); padding-left: var(--space-5); }
:is(.shell, .dsh-drawer) .chat-markdown li { margin: var(--space-1) 0; }
:is(.shell, .dsh-drawer) .chat-markdown blockquote {
  margin: 0 0 var(--space-2);
  padding-left: var(--space-3);
  border-left: 2px solid var(--gray-a5);
  color: var(--gray-11);
}
:is(.shell, .dsh-drawer) .chat-markdown hr { margin: var(--space-3) 0; border: 0; border-top: 1px solid var(--gray-a5); }
:is(.shell, .dsh-drawer) .chat-markdown code {
  padding: 0 var(--space-1);
  border-radius: var(--radius-2);
  background: var(--gray-3);
  font-family: var(--code-font-family);
}
:is(.shell, .dsh-drawer) .chat-markdown pre {
  max-height: 15rem;
  overflow: auto;
  margin: 0 0 var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-2);
  background: var(--gray-2);
  white-space: pre-wrap;
  max-width: 100%;
  font-family: var(--code-font-family);
}
:is(.shell, .dsh-drawer) .chat-markdown pre code { padding: 0; background: transparent; }
:is(.shell, .dsh-drawer) .chat-markdown a { color: var(--accent-11); }
:is(.shell, .dsh-drawer) .chat-markdown table { border-collapse: collapse; width: 100%; margin: 0 0 var(--space-2); }
:is(.shell, .dsh-drawer) .chat-markdown th, :is(.shell, .dsh-drawer) .chat-markdown td { border: 1px solid var(--gray-5); padding: var(--space-1) var(--space-2); }

`
