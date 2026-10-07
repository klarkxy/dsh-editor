/** Structural styles composed in the shell stylesheet; visual overrides remain in the design adapter. */
export const historyStyles = `
.radix-themes .file-dialog.history-dialog { max-width: min(860px, calc(100vw - 32px)); width: min(860px, calc(100vw - 32px)); }
.radix-themes .file-dialog.history-dialog-empty { width: min(560px, calc(100vw - 32px)); }
.radix-themes .history-split {
  display: grid;
  grid-template-columns: minmax(240px, 0.95fr) minmax(280px, 1.15fr);
  gap: var(--space-3);
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
  border-radius: var(--radius-2);
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
  background: var(--gray-a5);
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
  background: var(--gray-8);
}
.radix-themes .history-commit[data-selected='true'] { background: var(--gray-a3); }
.radix-themes .history-commit[data-selected='true'] .history-commit-dot { background: var(--accent-9); }
.radix-themes .history-commit:hover { background: var(--gray-a3); }
.radix-themes .history-commit-body { display: grid; gap: 2px; min-width: 0; }
.radix-themes .history-commit-top { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; }
.radix-themes .history-hash {
  font-family: var(--code-font-family);
  font-size: var(--font-size-1);
  color: var(--accent-11);
}
.radix-themes .history-hash-lg { font-size: var(--font-size-2); }
.radix-themes .history-subject { min-width: 0; }
.radix-themes .history-commit-meta { min-width: 0; }
.radix-themes .history-detail { overflow: auto; }
.radix-themes .history-changes { min-height: 0; overflow: auto; }
.radix-themes .history-change-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.radix-themes .history-change {
  display: grid;
  grid-template-columns: 1.1em minmax(0, 1fr);
  gap: var(--space-2);
  align-items: baseline;
  font-size: var(--font-size-1);
}
.radix-themes .history-change code { overflow-wrap: anywhere; }
.radix-themes .history-kind { font-family: var(--code-font-family); font-weight: var(--dsh-ui-weight-strong); }
.radix-themes .history-change-added .history-kind { color: var(--green-11); }
.radix-themes .history-change-removed .history-kind { color: var(--red-11); }
.radix-themes .history-change-modified .history-kind { color: var(--amber-11); }
@media (max-width: 720px) {
  .radix-themes .history-split { grid-template-columns: 1fr; max-height: min(70dvh, calc(100dvh - 180px)); }
}
`
