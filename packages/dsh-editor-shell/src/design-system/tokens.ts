/**
 * Shell appearance tokens adapted from deepseek-ai/deepseek-harness (MIT),
 * tag dsh-v0.2.0-rc.2, commit 639ed015397290b3745d163aafe02ffee4aa3f84.
 * See resources/third-party/deepseek-harness-MIT.txt.
 * The earlier Kimi Web notice remains at resources/third-party/kimi-web-MIT.txt.
 *
 * Namespaced tokens deliberately do not replace Radix spacing or z-index scales:
 * existing panel geometry, plugins and portalled controls retain their contracts.
 */
export const DESIGN_SYSTEM_ID = 'dsh-official' as const
export const DEFAULT_SHELL_ACCENT = 'blue' as const
export const DESIGN_SOURCE = {
  repository: 'deepseek-ai/deepseek-harness',
  revision: '639ed015397290b3745d163aafe02ffee4aa3f84',
  tag: 'dsh-v0.2.0-rc.2',
  files: [
    'docs/web-styling.zh.md',
    'docs/ui-radius.zh.md',
    'packages/client/ui-theme/src/styles/base.css',
    'packages/client/ui-theme/src/styles/design-platform.css',
    'packages/client/ui-theme/src/styles/gradient-shadow-text.css',
  ],
} as const

export const LIGHT_TOKENS = {
  bg: '#ffffff', surface: '#f5f6f7', raised: '#ffffff', sunken: '#f5f6f7',
  sidebar: '#f9fafb', text: '#0f1115', muted: '#61666b', faint: '#81858c',
  line: 'rgba(0, 0, 0, 0.1)', 'line-strong': 'rgba(0, 0, 0, 0.16)',
  selected: '#ebeef2', hover: '#f1f3f5',
  // Focus, business state and non-text accent. Small text uses the darker step.
  accent: '#4176e6', 'accent-hover': '#2f4c8f', 'accent-soft': '#edf3fe', 'accent-border': '#d3e2ff',
  'accent-solid': '#4868b2', 'on-accent': '#ffffff', link: '#4868b2',
  // Official primary-brand button is neutral, not the blue link.
  brand: '#0f1115', 'on-brand': '#ffffff', 'brand-hover': '#43454a',
  bubble: '#edf3fe',
  success: '#01a241', 'success-soft': '#e6faed',
  warning: '#27241f', 'warning-soft': '#fef5e7',
  danger: '#ec1313', 'danger-soft': '#fef2f2',
  scrim: 'rgba(0, 0, 0, 0.48)',
  'menu-fill': 'rgba(248, 249, 250, 0.58)',
  'menu-blur': 'blur(40px) saturate(150%)',
  'elevation-panel': '0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.03), 0 0 16px 0 rgba(0, 0, 0, 0.02)',
  'elevation-prominent': '0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05)',
  'elevation-soft': '0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 4px 16px 0 rgba(0, 0, 0, 0.03), 0 0 24px 0 rgba(0, 0, 0, 0.03)',
  'elevation-focus': '0 0 0 0.5px var(--dsh-ui-accent), 0 0 0 3px var(--dsh-ui-accent-soft)',
  'shadow-xs': 'none',
  'shadow-sm': '0 0 0 0.5px rgba(0, 0, 0, 0.16)',
  'shadow-md': '0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.03), 0 0 16px 0 rgba(0, 0, 0, 0.02)',
  'shadow-lg': '0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05)',
  'shadow-xl': '0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05)',
} as const

