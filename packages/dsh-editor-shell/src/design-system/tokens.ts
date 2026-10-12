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

/*
 * Saved accents own the whole shell, not only links: the primary action, the
 * current location and the user bubble all follow the choice, so a saved accent
 * is recognisable from the main interface alone.
 *
 * The primary fill cannot reuse Radix's own accent scale. Radix pairs accent-9
 * with accent-contrast, and that pair does not clear 4.5:1 for every saved
 * accent in light mode (teal is 3.07:1, blue 3.26:1). Each accent therefore
 * carries a pinned solid that clears 4.5:1 against its own label in both modes;
 * `scripts/check-ui-design.mjs` verifies all fourteen pairs.
 */
export const SHELL_ACCENTS = ['indigo', 'blue', 'teal', 'green', 'amber', 'crimson', 'violet'] as const
export type ShellAccent = (typeof SHELL_ACCENTS)[number]

export type AccentSolid = { fill: string; hover: string; on: string }

export const ACCENT_SOLIDS: Record<ShellAccent, { light: AccentSolid; dark: AccentSolid }> = {
  // Blue keeps the pinned official solid so the default still matches the source.
  indigo: { light: { fill: '#3a5bc7', hover: '#2b3a75', on: '#ffffff' }, dark: { fill: '#9eb1ff', hover: '#8098f0', on: '#0f1115' } },
  blue: { light: { fill: '#4868b2', hover: '#36497f', on: '#ffffff' }, dark: { fill: '#7aaaff', hover: '#5f9ae8', on: '#0f1115' } },
  teal: { light: { fill: '#008573', hover: '#00604f', on: '#ffffff' }, dark: { fill: '#0bd8b6', hover: '#09bfa0', on: '#0f1115' } },
  green: { light: { fill: '#218358', hover: '#14503a', on: '#ffffff' }, dark: { fill: '#3dd68c', hover: '#2fbd78', on: '#0f1115' } },
  amber: { light: { fill: '#ab6400', hover: '#7a4700', on: '#ffffff' }, dark: { fill: '#ffca16', hover: '#eab308', on: '#0f1115' } },
  crimson: { light: { fill: '#cb1d63', hover: '#9c1449', on: '#ffffff' }, dark: { fill: '#ff92ad', hover: '#f4728f', on: '#0f1115' } },
  violet: { light: { fill: '#6550b9', hover: '#4a3a8c', on: '#ffffff' }, dark: { fill: '#baa7ff', hover: '#a58ff5', on: '#0f1115' } },
}

