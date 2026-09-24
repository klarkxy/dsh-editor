/**
 * Adapted from MoonshotAI/kimi-code (MIT), apps/kimi-web/src/style.css,
 * revision e7d5a0aee74e7f116cca0273c416ece9139a78a0. Not a Kimi-branded client.
 * Copyright (c) 2026 Moonshot AI. See resources/third-party/kimi-web-MIT.txt.
 *
 * Namespaced tokens deliberately do not replace Radix spacing or z-index scales:
 * existing panel geometry, plugins and portalled controls retain their contracts.
 */
export const DESIGN_SYSTEM_ID = 'kimi-web' as const
export const DEFAULT_SHELL_ACCENT = 'blue' as const
export const DESIGN_SOURCE = {
  repository: 'MoonshotAI/kimi-code',
  revision: 'e7d5a0aee74e7f116cca0273c416ece9139a78a0',
  files: ['apps/kimi-web/src/style.css', 'apps/kimi-web/src/components/ui/Button.vue', 'apps/kimi-web/src/views/DesignSystemView.vue'],
} as const

export const LIGHT_TOKENS = {
  bg: '#ffffff', surface: '#fafbfc', raised: '#ffffff', sunken: '#f3f5f8',
  sidebar: '#fbfaf9', text: '#191919', muted: '#6b7280', faint: '#9aa3af',
  line: '#e7eaee', 'line-strong': '#d4d9e0',
  selected: '#00000014', hover: '#0000000d',
  accent: '#1783ff', 'accent-hover': '#0f6fe0', 'accent-soft': '#e8f3ff', 'accent-border': '#cfe6ff',
  // Use the upstream darker blue for small white button labels (contrast >= 4.5).
  'accent-solid': '#0f6fe0', 'on-accent': '#ffffff',
  success: '#0e7a38', 'success-soft': '#e7f6ee',
  warning: '#a9610a', 'warning-soft': '#fbf1e0',
  danger: '#c0392b', 'danger-soft': '#fbeaea',
  scrim: '#00000052',
  'shadow-xs': '0 1px 2px rgb(16 24 40 / 4%)',
  'shadow-sm': '0 1px 2px rgb(16 24 40 / 5%), 0 1px 3px rgb(16 24 40 / 6%)',
  'shadow-md': '0 4px 12px rgb(16 24 40 / 7%), 0 2px 4px rgb(16 24 40 / 5%)',
  'shadow-lg': '0 12px 32px rgb(16 24 40 / 12%), 0 4px 10px rgb(16 24 40 / 8%)',
  'shadow-xl': '0 24px 64px rgb(16 24 40 / 18%), 0 8px 20px rgb(16 24 40 / 10%)',
} as const

export const DARK_TOKENS: Record<keyof typeof LIGHT_TOKENS, string> = {
  bg: '#0d1117', surface: '#161b22', raised: '#1c2128', sunken: '#0d1117',
  sidebar: '#181817', text: '#c9cdd4', muted: '#9aa0a8', faint: '#6b7280',
  line: '#2d333b', 'line-strong': '#3d444d',
  selected: '#ffffff14', hover: '#ffffff0d',
  accent: '#58a6ff', 'accent-hover': '#79b8ff',
  'accent-soft': 'rgb(88 166 255 / 14%)', 'accent-border': 'rgb(88 166 255 / 28%)',
  'accent-solid': '#58a6ff', 'on-accent': '#0d1117',
  success: '#3fb950', 'success-soft': 'rgb(63 185 80 / 14%)',
  warning: '#d29922', 'warning-soft': 'rgb(210 153 34 / 14%)',
  danger: '#f85149', 'danger-soft': 'rgb(248 81 73 / 14%)',
  scrim: '#00000080',
  'shadow-xs': '0 1px 2px rgb(0 0 0 / 20%)',
  'shadow-sm': '0 1px 2px rgb(0 0 0 / 22%), 0 1px 3px rgb(0 0 0 / 18%)',
  'shadow-md': '0 4px 12px rgb(0 0 0 / 30%), 0 2px 4px rgb(0 0 0 / 24%)',
  'shadow-lg': '0 12px 32px rgb(0 0 0 / 34%), 0 4px 10px rgb(0 0 0 / 28%)',
  'shadow-xl': '0 24px 64px rgb(0 0 0 / 42%), 0 8px 20px rgb(0 0 0 / 32%)',
}