export const DARK_TOKENS: Record<keyof typeof LIGHT_TOKENS, string> = {
  bg: '#151517', surface: '#232324', raised: '#2c2c2e', sunken: '#1b1b1c',
  sidebar: '#1b1b1c', text: '#f9fafb', muted: '#adb2b8', faint: '#81858c',
  line: 'rgba(255, 255, 255, 0.12)', 'line-strong': 'rgba(255, 255, 255, 0.2)',
  selected: '#43454a', hover: 'rgba(255, 255, 255, 0.08)',
  accent: '#7aaaff', 'accent-hover': '#b7c8fe',
  'accent-soft': 'rgba(122, 170, 255, 0.16)', 'accent-border': 'rgba(122, 170, 255, 0.4)',
  'accent-solid': '#7aaaff', 'on-accent': '#0f1115', link: '#7aaaff',
  brand: '#f9fafb', 'on-brand': '#0f1115', 'brand-hover': '#ebeef2',
  bubble: '#2c2c2e',
  success: '#4ed17e', 'success-soft': '#233c2c',
  warning: '#f59e0b', 'warning-soft': '#27241f',
  danger: '#f25a5a', 'danger-soft': '#570c0c',
  scrim: 'rgba(0, 0, 0, 0.5)',
  'menu-fill': 'rgba(67, 69, 74, 0.45)',
  'menu-blur': 'blur(40px) saturate(150%)',
  'elevation-panel': '0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.03), 0 0 16px 0 rgba(0, 0, 0, 0.02)',
  'elevation-prominent': '0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05)',
  'elevation-soft': '0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 4px 16px 0 rgba(0, 0, 0, 0.03), 0 0 24px 0 rgba(0, 0, 0, 0.03)',
  'elevation-focus': '0 0 0 0.5px var(--dsh-ui-accent), 0 0 0 3px var(--dsh-ui-accent-soft)',
  'shadow-xs': 'none',
  'shadow-sm': '0 0 0 0.5px rgba(255, 255, 255, 0.16)',
  'shadow-md': '0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 3px 8px 0 rgba(0, 0, 0, 0.03), 0 0 16px 0 rgba(0, 0, 0, 0.02)',
  'shadow-lg': '0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05)',
  'shadow-xl': '0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 3px 8px 0 rgba(0, 0, 0, 0.04), 0 0 20px 0 rgba(0, 0, 0, 0.05)',
}

export const FOUNDATION_TOKENS = {
  'font-ui': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
  'font-mono': '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"',
  'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px',
  'space-5': '20px', 'space-6': '24px', 'space-8': '32px',
  'radius-xs': '4px', 'radius-sm': '8px', 'radius-md': '12px',
  'radius-lg': '16px', 'radius-xl': '20px', 'radius-2xl': '28px', 'radius-panel': '28px', 'radius-full': '999px',
  'text-xs': '12px', 'text-sm': '13px', 'text-base': '14px',
  'text-lg': '16px', 'text-xl': '18px', 'text-2xl': '22px',
  'leading-tight': '1.25', 'leading-normal': '1.5', 'leading-relaxed': '1.7',
  'weight-regular': '400', 'weight-medium': '500', 'weight-strong': '600',
  'duration-fast': '100ms', 'duration-base': '200ms', 'duration-slow': '300ms',
  'ease-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
  'control-sm': '32px', 'control-md': '36px', 'control-lg': '40px',
  'icon-sm': '14px', 'icon-md': '16px', 'icon-lg': '20px',
  'header-height': '48px', 'content-max': '760px',
} as const

export function cssVariables(values: Readonly<Record<string, string>>): string {
  return Object.entries(values).map(([name, value]) => `  --dsh-ui-${name}: ${value};`).join('\n')
}

