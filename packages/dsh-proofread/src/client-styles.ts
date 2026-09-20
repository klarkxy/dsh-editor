// One-shot stylesheet for the proofread dock. Colors use Radix Themes
// variables from the host Theme tree. Placement follows the host's
// --dsh-ext-* contract: a launcher rail pulls the dock inline and drops
// the open panel below the toggle; a bare host gets the legacy
// bottom-right dock with the panel opening upward. Overlay hosts
// outside a `.radix-themes` ancestor get local Radix tokens (same
// values as dsh-editor-seats/src/tokens.ts). Do not gate on :root:has(.radix-themes).
const standaloneOutsideTheme = ':not(.radix-themes *)'

const standaloneLightTokens = `
  --default-font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --code-font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
  --font-weight-medium: 500;
  --font-size-1: 13px;
  --font-size-2: 14px;
  --font-size-3: 16px;
  --font-size-4: 18px;
  --font-size-5: 20px;
  --font-size-6: 24px;
  --font-size-7: 28px;
  --font-size-8: 35px;
  --font-size-9: 60px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --radius-2: 4px;
  --radius-3: 6px;
  --control-h: 34px;
  --gray-1: #fcfcfc;
  --gray-2: #f9f9f9;
  --gray-3: #f0f0f0;
  --gray-4: #e8e8e8;
  --gray-5: #e0e0e0;
  --gray-6: #d9d9d9;
  --gray-7: #cecece;
  --gray-8: #bbbbbb;
  --gray-9: #8d8d8d;
  --gray-10: #838383;
  --gray-11: #646464;
  --gray-12: #202020;
  --gray-a2: #00000006;
  --gray-a3: #0000000f;
  --gray-a4: #00000017;
  --gray-a5: #0000001f;
  --gray-a6: #00000026;
  --accent-8: #8da4ef;
  --accent-9: #3e63dd;
  --accent-10: #3358d4;
  --accent-11: #3a5bc7;
  --accent-a3: #0047f112;
  --accent-a4: #0044ff1e;
  --accent-a8: #0034dc72;
  --accent-contrast: #ffffff;
  --red-9: #e5484d;
  --red-11: #ce2c31;
  --green-9: #30a46c;
  --green-11: #218358;
  --amber-a4: #ffd40063;
  --amber-a6: #eab5008c;
  --color-background: #ffffff;
  --color-panel-solid: #ffffff;
  --color-surface: rgba(255, 255, 255, 0.85);
  --shadow-2: 0 0 0 1px #0000000f, 0 0 0 0.5px rgba(0, 0, 0, 0.05), 0 1px 1px 0 #00000006, 0 2px 1px -1px rgba(0, 0, 0, 0.05), 0 1px 3px 0 rgba(0, 0, 0, 0.05);
  --shadow-3: 0 0 0 1px #0000000f, 0 2px 3px -2px #0000000f, 0 3px 12px -4px rgba(0, 0, 0, 0.1), 0 4px 16px -8px rgba(0, 0, 0, 0.1);
  --shadow-4: 0 0 0 1px #0000000f, 0 8px 40px rgba(0, 0, 0, 0.05), 0 12px 32px -16px #0000000f;
  color-scheme: light;
`