export const FOUNDATION_TOKENS = {
  'font-ui': '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans SC", sans-serif',
  'font-mono': '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px',
  'space-5': '20px', 'space-6': '24px', 'space-8': '32px',
  'radius-xs': '4px', 'radius-sm': '6px', 'radius-md': '8px',
  'radius-lg': '12px', 'radius-xl': '16px', 'radius-2xl': '20px', 'radius-full': '999px',
  'text-xs': '12px', 'text-sm': '13px', 'text-base': '14px',
  'text-lg': '16px', 'text-xl': '18px', 'text-2xl': '22px',
  'leading-tight': '1.25', 'leading-normal': '1.5', 'leading-relaxed': '1.7',
  'weight-regular': '400', 'weight-medium': '500', 'weight-strong': '600',
  'duration-fast': '120ms', 'duration-base': '160ms', 'duration-slow': '260ms',
  'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
  'control-sm': '30px', 'control-md': '36px', 'control-lg': '42px',
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
  --gray-1: #ffffff; --gray-2: #fafbfc; --gray-3: #f3f5f8;
  --gray-4: #eceff3; --gray-5: #e7eaee; --gray-6: #d4d9e0;
  --gray-7: #bdc4ce; --gray-8: #9aa3af; --gray-9: #7c8694;
  --gray-10: #6b7280; --gray-11: #6b7280; --gray-12: #191919;
  --gray-a1: #00000003; --gray-a2: #00000006; --gray-a3: #0000000d;
  --gray-a4: #00000014; --gray-a5: #0000001a; --gray-a6: #00000029;
  --gray-a7: #0000003b; --gray-a8: #00000052; --gray-a9: #00000085;
  --gray-a10: #0000008f; --gray-a11: #00000094; --gray-a12: #000000e6;
  --default-font-family: var(--dsh-ui-font-ui);
  --code-font-family: var(--dsh-ui-font-mono);
  --font-size-1: var(--dsh-ui-text-xs);
  --font-size-2: var(--dsh-ui-text-base);
  --color-background: var(--dsh-ui-bg);
  --color-panel-solid: var(--dsh-ui-raised);
  --color-panel-translucent: var(--dsh-ui-raised);
  --color-surface: var(--dsh-ui-raised);
  --paper-fill: var(--dsh-ui-bg);
  --radius-1: var(--dsh-ui-radius-xs); --radius-2: var(--dsh-ui-radius-sm);
  --radius-3: var(--dsh-ui-radius-md); --radius-4: var(--dsh-ui-radius-lg);
  --radius-5: var(--dsh-ui-radius-xl); --radius-6: var(--dsh-ui-radius-2xl);
  --shadow-1: var(--dsh-ui-shadow-xs); --shadow-2: var(--dsh-ui-shadow-sm);
  --shadow-3: var(--dsh-ui-shadow-md); --shadow-4: var(--dsh-ui-shadow-lg);
  --shadow-5: var(--dsh-ui-shadow-xl);
}
${SCOPE}.dark {
${cssVariables(DARK_TOKENS)}
  color-scheme: dark;
  --gray-1: #0d1117; --gray-2: #161b22; --gray-3: #1c2128;
  --gray-4: #252b33; --gray-5: #2d333b; --gray-6: #3d444d;
  --gray-7: #4d5662; --gray-8: #6b7280; --gray-9: #858d98;
  --gray-10: #9aa0a8; --gray-11: #9aa0a8; --gray-12: #c9cdd4;
  --gray-a1: #ffffff03; --gray-a2: #ffffff06; --gray-a3: #ffffff0d;
  --gray-a4: #ffffff14; --gray-a5: #ffffff1a; --gray-a6: #ffffff29;
  --gray-a7: #ffffff3b; --gray-a8: #ffffff52; --gray-a9: #ffffff85;
  --gray-a10: #ffffff8f; --gray-a11: #ffffff94; --gray-a12: #ffffffe6;
}
/* Keep every explicitly saved accent. Blue is the default, not a forced reset. */
${SCOPE}:not([data-accent-color="blue"]) {
  --dsh-ui-accent: var(--accent-9);
  --dsh-ui-accent-hover: var(--accent-10);
  --dsh-ui-accent-solid: var(--accent-9);
  --dsh-ui-accent-soft: var(--accent-a3);
  --dsh-ui-accent-border: var(--accent-a6);
  --dsh-ui-on-accent: var(--accent-contrast);
}
${SCOPE}[data-accent-color="blue"] {
  --accent-9: var(--dsh-ui-accent-solid);
  --accent-10: var(--dsh-ui-accent-hover);
  --accent-11: var(--dsh-ui-accent-solid);
  --accent-contrast: var(--dsh-ui-on-accent);
  --accent-a3: var(--dsh-ui-accent-soft);
  --accent-a4: var(--dsh-ui-accent-border);
}
`
