/**
 * 「原稿」design-system tokens. 唯一数值来源是 docs/redesign/design-system-spec.md §2。
 * 上游 deepseek-harness 许可证归属不变：
 * resources/third-party/deepseek-harness-MIT.txt（更早的 Kimi Web 声明见
 * kimi-web-MIT.txt）。
 *
 * 公开 token 名保持 --dsh-ui-<key>；插件与 seats 的 --s-* 别名链依赖这些键，
 * 迁移期只改取值与新增键。自选主题色机制已删除（G1 决策 3）：localStorage 的
 * 旧键原样保留、不读不删。
 */
import { dswDeclarations } from './compat.ts'

export const DESIGN_SYSTEM_ID = 'dsh-yuangao' as const
export const DESIGN_SOURCE = {
  repository: 'dsh-editor',
  revision: 'redesign/ui-v2',
  tag: 'dsh-yuangao',
  files: [
    'docs/redesign/decision.md',
    'docs/redesign/design-system-spec.md',
    '.dev/redesign/proposals/b-yuangao/',
  ],
} as const

export const LIGHT_TOKENS = {
  chrome: '#E8EBE6', sidebar: '#E8EBE6',
  bg: '#F7F8F4', paper: '#F7F8F4',
  surface: '#EEF1EC', sunken: '#E1E5DF', raised: '#FFFFFF',
  text: '#1E2420', muted: '#5C655E', faint: '#79827A',
  line: 'rgba(30, 36, 32, 0.10)', 'line-strong': 'rgba(30, 36, 32, 0.18)',
  hover: 'rgba(30, 36, 32, 0.06)', selected: 'rgba(46, 79, 122, 0.12)',
  accent: '#2E4F7A', 'accent-hover': '#233D5F',
  'accent-soft': 'rgba(46, 79, 122, 0.10)', 'accent-border': 'rgba(46, 79, 122, 0.32)',
  'accent-solid': '#2E4F7A', 'on-accent': '#FFFFFF', link: '#2E4F7A',
  brand: '#2E4F7A', 'brand-hover': '#233D5F', 'on-brand': '#FFFFFF',
  bubble: '#E2E8EF',
  marker: '#B23A2A', 'margin-rule': 'rgba(178, 58, 42, 0.35)',
  success: '#2F6B3F', 'success-soft': '#E3F0E5',
  warning: '#8A5A12', 'warning-soft': '#F6EEDC',
  danger: '#A8322A', 'danger-soft': '#F7E4E1',
  scrim: 'rgba(16, 20, 18, 0.48)',
  'menu-fill': '#FFFFFF', 'menu-blur': 'none',
  'switch-thumb': '#FFFFFF',
  'elevation-soft': '0 0 0 0.5px rgba(30, 36, 32, 0.16)',
  'elevation-panel': '0 0 0 0.5px rgba(30, 36, 32, 0.18), 0 6px 20px rgba(30, 36, 32, 0.08)',
  'elevation-prominent': '0 0 0 0.5px rgba(30, 36, 32, 0.20), 0 12px 32px rgba(30, 36, 32, 0.12)',
  'elevation-focus': '0 0 0 1px var(--dsh-ui-accent), 0 0 0 3px var(--dsh-ui-accent-soft)',
  'shadow-xs': 'none',
  'shadow-sm': '0 0 0 0.5px rgba(30, 36, 32, 0.16)',
  'shadow-md': '0 0 0 0.5px rgba(30, 36, 32, 0.18), 0 6px 20px rgba(30, 36, 32, 0.08)',
  'shadow-lg': '0 0 0 0.5px rgba(30, 36, 32, 0.20), 0 12px 32px rgba(30, 36, 32, 0.12)',
  'shadow-xl': '0 0 0 0.5px rgba(30, 36, 32, 0.20), 0 12px 32px rgba(30, 36, 32, 0.12)',
} as const