const standaloneDarkTokens = `
  --default-font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --code-font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
  --font-weight-medium: 500;
  --font-size-1: 13px;
  --font-size-2: 14px;
  --font-size-3: 16px;
  --font-size-4: 18px;
  --font-size-5: 20px;
  --font-size-6: 24px;
  --font-size-7: 28px;
  --font-size-8: 35px;
  --font-size-9: 60px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --radius-2: 4px;
  --radius-3: 6px;
  --control-h: 34px;
  --gray-1: #111111;
  --gray-2: #191919;
  --gray-3: #222222;
  --gray-4: #2a2a2a;
  --gray-5: #313131;
  --gray-6: #3a3a3a;
  --gray-7: #484848;
  --gray-8: #606060;
  --gray-9: #6e6e6e;
  --gray-10: #7b7b7b;
  --gray-11: #b4b4b4;
  --gray-12: #eeeeee;
  --gray-a2: #ffffff09;
  --gray-a3: #ffffff12;
  --gray-a4: #ffffff1b;
  --gray-a5: #ffffff22;
  --gray-a6: #ffffff2c;
  --accent-8: #435db1;
  --accent-9: #3e63dd;
  --accent-10: #5472e4;
  --accent-11: #9eb1ff;
  --accent-a3: #2f62ff3c;
  --accent-a4: #3566ff57;
  --accent-a8: #5b81feac;
  --accent-contrast: #ffffff;
  --red-9: #e5484d;
  --red-11: #ff9592;
  --green-9: #30a46c;
  --green-11: #3dd68c;
  --amber-a4: #fc820032;
  --amber-a6: #fd9b0051;
  --color-background: #111111;
  --color-panel-solid: #191919;
  --color-surface: rgba(0, 0, 0, 0.25);
  --shadow-2: 0 0 0 1px #ffffff2c, 0 0 0 0.5px rgba(0, 0, 0, 0.15), 0 1px 1px 0 rgba(0, 0, 0, 0.4), 0 2px 1px -1px rgba(0, 0, 0, 0.4), 0 1px 3px 0 rgba(0, 0, 0, 0.3);
  --shadow-3: 0 0 0 1px #ffffff2c, 0 2px 3px -2px rgba(0, 0, 0, 0.15), 0 3px 8px -2px rgba(0, 0, 0, 0.4), 0 4px 12px -4px rgba(0, 0, 0, 0.5);
  --shadow-4: 0 0 0 1px #ffffff2c, 0 8px 40px rgba(0, 0, 0, 0.15), 0 12px 32px -16px rgba(0, 0, 0, 0.3);
  color-scheme: dark;
`