export const LIGHT_TOKENS = {
  // One step down from pure white. Pure white paper plus near-black body text
  // is the glare source in light mode; the page now sits a step down and raised
  // surfaces stay the brightest layer, so cards read as cards by depth.
  bg: '#fafaf9', surface: '#f0f0ef', raised: '#ffffff', sunken: '#e9e9e8',
  sidebar: '#f4f4f3', text: '#1f1f1f', muted: '#5f5f5f', faint: '#7a7a7a',
  line: 'rgba(0, 0, 0, 0.08)', 'line-strong': 'rgba(0, 0, 0, 0.14)',
  selected: '#e4e4e3', hover: '#ebebea',
  // Focus, business state and non-text accent. Small text uses the darker step.
  accent: '#4176e6', 'accent-hover': '#2f4c8f', 'accent-soft': '#edf3fe', 'accent-border': '#d3e2ff',
  'accent-solid': '#4868b2', 'on-accent': '#ffffff', link: '#4868b2',
  // Primary follows the saved accent. These blue values are the fallback for a
  // host Theme that carries no accentColor, and must match the blue table row.
  brand: '#4868b2', 'on-brand': '#ffffff', 'brand-hover': '#36497f',
  bubble: '#e6eefb',
  success: '#127034', 'success-soft': '#e6faed',
  warning: '#27241f', 'warning-soft': '#fef5e7',
  danger: '#b91c1c', 'danger-soft': '#fef2f2',
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
  bg: '#1e1e1e', surface: '#242424', raised: '#2e2e2e', sunken: '#181818',
  sidebar: '#262626', text: '#dadada', muted: '#a3a3a3', faint: '#7f7f7f',
  line: 'rgba(255, 255, 255, 0.08)', 'line-strong': 'rgba(255, 255, 255, 0.16)',
  selected: '#363636', hover: 'rgba(255, 255, 255, 0.07)',
  accent: '#7aaaff', 'accent-hover': '#b7c8fe',
  'accent-soft': 'rgba(122, 170, 255, 0.16)', 'accent-border': 'rgba(122, 170, 255, 0.4)',
  'accent-solid': '#7aaaff', 'on-accent': '#0f1115', link: '#7aaaff',
  // Primary follows the saved accent; see the blue row of ACCENT_SOLIDS.
  brand: '#7aaaff', 'on-brand': '#0f1115', 'brand-hover': '#5f9ae8',
  bubble: '#2c2c2e',
  success: '#4ed17e', 'success-soft': '#233c2c',
  warning: '#f59e0b', 'warning-soft': '#27241f',
  danger: '#ff7b7b', 'danger-soft': '#570c0c',
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
  'space-1': '4px', 'space-2': '8px', 'space-2-5': '10px', 'space-3': '12px', 'space-4': '16px',
  'space-5': '20px', 'space-6': '24px', 'space-7': '28px', 'space-8': '32px',
  'radius-xs': '4px', 'radius-sm': '8px', 'radius-md': '12px',
  'radius-lg': '16px', 'radius-xl': '20px', 'radius-2xl': '28px', 'radius-panel': '28px', 'radius-full': '999px',
  'text-xs': '12px', 'text-sm': '13px', 'text-base': '14px', 'text-md': '15px',
  'text-lg': '17px', 'text-xl': '20px', 'text-2xl': '24px',
  'leading-tight': '1.25', 'leading-normal': '1.5', 'leading-relaxed': '1.7',
  'weight-regular': '400', 'weight-medium': '500', 'weight-strong': '600',
  'duration-fast': '100ms', 'duration-base': '200ms', 'duration-slow': '300ms',
  'ease-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
  'control-xs': '28px', 'control-sm': '32px', 'control-md': '36px', 'control-lg': '40px', 'control-xl': '44px',
  'icon-sm': '14px', 'icon-md': '16px', 'icon-lg': '20px',
  'header-height': '48px', 'content-max': '760px',
  'tap-target': '44px',
} as const

export function cssVariables(values: Readonly<Record<string, string>>): string {
  return Object.entries(values).map(([name, value]) => `  --dsh-ui-${name}: ${value};`).join('\n')
}

// HTML scope also reaches Radix portals, which need not retain .shell-theme.
// A theme inside the host uses its own .dark class, not a stale global preference.
export const SCOPE = `html[data-dsh-ui="${DESIGN_SYSTEM_ID}"] .radix-themes`
// Saved accents recolor links, focus, business state, the current location and
// the user bubble together. These rules are emitted after both theme blocks so
// their (0,3,1)/(0,4,1) specificity wins over the static tokens they override.
// A Theme with no accentColor keeps the static blue values untouched.
const accentRoleRules = `
${SCOPE}[data-accent-color] {
  --dsh-ui-accent: var(--accent-9, #4176e6);
  --dsh-ui-accent-hover: var(--accent-10, #2f4c8f);
  --dsh-ui-accent-solid: var(--accent-11, #4868b2);
  --dsh-ui-accent-soft: var(--accent-a3, #edf3fe);
  --dsh-ui-accent-border: var(--accent-a6, #d3e2ff);
  --dsh-ui-on-accent: var(--accent-contrast, #ffffff);
  --dsh-ui-link: var(--accent-11, #4868b2);
  --dsh-ui-selected: var(--accent-a4, #e6e8ec);
  --dsh-ui-bubble: var(--accent-a3, #e6eefb);
}
${SCOPE}.dark[data-accent-color] {
  --dsh-ui-accent: var(--accent-9, #7aaaff);
  --dsh-ui-accent-hover: var(--accent-10, #b7c8fe);
  --dsh-ui-accent-solid: var(--accent-11, #7aaaff);
  --dsh-ui-accent-soft: var(--accent-a3, rgba(122, 170, 255, 0.16));
  --dsh-ui-accent-border: var(--accent-a6, rgba(122, 170, 255, 0.4));
  --dsh-ui-on-accent: var(--accent-contrast, #0f1115);
  --dsh-ui-link: var(--accent-11, #7aaaff);
  --dsh-ui-selected: var(--accent-a4, #2b3145);
  --dsh-ui-bubble: var(--accent-a3, #2c2c2e);
}`