export const DARK_TOKENS: Record<keyof typeof LIGHT_TOKENS, string> = {
  chrome: '#151816', sidebar: '#151816',
  bg: '#1C201D', paper: '#1C201D',
  surface: '#202521', sunken: '#121513', raised: '#252A26',
  text: '#DADFD6', muted: '#97A096', faint: '#747C73',
  line: 'rgba(218, 223, 214, 0.10)', 'line-strong': 'rgba(218, 223, 214, 0.18)',
  hover: 'rgba(218, 223, 214, 0.06)', selected: 'rgba(143, 176, 222, 0.16)',
  accent: '#8FB0DE', 'accent-hover': '#A9C3E8',
  'accent-soft': 'rgba(143, 176, 222, 0.14)', 'accent-border': 'rgba(143, 176, 222, 0.36)',
  'accent-solid': '#8FB0DE', 'on-accent': '#14181B', link: '#8FB0DE',
  brand: '#8FB0DE', 'brand-hover': '#A9C3E8', 'on-brand': '#14181B',
  bubble: '#26303A',
  marker: '#E07A68', 'margin-rule': 'rgba(224, 122, 104, 0.35)',
  success: '#7CC78F', 'success-soft': '#1F3326',
  warning: '#E0B060', 'warning-soft': '#332A1A',
  danger: '#F08A7E', 'danger-soft': '#3A1F1C',
  scrim: 'rgba(0, 0, 0, 0.55)',
  'menu-fill': '#252A26', 'menu-blur': 'none',
  'switch-thumb': '#E6EAE3',
  'elevation-soft': '0 0 0 0.5px rgba(218, 223, 214, 0.18)',
  'elevation-panel': '0 0 0 0.5px rgba(218, 223, 214, 0.18), 0 6px 20px rgba(0, 0, 0, 0.35)',
  'elevation-prominent': '0 0 0 0.5px rgba(218, 223, 214, 0.20), 0 12px 32px rgba(0, 0, 0, 0.45)',
  'elevation-focus': '0 0 0 1px var(--dsh-ui-accent), 0 0 0 3px var(--dsh-ui-accent-soft)',
  'shadow-xs': 'none',
  'shadow-sm': '0 0 0 0.5px rgba(218, 223, 214, 0.18)',
  'shadow-md': '0 0 0 0.5px rgba(218, 223, 214, 0.18), 0 6px 20px rgba(0, 0, 0, 0.35)',
  'shadow-lg': '0 0 0 0.5px rgba(218, 223, 214, 0.20), 0 12px 32px rgba(0, 0, 0, 0.45)',
  'shadow-xl': '0 0 0 0.5px rgba(218, 223, 214, 0.20), 0 12px 32px rgba(0, 0, 0, 0.45)',
}

export const FOUNDATION_TOKENS = {
  'font-ui': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
  'font-mono': '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"',
  'font-display': '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif',
  'space-1': '4px', 'space-2': '8px', 'space-2-5': '10px', 'space-3': '12px', 'space-4': '16px',
  'space-5': '20px', 'space-6': '24px', 'space-7': '28px', 'space-8': '32px',
  'radius-xs': '4px', 'radius-sm': '6px', 'radius-md': '8px',
  'radius-lg': '12px', 'radius-xl': '16px', 'radius-2xl': '20px', 'radius-panel': '20px', 'radius-full': '999px',
  'text-xs': '12px', 'text-sm': '13px', 'text-base': '14px', 'text-md': '15px',
  'text-lg': '17px', 'text-xl': '20px', 'text-2xl': '24px', 'text-display': '22px',
  'leading-tight': '1.25', 'leading-normal': '1.5', 'leading-relaxed': '1.7',
  'weight-regular': '400', 'weight-medium': '500', 'weight-strong': '600',
  'duration-fast': '120ms', 'duration-base': '180ms', 'duration-slow': '260ms',
  'ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
  'dim-opacity': '0.55',
  'control-xs': '28px', 'control-sm': '32px', 'control-md': '36px', 'control-lg': '40px', 'control-xl': '44px',
  'icon-sm': '14px', 'icon-md': '16px', 'icon-lg': '20px',
  'z-base': '0', 'z-sticky': '10', 'z-rail-overlay': '40', 'z-dropdown': '50',
  'z-dialog': '60', 'z-toast': '70', 'z-tooltip': '80',
  'header-height': '48px', 'content-max': '760px',
  'tap-target': '44px',
} as const

export function cssVariables(values: Readonly<Record<string, string>>): string {
  return Object.entries(values).map(([name, value]) => `  --dsh-ui-${name}: ${value};`).join('\n')
}