// HTML scope also reaches Radix portals, which need not retain .shell-theme.
// A theme inside the host uses its own .dark class, not a stale global preference.
export const SCOPE = `html[data-dsh-ui="${DESIGN_SYSTEM_ID}"] .radix-themes`
export const tokenStyles = `
${SCOPE} {
${cssVariables(FOUNDATION_TOKENS)}
${cssVariables(LIGHT_TOKENS)}
  color-scheme: light;
  --gray-1: #ffffff; --gray-2: #f9fafb; --gray-3: #f5f6f7;
  --gray-4: #f1f3f5; --gray-5: #ebeef2; --gray-6: #e1e5ee;
  --gray-7: #cfd3d6; --gray-8: #adb2b8; --gray-9: #979da6;
  --gray-10: #61666b; --gray-11: #61666b; --gray-12: #0f1115;
  --gray-a1: rgba(38, 49, 72, 0.03); --gray-a2: rgba(38, 49, 72, 0.04); --gray-a3: rgba(38, 49, 72, 0.06);
  --gray-a4: rgba(38, 49, 72, 0.1); --gray-a5: rgba(0, 0, 0, 0.1); --gray-a6: rgba(0, 0, 0, 0.12);
  --gray-a7: rgba(0, 0, 0, 0.16); --gray-a8: rgba(0, 0, 0, 0.28);
  --gray-a9: rgba(15, 17, 21, 0.52); --gray-a10: rgba(15, 17, 21, 0.62);
  --gray-a11: rgba(15, 17, 21, 0.72); --gray-a12: rgba(15, 17, 21, 0.92);
  --default-font-family: var(--dsh-ui-font-ui);
  --code-font-family: var(--dsh-ui-font-mono);
  --font-size-1: var(--dsh-ui-text-xs);
  --font-size-2: var(--dsh-ui-text-base);
  --color-background: var(--dsh-ui-bg);
  --color-overlay: var(--dsh-ui-scrim);
  --backdrop-filter-panel: none;
  --color-panel-solid: var(--dsh-ui-raised);
  --color-panel-translucent: var(--dsh-ui-raised);
  --color-surface: var(--dsh-ui-raised);
  /* Official configuration components inherit this local Theme, including
     portals; they must not fall back to a different body theme. Keep their
     selectors owned by the plugin. Small descriptions use the readable step. */
  --dsw-alias-bg-base: var(--dsh-ui-bg);
  --dsw-alias-bg-layer-1: var(--dsh-ui-surface);
  --dsw-alias-bg-layer-2: var(--dsh-ui-raised);
  --dsw-alias-bg-module-platform: var(--dsh-ui-sunken);
  --dsw-alias-label-primary: var(--dsh-ui-text);
  --dsw-alias-label-secondary: var(--dsh-ui-muted);
  --dsw-alias-label-tertiary: var(--dsh-ui-muted);
  --dsw-alias-label-primary-foreground: var(--dsh-ui-on-brand);
  --dsw-alias-button-primary-fill: var(--dsh-ui-brand);
  --dsw-alias-button-primary-hover: var(--dsh-ui-brand-hover);
  --dsw-alias-link: var(--dsh-ui-link);
  --dsw-alias-border-l2: var(--dsh-ui-line);
  --dsw-alias-border-l4: var(--dsh-ui-line-strong);
  --paper-fill: var(--dsh-ui-bg);
  --radius-1: var(--dsh-ui-radius-xs); --radius-2: var(--dsh-ui-radius-sm);
  --radius-3: var(--dsh-ui-radius-md); --radius-4: var(--dsh-ui-radius-lg);
  --radius-5: var(--dsh-ui-radius-xl); --radius-6: var(--dsh-ui-radius-panel);
  --shadow-1: var(--dsh-ui-shadow-sm); --shadow-2: var(--dsh-ui-elevation-soft);
  --shadow-3: var(--dsh-ui-elevation-panel); --shadow-4: var(--dsh-ui-elevation-panel);
  --shadow-5: var(--dsh-ui-elevation-prominent);
}
${SCOPE}.dark {
${cssVariables(DARK_TOKENS)}
  color-scheme: dark;
  --gray-1: #151517; --gray-2: #1b1b1c; --gray-3: #232324;
  --gray-4: #2c2c2e; --gray-5: #353638; --gray-6: #43454a;
  --gray-7: #535458; --gray-8: #81858c; --gray-9: #979da6;
  --gray-10: #adb2b8; --gray-11: #adb2b8; --gray-12: #f9fafb;
  --gray-a1: rgba(255, 255, 255, 0.03); --gray-a2: rgba(255, 255, 255, 0.05); --gray-a3: rgba(255, 255, 255, 0.08);
  --gray-a4: rgba(255, 255, 255, 0.14); --gray-a5: rgba(255, 255, 255, 0.12); --gray-a6: rgba(255, 255, 255, 0.16);
  --gray-a7: rgba(255, 255, 255, 0.2); --gray-a8: rgba(255, 255, 255, 0.32);
  --gray-a9: rgba(249, 250, 251, 0.52); --gray-a10: rgba(249, 250, 251, 0.62);
  --gray-a11: rgba(249, 250, 251, 0.72); --gray-a12: rgba(249, 250, 251, 0.92);
}
/* Saved accents recolor links, focus and business state together. Primary stays neutral. */
${SCOPE}:not([data-accent-color="blue"]) {
  --dsh-ui-accent: var(--accent-9);
  --dsh-ui-accent-hover: var(--accent-10);
  --dsh-ui-accent-solid: var(--accent-9);
  --dsh-ui-accent-soft: var(--accent-a3);
  --dsh-ui-accent-border: var(--accent-a6);
  --dsh-ui-on-accent: var(--accent-contrast);
  --dsh-ui-link: var(--accent-11);
}
${SCOPE}[data-accent-color="blue"] {
  --accent-9: var(--dsh-ui-accent);
  --accent-10: var(--dsh-ui-accent-hover);
  --accent-11: var(--dsh-ui-link);
  --accent-contrast: var(--dsh-ui-on-accent);
  --accent-a3: var(--dsh-ui-accent-soft);
  --accent-a4: var(--dsh-ui-accent-border);
  --accent-a5: var(--dsh-ui-accent-border);
}
`