export const proofreadClientStyles = `
.dsh-proofread-dock {
  position: var(--dsh-ext-dock-position, absolute);
  right: var(--dsh-ext-dock-right, var(--space-4, 16px));
  bottom: var(--dsh-ext-dock-bottom, var(--space-4, 16px));
  pointer-events: auto;
}
.dsh-proofread-toggle {
  pointer-events: auto;
  font: inherit;
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  min-height: var(--control-h, 34px);
  color: var(--gray-11);
  background: var(--color-panel-solid);
  border: 1px solid var(--gray-6);
  border-radius: 999px;
  padding: 0 14px;
  cursor: pointer;
  box-shadow: var(--shadow-3);
}
.dsh-proofread-toggle:hover { border-color: var(--accent-9); color: var(--accent-11); background: var(--gray-a3); }
.dsh-proofread-toggle:focus-visible,
.dsh-proofread-panel button:focus-visible,
.dsh-proofread-input:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-a8);
}
.dsh-proofread-dock .dsh-proofread-panel {
  position: absolute;
  top: var(--dsh-ext-panel-top, auto);
  right: 0;
  bottom: var(--dsh-ext-panel-bottom, calc(100% + 6px));
  z-index: 10;
  width: min(380px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  color: var(--gray-12);
  background: var(--color-panel-solid);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-3);
  box-shadow: var(--shadow-4);
  overflow: hidden;
}
.dsh-proofread-panel {
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  color: var(--gray-12);
  background: var(--color-panel-solid);
}
.dsh-proofread-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--gray-6);
}
.dsh-proofread-panel-title {
  margin: 0;
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-medium);
  font-family: var(--default-font-family);
}
.dsh-proofread-panel-close {
  font: inherit; font-size: var(--font-size-2); min-height: 32px; color: var(--gray-11); background: none; border: none;
  border-radius: var(--radius-2); padding: 0 8px; cursor: pointer;
}
.dsh-proofread-panel-close:hover { color: var(--gray-12); background: var(--gray-a3); }
.dsh-proofread-panel-close:disabled { opacity: 0.5; cursor: default; }
.dsh-proofread-panel-body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
}
.dsh-proofread-input {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  box-sizing: border-box;
  font: inherit;
  font-family: var(--default-font-family);
  font-size: var(--font-size-2);
  line-height: 1.7;
  color: var(--gray-12);
  background: var(--color-surface);
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}
.dsh-proofread-panel-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.dsh-proofread-check {
  font: inherit;
  font-size: var(--font-size-2);
  min-height: var(--control-h, 34px);
  color: var(--accent-contrast);
  background: var(--accent-9);
  border: 1px solid var(--accent-9);
  border-radius: var(--radius-2);
  padding: 0 14px;
  cursor: pointer;
}
.dsh-proofread-check:hover:not(:disabled) { background: var(--accent-10); }
.dsh-proofread-check:disabled { opacity: 0.5; cursor: default; }
.dsh-proofread-cancel {
  font: inherit; font-size: var(--font-size-2); min-height: var(--control-h, 34px); color: var(--gray-11); background: none;
  border: 1px solid var(--gray-6); border-radius: var(--radius-2);
  padding: 0 12px; cursor: pointer;
}
.dsh-proofread-cancel:hover { background: var(--gray-a3); }
.dsh-proofread-hint { color: var(--gray-11); font-size: var(--font-size-2); margin-left: auto; }
.dsh-proofread-hint.dsh-proofread-is-over { color: var(--red-11); }
.dsh-proofread-status { color: var(--gray-11); padding: var(--space-2) 0; }
.dsh-proofread-error { color: var(--red-11); padding: var(--space-2) 0; }
.dsh-proofread-stale {
  color: var(--gray-11);
  background: var(--gray-a3);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}
.dsh-proofread-result { display: flex; flex-direction: column; gap: var(--space-2); }
.dsh-proofread-result-summary { color: var(--gray-11); font-weight: var(--font-weight-medium); }
.dsh-proofread-habits { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.dsh-proofread-habit {
  color: var(--gray-11);
  border: 1px solid var(--gray-6);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: var(--font-size-2);
}
.dsh-proofread-findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.dsh-proofread-finding {
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--color-surface);
}
.dsh-proofread-finding-head { display: flex; align-items: baseline; gap: var(--space-2); }
.dsh-proofread-finding-kind { font-weight: var(--font-weight-medium); color: var(--gray-11); }
.dsh-proofread-finding-pos { color: var(--gray-11); font-size: var(--font-size-2); margin-left: auto; font-family: var(--code-font-family); }
.dsh-proofread-severity { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
.dsh-proofread-severity-error { background: var(--red-9); }
.dsh-proofread-severity-warning { background: var(--accent-9); }
.dsh-proofread-severity-info { background: var(--gray-9); }
.dsh-proofread-finding-message { color: var(--gray-12); }
.dsh-proofread-finding-excerpt {
  color: var(--gray-11);
  font-size: var(--font-size-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-proofread-finding-suggestion {
  color: var(--gray-11);
  background: var(--gray-3);
  border-radius: var(--radius-2);
  padding: 4px 8px;
}
.dsh-proofread-scope { color: var(--gray-11); font-size: var(--font-size-2); }
.dsh-proofread-finding-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.dsh-proofread-locate,
.dsh-proofread-ignore {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--gray-6);
  border-radius: var(--radius-2);
  background: var(--color-surface);
  color: var(--gray-11);
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--default-font-family);
  letter-spacing: 0;
  box-shadow: none;
}
.dsh-proofread-ignore:hover {
  background: var(--gray-a3);
}
.dsh-proofread-locate {
  background: var(--accent-9);
  border-color: var(--accent-9);
  color: var(--accent-contrast);
}
/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden。 */
@keyframes dsh-proofread-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
.dsh-proofread-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; color: var(--accent-9); }
.dsh-proofread-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; background: currentColor; animation: dsh-proofread-activity-pulse 1.4s ease infinite; }
.dsh-proofread-dots i:nth-child(2) { animation-delay: .2s; }
.dsh-proofread-dots i:nth-child(3) { animation-delay: .4s; }
@media (prefers-reduced-motion: reduce) {
  .dsh-proofread-dock, .dsh-proofread-dock *, .dsh-proofread-panel, .dsh-proofread-panel * {
    animation: none !important; transition: none !important;
  }
  .dsh-proofread-dots i { animation: none; }
}
/* Local tokens when this overlay is not under .radix-themes. Host Theme
   and --dsh-ext-* rail overrides still win inside the Theme tree. Dark
   follows body[data-ds-dark-theme] / :root[data-theme=dark], not OS scheme. */
.dsh-proofread-dock${standaloneOutsideTheme},
.dsh-proofread-toggle${standaloneOutsideTheme},
.dsh-proofread-panel${standaloneOutsideTheme} {
${standaloneLightTokens}}
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-dock${standaloneOutsideTheme},
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-toggle${standaloneOutsideTheme},
html:not([data-theme]) body[data-ds-dark-theme] .dsh-proofread-panel${standaloneOutsideTheme},
:root[data-theme="dark"] .dsh-proofread-dock${standaloneOutsideTheme},
:root[data-theme="dark"] .dsh-proofread-toggle${standaloneOutsideTheme},
:root[data-theme="dark"] .dsh-proofread-panel${standaloneOutsideTheme} {
${standaloneDarkTokens}}
`