/* §3：token 作用域覆盖旧的 Radix Theme 元素和新的 [data-dsh-theme] 根。 */
export const TOKEN_SCOPE = `html[data-dsh-ui="${DESIGN_SYSTEM_ID}"]`
export const SCOPE = `${TOKEN_SCOPE} :is(.radix-themes, [data-dsh-theme])`
export const SCOPE_DARK = `${TOKEN_SCOPE} :is(.radix-themes.dark, [data-dsh-theme="dark"])`

/* §2.4：迁移期 Radix 灰阶映射到原稿中性色；gray-6..9 在 sunken 与 muted
   之间等分插值，gray-a 沿用旧 alpha 阶梯、基色换成正文色。 */
const LIGHT_GRAY = `
  --gray-1: #FFFFFF; --gray-2: #F7F8F4; --gray-3: #EEF1EC;
  --gray-4: #E8EBE6; --gray-5: #E1E5DF; --gray-6: #C6CBC5;
  --gray-7: #ACB2AB; --gray-8: #919892; --gray-9: #777F78;
  --gray-10: #5C655E; --gray-11: #5C655E; --gray-12: #1E2420;
  --gray-a1: rgba(30, 36, 32, 0.02); --gray-a2: rgba(30, 36, 32, 0.03); --gray-a3: rgba(30, 36, 32, 0.05);
  --gray-a4: rgba(30, 36, 32, 0.08); --gray-a5: rgba(30, 36, 32, 0.1); --gray-a6: rgba(30, 36, 32, 0.12);
  --gray-a7: rgba(30, 36, 32, 0.16); --gray-a8: rgba(30, 36, 32, 0.28);
  --gray-a9: rgba(30, 36, 32, 0.48); --gray-a10: rgba(30, 36, 32, 0.58);
  --gray-a11: rgba(30, 36, 32, 0.68); --gray-a12: rgba(30, 36, 32, 0.9);`
const DARK_GRAY = `
  --gray-1: #252A26; --gray-2: #1C201D; --gray-3: #202521;
  --gray-4: #151816; --gray-5: #121513; --gray-6: #2D312D;
  --gray-7: #474D47; --gray-8: #626862; --gray-9: #7C847C;
  --gray-10: #97A096; --gray-11: #97A096; --gray-12: #DADFD6;
  --gray-a1: rgba(218, 223, 214, 0.03); --gray-a2: rgba(218, 223, 214, 0.05); --gray-a3: rgba(218, 223, 214, 0.08);
  --gray-a4: rgba(218, 223, 214, 0.14); --gray-a5: rgba(218, 223, 214, 0.12); --gray-a6: rgba(218, 223, 214, 0.16);
  --gray-a7: rgba(218, 223, 214, 0.2); --gray-a8: rgba(218, 223, 214, 0.32);
  --gray-a9: rgba(218, 223, 214, 0.52); --gray-a10: rgba(218, 223, 214, 0.62);
  --gray-a11: rgba(218, 223, 214, 0.72); --gray-a12: rgba(218, 223, 214, 0.92);`

const RADIX_ALIASES = `
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
  --paper-fill: var(--dsh-ui-paper);
  --radius-1: var(--dsh-ui-radius-xs); --radius-2: var(--dsh-ui-radius-sm);
  --radius-3: var(--dsh-ui-radius-md); --radius-4: var(--dsh-ui-radius-lg);
  --radius-5: var(--dsh-ui-radius-xl); --radius-6: var(--dsh-ui-radius-panel);
  --shadow-1: var(--dsh-ui-shadow-sm); --shadow-2: var(--dsh-ui-elevation-soft);
  --shadow-3: var(--dsh-ui-elevation-panel); --shadow-4: var(--dsh-ui-elevation-panel);
  --shadow-5: var(--dsh-ui-elevation-prominent);`

const dsw = dswDeclarations()

export const tokenStyles = `
${SCOPE} {
${cssVariables(FOUNDATION_TOKENS)}
${cssVariables(LIGHT_TOKENS)}
  color-scheme: light;${LIGHT_GRAY}${RADIX_ALIASES}
${dsw}
}
${SCOPE_DARK} {
${cssVariables(DARK_TOKENS)}
  color-scheme: dark;${DARK_GRAY}${RADIX_ALIASES}
${dsw}
}
`
