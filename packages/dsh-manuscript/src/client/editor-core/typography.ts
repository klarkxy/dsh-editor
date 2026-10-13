/*
 * Paper typography helpers. Values become CSS variables on the editor root
 * so 纸/墨 themes keep control of color tokens.
 *
 * `maxWidth`: numbers ≤ 120 are treated as `ch` (column measure); larger
 * values are `px`. Non-positive / non-finite values leave the column unset.
 */

export const FONT_STACKS = {
  serif: '"Noto Serif CJK SC", "Source Han Serif", "Songti SC", "SimSun", Georgia, serif',
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Consolas, Monaco, monospace',
} as const

export type TypographyInput = {
  fontSize?: number
  lineHeight?: number
  fontFamily?: 'serif' | 'sans' | 'mono' | string
  paragraphSpacing?: number
  maxWidth?: number
  /** 正文段落首行缩进两个汉字宽度（2em）。 */
  firstLineIndent?: boolean
  /** 中文小节号 / 分节符居中（live preview 装饰，不改文本）。 */
  centerSectionMarks?: boolean
}

export type ResolvedTypography = {
  fontSize: number
  lineHeight: number
  fontFamily: string
  paragraphSpacing: number
  maxWidth: string
  firstLineIndent: boolean
  centerSectionMarks: boolean
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
  fontFamily: FONT_STACKS.sans,
  paragraphSpacing: 0.25,
  maxWidth: '76ch',
  firstLineIndent: false,
  centerSectionMarks: true,
}

const NAMED_FONTS = new Set<string>(['serif', 'sans', 'mono'])

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveFontFamily(fontFamily?: string): string {
  if (!fontFamily) return FONT_STACKS.sans
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
    firstLineIndent: typeof src.firstLineIndent === 'boolean' ? src.firstLineIndent : DEFAULT_TYPOGRAPHY.firstLineIndent,
    centerSectionMarks: typeof src.centerSectionMarks === 'boolean' ? src.centerSectionMarks : DEFAULT_TYPOGRAPHY.centerSectionMarks,
  }
}

export function typographyCssVariables(resolved: ResolvedTypography): Record<string, string> {
  return {
    '--paper-font-size': `${resolved.fontSize}px`,
    '--paper-line-height': String(resolved.lineHeight),
    '--paper-font-family': resolved.fontFamily,
    '--paper-paragraph-spacing': `${resolved.paragraphSpacing}em`,
    '--paper-max-width': resolved.maxWidth,
    '--paper-first-indent': resolved.firstLineIndent ? '2em' : '0',
    /* 版心宽度的长度版（max-width 为 none 时取满宽），供稿纸两侧的版心线定位。 */
    '--paper-measure': resolved.maxWidth === 'none' ? '100%' : resolved.maxWidth,
  }
}

export function isNamedFontStack(value: string): value is keyof typeof FONT_STACKS {
  return NAMED_FONTS.has(value)
}