// The primary action is the strongest accent signal in the shell, so each saved
// accent names its own fill, hover and label instead of aliasing the Radix
// scale, whose readable step is not readable enough in light mode.
const accentSolidRules = SHELL_ACCENTS.flatMap((accent) => {
  const { light, dark } = ACCENT_SOLIDS[accent]
  return [
    `${SCOPE}[data-accent-color="${accent}"] { --dsh-ui-brand: ${light.fill}; --dsh-ui-brand-hover: ${light.hover}; --dsh-ui-on-brand: ${light.on}; }`,
    `${SCOPE}.dark[data-accent-color="${accent}"] { --dsh-ui-brand: ${dark.fill}; --dsh-ui-brand-hover: ${dark.hover}; --dsh-ui-on-brand: ${dark.on}; }`,
  ]
}).join('\n')

export const tokenStyles = `
${SCOPE} {
${cssVariables(FOUNDATION_TOKENS)}
${cssVariables(LIGHT_TOKENS)}
  color-scheme: light;
  --gray-1: #ffffff; --gray-2: #fafaf9; --gray-3: #f4f4f3;
  --gray-4: #ededec; --gray-5: #e6e6e5; --gray-6: #dcdcdb;
  --gray-7: #cbcbca; --gray-8: #ababaa; --gray-9: #949494;
  --gray-10: #5f5f5f; --gray-11: #5f5f5f; --gray-12: #1f1f1f;
  --gray-a1: rgba(0, 0, 0, 0.02); --gray-a2: rgba(0, 0, 0, 0.03); --gray-a3: rgba(0, 0, 0, 0.05);
  --gray-a4: rgba(0, 0, 0, 0.08); --gray-a5: rgba(0, 0, 0, 0.1); --gray-a6: rgba(0, 0, 0, 0.12);
  --gray-a7: rgba(0, 0, 0, 0.16); --gray-a8: rgba(0, 0, 0, 0.28);
  --gray-a9: rgba(0, 0, 0, 0.48); --gray-a10: rgba(0, 0, 0, 0.58);
  --gray-a11: rgba(0, 0, 0, 0.68); --gray-a12: rgba(0, 0, 0, 0.9);
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
  /* Native tags and plugin links use state aliases for small text as well as
     icons. Map them to readable host colors without selecting plugin internals. */
  --dsw-alias-state-business-primary: color-mix(in srgb, var(--dsh-ui-link) 85%, var(--dsh-ui-text));
  --dsw-alias-state-success-primary: var(--dsh-ui-success);
  --dsw-alias-state-error-primary: var(--dsh-ui-danger);
  --dsw-alias-label-error: var(--dsh-ui-danger);
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
  --gray-1: #1e1e1e; --gray-2: #232323; --gray-3: #282828;
  --gray-4: #2e2e2e; --gray-5: #353535; --gray-6: #3f3f3f;
  --gray-7: #4d4d4d; --gray-8: #6e6e6e; --gray-9: #8a8a8a;
  --gray-10: #a3a3a3; --gray-11: #a3a3a3; --gray-12: #dadada;
  --gray-a1: rgba(255, 255, 255, 0.03); --gray-a2: rgba(255, 255, 255, 0.05); --gray-a3: rgba(255, 255, 255, 0.08);
  --gray-a4: rgba(255, 255, 255, 0.14); --gray-a5: rgba(255, 255, 255, 0.12); --gray-a6: rgba(255, 255, 255, 0.16);
  --gray-a7: rgba(255, 255, 255, 0.2); --gray-a8: rgba(255, 255, 255, 0.32);
  --gray-a9: rgba(218, 218, 218, 0.52); --gray-a10: rgba(218, 218, 218, 0.62);
  --gray-a11: rgba(218, 218, 218, 0.72); --gray-a12: rgba(218, 218, 218, 0.92);
}
${accentRoleRules}
${accentSolidRules}
`
