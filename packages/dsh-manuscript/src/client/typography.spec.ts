import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TYPOGRAPHY,
  FONT_STACKS,
  formatMaxWidth,
  normalizeTypography,
  resolveFontFamily,
  typographyCssVariables,
} from './editor-core/typography.ts'

describe('typography normalization', () => {
  it('returns today\'s paper defaults when input is omitted', () => {
    expect(normalizeTypography()).toEqual(DEFAULT_TYPOGRAPHY)
    expect(normalizeTypography(null)).toEqual(DEFAULT_TYPOGRAPHY)
    expect(normalizeTypography({})).toEqual(DEFAULT_TYPOGRAPHY)
    expect(DEFAULT_TYPOGRAPHY).toEqual({
      fontSize: 17,
      lineHeight: 1.9,
      fontFamily: FONT_STACKS.serif,
      paragraphSpacing: 0,
      maxWidth: 'none',
    })
  })

  it('clamps fontSize, lineHeight, and paragraphSpacing into the supported ranges', () => {
    expect(normalizeTypography({ fontSize: 10, lineHeight: 1, paragraphSpacing: -1 })).toEqual({
      fontSize: 14,
      lineHeight: 1.4,
      fontFamily: FONT_STACKS.serif,
      paragraphSpacing: 0,
      maxWidth: 'none',
    })
    expect(normalizeTypography({ fontSize: 40, lineHeight: 3, paragraphSpacing: 2 })).toEqual({
      fontSize: 28,
      lineHeight: 2.4,
      fontFamily: FONT_STACKS.serif,
      paragraphSpacing: 1.5,
      maxWidth: 'none',
    })
  })

  it('keeps in-range values and ignores non-finite numbers', () => {
    expect(normalizeTypography({
      fontSize: 20,
      lineHeight: 2,
      paragraphSpacing: 0.8,
      maxWidth: 72,
    })).toMatchObject({
      fontSize: 20,
      lineHeight: 2,
      paragraphSpacing: 0.8,
      maxWidth: '72ch',
    })
    expect(normalizeTypography({
      fontSize: Number.NaN,
      lineHeight: Number.POSITIVE_INFINITY,
      paragraphSpacing: Number.NaN,
      maxWidth: Number.NaN,
    })).toEqual(DEFAULT_TYPOGRAPHY)
  })

  it('treats maxWidth ≤ 120 as ch and larger values as px', () => {
    expect(formatMaxWidth(0)).toBe('none')
    expect(formatMaxWidth(-8)).toBe('none')
    expect(formatMaxWidth(40)).toBe('40ch')
    expect(formatMaxWidth(120)).toBe('120ch')
    expect(formatMaxWidth(121)).toBe('121px')
    expect(formatMaxWidth(720)).toBe('720px')
    expect(normalizeTypography({ maxWidth: 0 }).maxWidth).toBe('none')
  })
})

describe('font stacks', () => {
  it('maps named families onto Chinese-friendly stacks', () => {
    expect(FONT_STACKS.serif).toContain('Noto Serif CJK SC')
    expect(FONT_STACKS.serif).toContain('Source Han Serif')
    expect(FONT_STACKS.serif).toContain('Songti SC')
    expect(FONT_STACKS.serif).toContain('SimSun')
    expect(FONT_STACKS.sans).toContain('Noto Sans CJK SC')
    expect(FONT_STACKS.sans).toContain('PingFang SC')
    expect(FONT_STACKS.sans).toContain('Microsoft YaHei')
    expect(resolveFontFamily('serif')).toBe(FONT_STACKS.serif)
    expect(resolveFontFamily('sans')).toBe(FONT_STACKS.sans)
    expect(resolveFontFamily('mono')).toBe(FONT_STACKS.mono)
    expect(normalizeTypography({ fontFamily: 'sans' }).fontFamily).toBe(FONT_STACKS.sans)
    expect(normalizeTypography({ fontFamily: 'mono' }).fontFamily).toBe(FONT_STACKS.mono)
  })

  it('uses an arbitrary fontFamily string verbatim', () => {
    expect(resolveFontFamily('"LXGW WenKai", serif')).toBe('"LXGW WenKai", serif')
    expect(normalizeTypography({ fontFamily: 'KaiTi, STKaiti, serif' }).fontFamily).toBe('KaiTi, STKaiti, serif')
  })
})

describe('typography CSS variables', () => {
  it('emits the paper variable contract', () => {
    expect(typographyCssVariables(DEFAULT_TYPOGRAPHY)).toEqual({
      '--paper-font-size': '17px',
      '--paper-line-height': '1.9',
      '--paper-font-family': FONT_STACKS.serif,
      '--paper-paragraph-spacing': '0em',
      '--paper-max-width': 'none',
    })
    expect(typographyCssVariables(normalizeTypography({
      fontSize: 18,
      lineHeight: 2.1,
      fontFamily: 'sans',
      paragraphSpacing: 0.5,
      maxWidth: 640,
    }))).toEqual({
      '--paper-font-size': '18px',
      '--paper-line-height': '2.1',
      '--paper-font-family': FONT_STACKS.sans,
      '--paper-paragraph-spacing': '0.5em',
      '--paper-max-width': '640px',
    })
  })
})
