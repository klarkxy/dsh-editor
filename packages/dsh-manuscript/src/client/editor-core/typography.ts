/*
 * Paper typography helpers. Values become CSS variables on the editor root
 * so 纸/墨 themes keep control of color tokens.
 *
 * `maxWidth`: numbers ≤ 120 are treated as `ch` (column measure); larger
 * values are `px`. Non-positive / non-finite values leave the column unset.
 */

export const FONT_STACKS = {
  serif: '"Noto Serif CJK SC", "Source Han Serif", "Songti SC", "SimSun", Georgia, serif',
  sans: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Consolas, Monaco, monospace',
} as const

export type TypographyInput = {
  fontSize?: number
  lineHeight?: number
  fontFamily?: 'serif' | 'sans' | 'mono' | string
  paragraphSpacing?: number
  maxWidth?: number
}

export type ResolvedTypography = {
  fontSize: number
  lineHeight: number
  fontFamily: string
  paragraphSpacing: number
  maxWidth: string
}

export const TYPOGRAPHY_LIMITS = {
  fontSize: { min: 14, max: 28 },
  lineHeight: { min: 1.4, max: 2.4 },
  paragraphSpacing: { min: 0, max: 1.5 },
  maxWidthCh: 120,
} as const

export const DEFAULT_TYPOGRAPHY: ResolvedTypography = {
  fontSize: 17,
  lineHeight: 1.9,
  fontFamily: FONT_STACKS.serif,
  paragraphSpacing: 0,
  maxWidth: 'none',
}

const NAMED_FONTS = new Set<string>(['serif', 'sans', 'mono'])

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveFontFamily(fontFamily?: string): string {
  if (!fontFamily) return FONT_STACKS.serif
  if (fontFamily === 'serif' || fontFamily === 'sans' || fontFamily === 'mono') {
    return FONT_STACKS[fontFamily]
  }
  return fontFamily
}

export function formatMaxWidth(value: number): string {
  if (!(value > 0)) return 'none'
  return value <= TYPOGRAPHY_LIMITS.maxWidthCh ? `${value}ch` : `${value}px`
}

export function normalizeTypography(input?: TypographyInput | null): ResolvedTypography {
  const src = input ?? {}
  return {
    fontSize: finiteNumber(src.fontSize)
      ? clamp(src.fontSize, TYPOGRAPHY_LIMITS.fontSize.min, TYPOGRAPHY_LIMITS.fontSize.max)
      : DEFAULT_TYPOGRAPHY.fontSize,
    lineHeight: finiteNumber(src.lineHeight)
      ? clamp(src.lineHeight, TYPOGRAPHY_LIMITS.lineHeight.min, TYPOGRAPHY_LIMITS.lineHeight.max)
      : DEFAULT_TYPOGRAPHY.lineHeight,
    fontFamily: resolveFontFamily(src.fontFamily),
    paragraphSpacing: finiteNumber(src.paragraphSpacing)
      ? clamp(src.paragraphSpacing, TYPOGRAPHY_LIMITS.paragraphSpacing.min, TYPOGRAPHY_LIMITS.paragraphSpacing.max)
      : DEFAULT_TYPOGRAPHY.paragraphSpacing,
    maxWidth: finiteNumber(src.maxWidth) ? formatMaxWidth(src.maxWidth) : DEFAULT_TYPOGRAPHY.maxWidth,
  }
}

export function typographyCssVariables(resolved: ResolvedTypography): Record<string, string> {
  return {
    '--paper-font-size': `${resolved.fontSize}px`,
    '--paper-line-height': String(resolved.lineHeight),
    '--paper-font-family': resolved.fontFamily,
    '--paper-paragraph-spacing': `${resolved.paragraphSpacing}em`,
    '--paper-max-width': resolved.maxWidth,
  }
}

export function isNamedFontStack(value: string): value is keyof typeof FONT_STACKS {
  return NAMED_FONTS.has(value)
}
