/*
 * Standalone Radix fallback. Injected by manuscript / overlay (and any host
 * that is not already inside `.radix-themes`) so those styles can read the
 * same variables the shell gets from `@radix-ui/themes`. Hex lives only in
 * this fallback. Values follow the official DSH neutral / radius contract
 * while keeping the existing Radix variable names.
 *
 * Light: `:root:not(:has(.radix-themes))`
 * Dark:  `:root[data-theme="dark"]` and official `body[data-ds-dark-theme]`,
 *        both still inert when a `.radix-themes` ancestor exists.
 * Spacing and the type ladder are not renumbered. `--font-size-1` stays 13px.
 *
 * Component CSS should not copy these literals. Use `surfaceTokenAliases`:
 * existing `--dsh-ui-*`, then official `--dsw-alias-*` / `--dsw-radius-*` /
 * `--dsw-elevation-*`, then the Radix variables this block provides.
 */
const metrics = `
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

const lightPalette = `
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
  --green-a3: #22c55e24;
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
${metrics}
  color-scheme: light;
`

const darkPalette = `
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
  --green-a3: #22c55e24;
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
${metrics}
  color-scheme: dark;
`

export const radixFallbackTokens = `:root:not(:has(.radix-themes)) {
${lightPalette}}
:root[data-theme="dark"]:not(:has(.radix-themes)),
body[data-ds-dark-theme]:not(:has(.radix-themes)) {
${darkPalette}}`

/**
 * Local semantic names for plugin and standalone chrome.
 * Declared on a component root so they inherit. They do not redefine
 * `--dsh-ui-*` or `--dsw-*`, and they contain no theme selector.
 *
 * `surfaceTokenVars` is the same map as a JS object: components that set
 * inline styles (e.g. editor-chrome's host-independent chrome) spread it
 * onto the section root so `--s-*` resolves inside any host. Stylesheets
 * keep using `surfaceTokenAliases`, generated from the same entries.
 */
export const surfaceTokenVars: Record<string, string> = {
  '--s-text': 'var(--dsh-ui-text, var(--dsw-alias-label-primary, var(--gray-12)))',
  '--s-muted': 'var(--dsh-ui-muted, var(--dsw-alias-label-secondary, var(--gray-11)))',
  '--s-faint': 'var(--dsh-ui-faint, var(--dsw-alias-label-tertiary, var(--gray-10)))',
  '--s-bg': 'var(--dsh-ui-bg, var(--dsw-alias-bg-base, var(--color-background)))',
  '--s-surface': 'var(--dsh-ui-surface, var(--dsw-alias-bg-layer-1, var(--color-surface)))',
  '--s-raised': 'var(--dsh-ui-raised, var(--dsw-alias-bg-layer-2, var(--color-panel-solid)))',
  '--s-sidebar': 'var(--dsh-ui-sidebar, var(--dsw-specific-sidebar-fill, var(--gray-2)))',
  '--s-sunken': 'var(--dsh-ui-sunken, var(--dsw-alias-bg-module-platform, var(--gray-3)))',
  '--s-line': 'var(--dsh-ui-line, var(--dsw-alias-border-l2, var(--gray-a5)))',
  '--s-line-strong': 'var(--dsh-ui-line-strong, var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4, var(--gray-6))))',
  '--s-hover': 'var(--dsh-ui-hover, var(--dsw-alias-interactive-bg-hover, var(--gray-a3)))',
  '--s-selected': 'var(--dsh-ui-selected, var(--dsw-specific-sidebar-nav-item-active, var(--gray-a4)))',
  '--s-accent': 'var(--dsh-ui-accent, var(--dsw-alias-link, var(--accent-9)))',
  '--s-accent-hover': 'var(--dsh-ui-accent-hover, var(--dsw-alias-button-info-hover, var(--accent-10)))',
  '--s-accent-soft': 'var(--dsh-ui-accent-soft, var(--dsw-alias-state-business-tertiary, var(--accent-a3)))',
  '--s-on-accent': 'var(--dsh-ui-on-accent, var(--dsw-alias-label-primary-foreground, var(--accent-contrast)))',
  '--s-brand': 'var(--dsh-ui-brand, var(--dsw-alias-button-primary-fill, var(--gray-12)))',
  '--s-on-brand': 'var(--dsh-ui-on-brand, var(--dsw-alias-label-primary-foreground, var(--color-background)))',
  '--s-brand-hover': 'var(--dsh-ui-brand-hover, var(--dsw-alias-button-primary-hover, color-mix(in srgb, var(--s-brand) 86%, var(--s-on-brand))))',
  '--s-danger': 'var(--dsh-ui-danger, var(--dsw-alias-state-error-primary, var(--red-11)))',
  '--s-danger-soft': 'var(--dsh-ui-danger-soft, var(--dsw-alias-state-error-secondary, var(--red-a3)))',
  '--s-warning': 'var(--dsh-ui-warning, var(--dsw-alias-state-warn-primary, var(--amber-9)))',
  '--s-warning-soft': 'var(--dsh-ui-warning-soft, var(--dsw-alias-state-warn-secondary, var(--amber-a4)))',
  '--s-success': 'var(--dsh-ui-success, var(--dsw-alias-state-success-primary, var(--green-9)))',
  '--s-success-soft': 'var(--dsh-ui-success-soft, var(--dsw-alias-state-success-secondary, var(--green-a3)))',
  '--s-font': 'var(--dsh-ui-font-ui, var(--dsw-font-family, var(--default-font-family)))',
  '--s-mono': 'var(--dsh-ui-font-mono, var(--ds-font-family-code, var(--code-font-family)))',
  '--s-radius-xs': 'var(--dsh-ui-radius-xs, var(--dsw-radius-xs, var(--radius-1, 4px)))',
  '--s-radius-sm': 'var(--dsh-ui-radius-sm, var(--dsw-radius-sm, var(--radius-2)))',
  '--s-radius-md': 'var(--dsh-ui-radius-md, var(--dsw-radius-md, var(--radius-3)))',
  '--s-radius-lg': 'var(--dsh-ui-radius-lg, var(--dsw-radius-lg, var(--radius-4, 16px)))',
  '--s-radius-xl': 'var(--dsh-ui-radius-xl, var(--dsw-radius-xl, var(--radius-5, 20px)))',
  '--s-radius-panel': 'var(--dsh-ui-radius-2xl, var(--dsw-radius-panel, var(--radius-6, 28px)))',
  '--s-elevate': 'var(--dsh-ui-shadow-lg, var(--dsw-elevation-panel, var(--shadow-4)))',
  '--s-elevate-soft': 'var(--dsh-ui-shadow-sm, var(--dsw-elevation-soft, var(--shadow-2)))',
  '--s-focus-shadow': 'var(--dsh-ui-elevation-focus, 0 0 0 2px var(--s-accent))',
  '--s-control': 'var(--dsh-ui-control-md, 36px)',
  '--s-control-sm': 'var(--dsh-ui-control-sm, 32px)',
  '--s-track': 'var(--dsh-ui-sunken, var(--dsw-alias-bg-module-platform, var(--gray-7)))',
  '--s-track-on': 'var(--dsh-ui-accent-solid, var(--dsw-alias-state-business-primary, var(--accent-9)))',
  '--s-thumb': 'var(--dsw-alias-switch-thumb, var(--gray-1))',
  /* 尺度别名：原稿空间/字阶先走 --dsh-ui-*，standalone 退回 Radix 梯级或字面量。 */
  '--s-space-1': 'var(--dsh-ui-space-1, var(--space-1, 4px))',
  '--s-space-2': 'var(--dsh-ui-space-2, var(--space-2, 8px))',
  '--s-space-3': 'var(--dsh-ui-space-3, var(--space-3, 12px))',
  '--s-space-4': 'var(--dsh-ui-space-4, var(--space-4, 16px))',
  '--s-space-5': 'var(--dsh-ui-space-5, 20px)',
  '--s-space-6': 'var(--dsh-ui-space-6, var(--space-5, 24px))',
  '--s-space-7': 'var(--dsh-ui-space-7, 28px)',
  '--s-space-8': 'var(--dsh-ui-space-8, 32px)',
  '--s-text-xs': 'var(--dsh-ui-text-xs, 12px)',
  '--s-text-sm': 'var(--dsh-ui-text-sm, var(--font-size-1, 13px))',
  '--s-text-base': 'var(--dsh-ui-text-base, var(--font-size-2, 14px))',
  '--s-text-md': 'var(--dsh-ui-text-md, 15px)',
  '--s-text-lg': 'var(--dsh-ui-text-lg, var(--font-size-3, 16px))',
  '--s-text-xl': 'var(--dsh-ui-text-xl, var(--font-size-4, 18px))',
  '--s-text-2xl': 'var(--dsh-ui-text-2xl, var(--font-size-6, 24px))',
  '--s-leading-tight': 'var(--dsh-ui-leading-tight, 1.25)',
  '--s-leading-normal': 'var(--dsh-ui-leading-normal, 1.5)',
  '--s-leading-relaxed': 'var(--dsh-ui-leading-relaxed, 1.7)',
  '--s-weight-regular': 'var(--dsh-ui-weight-regular, var(--font-weight-regular, 400))',
  '--s-weight-medium': 'var(--dsh-ui-weight-medium, var(--font-weight-medium, 500))',
  '--s-weight-strong': 'var(--dsh-ui-weight-strong, 600)',
  '--s-radius-full': 'var(--dsh-ui-radius-full, 999px)',
  '--s-duration-fast': 'var(--dsh-ui-duration-fast, 120ms)',
  '--s-duration-base': 'var(--dsh-ui-duration-base, 180ms)',
  '--s-duration-slow': 'var(--dsh-ui-duration-slow, 260ms)',
  '--s-ease-out': 'var(--dsh-ui-ease-out, cubic-bezier(0.2, 0, 0, 1))',
}

export const surfaceTokenAliases = `
${Object.entries(surfaceTokenVars).map(([name, value]) => `  ${name}: ${value};`).join('\n')}
`
