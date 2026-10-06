import { describe, expect, it } from 'vitest'
import { createMessages } from './index.js'

describe('createMessages', () => {
  const zh = {
    'panel.title': '标题',
    'panel.loading': '正在加载…',
    'panel.count': '共 {count} 项',
    'panel.meta': '{name} · {value} 字',
  } as const

  const en: Record<keyof typeof zh, string> = {
    'panel.title': 'Title',
    'panel.loading': 'Loading…',
    'panel.count': '{count} items',
    'panel.meta': '{name} · {value} chars',
  }

  it('isolates locale state between different panel instances', () => {
    const panelA = createMessages({ zh, en })
    const panelB = createMessages({ zh, en })

    panelA.setLocale('en')
    panelB.setLocale('zh')

    expect(panelA.t('panel.title')).toBe('Title')
    expect(panelB.t('panel.title')).toBe('标题')
  })

  it('returns zh message by default', () => {
    const { t } = createMessages({ zh, en })
    expect(t('panel.title')).toBe('标题')
  })

  it('returns en message after setLocale("en")', () => {
    const { t, setLocale } = createMessages({ zh, en })
    setLocale('en')
    expect(t('panel.title')).toBe('Title')
  })

  it('uses message() with explicit locale', () => {
    const { message } = createMessages({ zh, en })
    expect(message('zh', 'panel.loading')).toBe('正在加载…')
    expect(message('en', 'panel.loading')).toBe('Loading…')
  })

  it('interpolates parameters with {name} placeholders', () => {
    const { t, interpolate } = createMessages({ zh, en })
    expect(t('panel.count', { count: 42 })).toBe('共 42 项')
    expect(interpolate('共 {count} 项', { count: 5 })).toBe('共 5 项')
  })

  it('interpolates zero and preserves missing params as {name}', () => {
    const { t, interpolate } = createMessages({ zh, en })
    expect(t('panel.count', { count: 0 })).toBe('共 0 项')
    expect(interpolate('共 {count} 项', {})).toBe('共 {count} 项')
    expect(interpolate('共 {count} 项')).toBe('共 {count} 项')
  })

  it('interpolates multiple params', () => {
    const { t, setLocale } = createMessages({ zh, en })
    expect(t('panel.meta', { name: '文档', value: 1234 })).toBe('文档 · 1234 字')
    setLocale('en')
    expect(t('panel.meta', { name: 'Doc', value: 5678 })).toBe('Doc · 5678 chars')
  })

  it('formats numbers with distinct locale-aware patterns', () => {
    const { intlLocale, setLocale } = createMessages({ zh, en })

    setLocale('zh')
    const zhLocale = intlLocale()
    const zhFormat = new Intl.NumberFormat(zhLocale)
    expect(zhFormat.format(1234.5)).toBe('1,234.5')
    expect(zhFormat.format(NaN)).toBe('NaN')

    setLocale('en')
    const enLocale = intlLocale()
    const enFormat = new Intl.NumberFormat(enLocale)
    expect(enFormat.format(1234.5)).toBe('1,234.5')
    expect(enFormat.format(NaN)).toBe('NaN')

    // intlLocale accepts explicit locale override
    expect(intlLocale('zh')).toBe('zh-CN')
    expect(intlLocale('en')).toBe('en')
  })
})
