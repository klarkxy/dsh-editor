// One-shot stylesheet for the proofread dock. Placement follows the host's
// --dsh-ext-* contract: a launcher rail pulls the dock inline and drops
// the open panel below the toggle; a bare host gets the legacy
// bottom-right dock with the panel opening upward.
//
// Component colors use the same alias chain as dsh-editor-seats
// surfaceTokenAliases (existing --dsh-ui-*, then official --dsw-*, then
// Radix names). This public package does not depend on seats. The hex
// below is only the scoped Radix fallback and matches seats/tokens.ts.
// Do not gate on :root:has(.radix-themes).
const standaloneOutsideTheme = ':not(.radix-themes *)'

const surfaceAliases = `
  --s-text: var(--dsh-ui-text, var(--dsw-alias-label-primary, var(--gray-12)));
  --s-muted: var(--dsh-ui-muted, var(--dsw-alias-label-secondary, var(--gray-11)));
  --s-faint: var(--dsh-ui-faint, var(--dsw-alias-label-tertiary, var(--gray-10)));
  --s-bg: var(--dsh-ui-bg, var(--dsw-alias-bg-base, var(--color-background)));
  --s-surface: var(--dsh-ui-surface, var(--dsw-alias-bg-layer-1, var(--color-surface)));
  --s-raised: var(--dsh-ui-raised, var(--dsw-alias-bg-layer-2, var(--color-panel-solid)));
  --s-sidebar: var(--dsh-ui-sidebar, var(--dsw-specific-sidebar-fill, var(--gray-2)));
  --s-sunken: var(--dsh-ui-sunken, var(--dsw-alias-bg-module-platform, var(--gray-3)));
  --s-line: var(--dsh-ui-line, var(--dsw-alias-border-l2, var(--gray-a5)));
  --s-line-strong: var(--dsh-ui-line-strong, var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4, var(--gray-6))));
  --s-hover: var(--dsh-ui-hover, var(--dsw-alias-interactive-bg-hover, var(--gray-a3)));
  --s-selected: var(--dsh-ui-selected, var(--dsw-specific-sidebar-nav-item-active, var(--gray-a4)));
  --s-accent: var(--dsh-ui-accent, var(--dsw-alias-link, var(--accent-9)));
  --s-accent-hover: var(--dsh-ui-accent-hover, var(--dsw-alias-button-info-hover, var(--accent-10)));
  --s-accent-soft: var(--dsh-ui-accent-soft, var(--dsw-alias-state-business-tertiary, var(--accent-a3)));
  --s-on-accent: var(--dsh-ui-on-accent, var(--dsw-alias-label-primary-foreground, var(--accent-contrast)));
  --s-brand: var(--dsh-ui-text, var(--dsw-alias-button-primary-fill, var(--gray-12)));
  --s-on-brand: var(--dsw-alias-label-primary-foreground, var(--color-background));
  --s-brand-hover: var(--dsw-alias-button-primary-hover, color-mix(in srgb, var(--s-brand) 86%, var(--s-on-brand)));
  --s-danger: var(--dsh-ui-danger, var(--dsw-alias-state-error-primary, var(--red-11)));
  --s-warning: var(--dsh-ui-warning, var(--dsw-alias-state-warn-primary, var(--amber-9)));
  --s-success: var(--dsh-ui-success, var(--dsw-alias-state-success-primary, var(--green-9)));
  --s-font: var(--dsh-ui-font-ui, var(--dsw-font-family, var(--default-font-family)));
  --s-mono: var(--dsh-ui-font-mono, var(--ds-font-family-code, var(--code-font-family)));
  --s-radius-xs: var(--dsh-ui-radius-xs, var(--dsw-radius-xs, var(--radius-1, 4px)));
  --s-radius-sm: var(--dsh-ui-radius-sm, var(--dsw-radius-sm, var(--radius-2)));
  --s-radius-md: var(--dsh-ui-radius-md, var(--dsw-radius-md, var(--radius-3)));
  --s-radius-lg: var(--dsh-ui-radius-lg, var(--dsw-radius-lg, var(--radius-4, 16px)));
  --s-radius-xl: var(--dsh-ui-radius-xl, var(--dsw-radius-xl, var(--radius-5, 20px)));
  --s-radius-panel: var(--dsh-ui-radius-2xl, var(--dsw-radius-panel, var(--radius-6, 28px)));
  --s-elevate: var(--dsh-ui-shadow-lg, var(--dsw-elevation-panel, var(--shadow-4)));
  --s-elevate-soft: var(--dsh-ui-shadow-sm, var(--dsw-elevation-soft, var(--shadow-2)));
  --s-control: var(--dsh-ui-control-md, 36px);
  --s-control-sm: var(--dsh-ui-control-sm, 32px);
  --s-track: var(--dsh-ui-sunken, var(--dsw-alias-bg-module-platform, var(--gray-7)));
  --s-track-on: var(--dsh-ui-accent-solid, var(--dsw-alias-state-business-primary, var(--accent-9)));
  --s-thumb: var(--dsw-alias-switch-thumb, var(--gray-1));
`

const standaloneMetrics = `
  --default-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --code-font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei";
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
  --radius-1: 4px;
  --radius-2: 8px;
  --radius-3: 12px;
  --radius-4: 16px;
  --radius-5: 20px;
  --radius-6: 28px;
`

const standaloneLightTokens = `
  --gray-1: #ffffff;
  --gray-2: #f9fafb;
  --gray-3: #f5f6f7;
  --gray-4: #f1f3f5;
  --gray-5: #ebeff2;
  --gray-6: #e1e5ee;
  --gray-7: #cfd3d6;
  --gray-8: #adb2b8;
  --gray-9: #81858c;
  --gray-10: #61666b;
  --gray-11: #61666b;
  --gray-12: #0f1115;
  --gray-a2: #0f111508;
  --gray-a3: #0f11150f;
  --gray-a4: #0f111514;
  --gray-a5: #0f11151a;
  --gray-a6: #0f111529;
  --accent-8: #7aaaff;
  --accent-9: #4176e6;
  --accent-10: #315fbe;
  --accent-11: #4176e6;
  --accent-a3: #4176e614;
  --accent-a4: #4176e624;
  --accent-a8: #4176e672;
  --accent-contrast: #ffffff;
  --red-9: #ec1313;
  --red-11: #ec1313;
  --red-a3: #ec131314;
  --red-a5: #ec131333;
  --red-a6: #ec13134d;
  --green-9: #22c55e;
  --green-11: #178a45;
  --amber-9: #f59e0b;
  --amber-a4: #f59e0b33;
  --amber-a6: #f59e0b55;
  --amber-a8: #f59e0b88;
  --color-background: #ffffff;
  --color-panel-solid: #ffffff;
  --color-surface: #ffffff;
  --shadow-2: 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 4px 16px 0 rgba(0, 0, 0, 0.03), 0 0 24px 0 rgba(0, 0, 0, 0.03);
  --shadow-3: 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.03), 0 0 16px 0 rgba(0, 0, 0, 0.02);
  --shadow-4: 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05);
${standaloneMetrics}
  color-scheme: light;
`

const standaloneDarkTokens = `
  --gray-1: #151517;
  --gray-2: #1b1b1c;
  --gray-3: #232324;
  --gray-4: #2c2c2e;
  --gray-5: #353638;
  --gray-6: #43454a;
  --gray-7: #535456;
  --gray-8: #81858c;
  --gray-9: #adb2b8;
  --gray-10: #adb2b8;
  --gray-11: #adb2b8;
  --gray-12: #f9fafb;
  --gray-a2: #ffffff0f;
  --gray-a3: #ffffff14;
  --gray-a4: #ffffff1f;
  --gray-a5: #ffffff29;
  --gray-a6: #ffffff33;
  --accent-8: #4176e6;
  --accent-9: #7aaaff;
  --accent-10: #4176e6;
  --accent-11: #7aaaff;
  --accent-a3: #7aaaff24;
  --accent-a4: #7aaaff33;
  --accent-a8: #7aaaff72;
  --accent-contrast: #0f1115;
  --red-9: #f25a5a;
  --red-11: #f25a5a;
  --red-a3: #f25a5a24;
  --red-a5: #f25a5a44;
  --red-a6: #f25a5a55;
  --green-9: #22c55e;
  --green-11: #4ed17e;
  --amber-9: #f59e0b;
  --amber-a4: #f59e0b33;
  --amber-a6: #f59e0b55;
  --amber-a8: #f59e0b88;
  --color-background: #151517;
  --color-panel-solid: #2c2c2e;
  --color-surface: #232324;
  --shadow-2: 0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 4px 16px 0 rgba(0, 0, 0, 0.2), 0 0 24px 0 rgba(0, 0, 0, 0.16);
  --shadow-3: 0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 3px 8px 0 rgba(0, 0, 0, 0.24), 0 0 16px 0 rgba(0, 0, 0, 0.18);
  --shadow-4: 0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 3px 8px 0 rgba(0, 0, 0, 0.28), 0 0 20px 0 rgba(0, 0, 0, 0.22);
${standaloneMetrics}
  color-scheme: dark;
`

export const proofreadClientStyles = `
.dsh-proofread-dock,
.dsh-proofread-toggle,
.dsh-proofread-panel {
${surfaceAliases}
}
.dsh-proofread-dock {
  position: var(--dsh-ext-dock-position, absolute);
  right: var(--dsh-ext-dock-right, var(--space-4, 16px));
  bottom: var(--dsh-ext-dock-bottom, var(--space-4, 16px));
  pointer-events: auto;
}
.dsh-proofread-toggle {
  pointer-events: auto;
  font: inherit;
  font-family: var(--s-font);
  font-size: var(--font-size-2);
  min-height: var(--s-control, 36px);
  color: var(--s-text);
  background: var(--s-raised);
  border: 0;
  border-radius: 999px;
  corner-shape: round;
  padding: 0 14px;
  cursor: pointer;
  box-shadow: var(--s-elevate);
}
.dsh-proofread-toggle:hover { color: var(--s-text); background: var(--s-hover); }
.dsh-proofread-toggle:focus-visible,
.dsh-proofread-panel button:focus-visible,
.dsh-proofread-input:focus-visible {
  box-shadow: 0 0 0 2px var(--s-accent);
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
  overflow: hidden;
}
.dsh-proofread-panel {
  font-family: var(--s-font);
  font-size: var(--font-size-2);
  color: var(--s-text);
  background: var(--s-raised);
  border: 0;
  border-radius: var(--s-radius-panel);
  box-shadow: var(--s-elevate);
}
.dsh-proofread-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 0.5px solid var(--s-line);
}
.dsh-proofread-panel-title {
  margin: 0;
  font-size: var(--font-size-2);
  font-weight: var(--font-weight-medium);
  font-family: var(--s-font);
  letter-spacing: 0;
}
.dsh-proofread-panel-close {
  font: inherit; font-size: var(--font-size-2); min-height: var(--s-control-sm, 32px); color: var(--s-muted); background: none; border: none;
  border-radius: var(--s-radius-md); padding: 0 8px; cursor: pointer;
}
.dsh-proofread-panel-close:hover { color: var(--s-text); background: var(--s-hover); }
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
  font-family: var(--s-font);
  font-size: var(--font-size-2);
  line-height: 1.7;
  color: var(--s-text);
  background: var(--s-surface);
  border: 0;
  border-radius: var(--s-radius-md);
  box-shadow: var(--s-elevate-soft);
  padding: var(--space-2);
}
.dsh-proofread-panel-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
button.dsh-proofread-check {
  font: inherit;
  font-family: var(--s-font);
  font-size: var(--font-size-2);
  min-height: var(--s-control, 36px);
  color: var(--s-on-brand);
  background: var(--s-brand);
  border: 0;
  border-radius: var(--s-radius-md);
  padding: 0 14px;
  cursor: pointer;
}
button.dsh-proofread-check:hover:not(:disabled) { background: var(--s-brand-hover); color: var(--s-on-brand); }
button.dsh-proofread-check:disabled { opacity: 0.5; cursor: default; }
.dsh-proofread-cancel {
  font: inherit; font-family: var(--s-font); font-size: var(--font-size-2); min-height: var(--s-control, 36px); color: var(--s-text); background: transparent;
  border: 0.5px solid var(--s-line-strong); border-radius: var(--s-radius-md);
  padding: 0 12px; cursor: pointer;
}
.dsh-proofread-cancel:hover { background: var(--s-hover); }
.dsh-proofread-hint { color: var(--s-muted); font-size: var(--font-size-2); margin-left: auto; }
.dsh-proofread-hint.dsh-proofread-is-over { color: var(--s-danger); font-weight: var(--font-weight-medium); }
.dsh-proofread-status { color: var(--s-muted); padding: var(--space-2) 0; }
.dsh-proofread-error {
  color: var(--s-danger);
  font-weight: var(--font-weight-medium);
  padding: var(--space-2) 0;
  border-inline-start: 2px solid var(--s-danger);
  padding-inline-start: var(--space-2);
}
.dsh-proofread-stale {
  color: var(--s-muted);
  background: var(--s-sunken);
  border-radius: var(--s-radius-md);
  padding: var(--space-2);
}
.dsh-proofread-result { display: flex; flex-direction: column; gap: var(--space-2); }
.dsh-proofread-result-summary { color: var(--s-muted); font-weight: var(--font-weight-medium); }
.dsh-proofread-habits { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.dsh-proofread-habit {
  color: var(--s-muted);
  border: 0.5px solid var(--s-line-strong);
  border-radius: 999px;
  corner-shape: round;
  padding: 1px 8px;
  font-size: var(--font-size-2);
}
.dsh-proofread-findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.dsh-proofread-finding {
  border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-xl);
  box-shadow: none;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--s-surface);
}
.dsh-proofread-finding-head { display: flex; align-items: baseline; gap: var(--space-2); }
.dsh-proofread-finding-kind { font-weight: var(--font-weight-medium); color: var(--s-text); }
.dsh-proofread-finding-pos { color: var(--s-muted); font-size: var(--font-size-2); margin-left: auto; font-family: var(--s-mono); }
.dsh-proofread-severity { width: 8px; height: 8px; border-radius: 50%; corner-shape: round; flex: none; align-self: center; }
.dsh-proofread-severity-error { background: var(--s-danger); }
.dsh-proofread-severity-warning { background: var(--s-warning); }
.dsh-proofread-severity-info { background: var(--s-faint); }
.dsh-proofread-finding-message { color: var(--s-text); }
.dsh-proofread-finding-excerpt {
  color: var(--s-muted);
  font-size: var(--font-size-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-proofread-finding-suggestion {
  color: var(--s-accent);
  background: var(--s-accent-soft);
  border-radius: var(--s-radius-sm);
  padding: 4px 8px;
}
.dsh-proofread-scope { color: var(--s-muted); font-size: var(--font-size-2); }
.dsh-proofread-finding-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.dsh-proofread-locate,
.dsh-proofread-ignore {
  min-height: var(--s-control-sm, 32px);
  padding: 0 8px;
  border: 0.5px solid var(--s-line-strong);
  border-radius: var(--s-radius-md);
  background: transparent;
  color: var(--s-text);
  cursor: pointer;
  font: var(--font-weight-medium) var(--font-size-2)/1 var(--s-font);
  letter-spacing: 0;
  box-shadow: none;
}
.dsh-proofread-ignore:hover {
  background: var(--s-hover);
}
button.dsh-proofread-locate {
  border: 0;
  background: var(--s-brand);
  color: var(--s-on-brand);
}
button.dsh-proofread-locate:hover {
  background: var(--s-brand-hover);
  color: var(--s-on-brand);
}
/* 活动反馈:三点呼吸(pulse-dots),参数改写自 Amicro(MIT License,
   Copyright (c) 2026 Syed Subhan Uddin);装饰元素 aria-hidden。 */
@keyframes dsh-proofread-activity-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
.dsh-proofread-dots { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: .4em; vertical-align: middle; color: var(--s-accent); }
.dsh-proofread-dots i { width: .32em; height: .32em; min-width: 3px; min-height: 3px; border-radius: 50%; corner-shape: round; background: currentColor; animation: dsh-proofread-activity-pulse 1.4s ease infinite; }
.dsh-proofread-dots i:nth-child(2) { animation-delay: .2s; }
.dsh-proofread-dots i:nth-child(3) { animation-delay: .4s; }
/* 减弱动效：html 前缀把特异性抬到目标规则之上，不用 !important。 */
@media (prefers-reduced-motion: reduce) {
  html .dsh-proofread-dots i { animation: none; }
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
