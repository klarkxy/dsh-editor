import { afterEach, describe, expect, it } from 'vitest'
import { formatRecentTime, homeStageCopy, recentWorkPath } from '../home-stage.ts'
import {
  documentLang,
  en,
  getLocale,
  interpolate,
  resetLocaleForTests,
  setLocale,
  t,
  zh,
  type MessageKey,
} from './index.ts'

afterEach(() => {
  resetLocaleForTests()
})

describe('i18n dictionaries', () => {
  it('keeps identical key sets so English never silently falls back', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('has no empty strings in either dictionary', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value, `zh.${key}`).not.toBe('')
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key}`).not.toBe('')
    }
  })

  it('interpolates {name} parameters', () => {
    expect(interpolate('Hello {name}', { name: 'Ada' })).toBe('Hello Ada')
    expect(t('note.created', { path: '正文/001.md' })).toBe('已创建 正文/001.md')
    setLocale('en')
    expect(t('note.created', { path: '正文/001.md' })).toBe('Created 正文/001.md')
  })

  it('falls back to the zh string when an English key is missing', () => {
    const key = 'common.cancel' satisfies MessageKey
    const saved = en[key]
    try {
      delete (en as Record<string, string>)[key]
      setLocale('en')
      expect(t(key)).toBe(zh[key])
    } finally {
      ;(en as Record<string, string>)[key] = saved
    }
  })

  it('switches locale live and updates document.lang', () => {
    expect(getLocale()).toBe('zh')
    expect(t('sidebar.newFile')).toBe('新建文件')
    expect(documentLang()).toBe('zh-CN')
    const previous = globalThis.document
    const element = { lang: '' }
    ;(globalThis as { document?: { documentElement: { lang: string } } }).document = { documentElement: element }
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(t('sidebar.newFile')).toBe('New file')
    expect(element.lang).toBe('en')
    setLocale('zh')
    expect(element.lang).toBe('zh-CN')
    if (previous === undefined) delete (globalThis as { document?: unknown }).document
    else (globalThis as { document?: unknown }).document = previous
  })

  it('keeps representative zh labels identical to the previous UI copy', () => {
    expect(zh['sidebar.search']).toBe('搜索')
    expect(zh['common.search']).toBe('搜索')
  })

  it('keeps home.intro in both dictionaries and interpolates it on the home stage', () => {
    expect(zh['home.intro']).toBeTruthy()
    expect(en['home.intro']).toBeTruthy()
    expect(homeStageCopy().intro).toBe(t('home.intro'))
    expect(homeStageCopy().intro).toBe(zh['home.intro'])
    setLocale('en')
    expect(homeStageCopy().intro).toBe(en['home.intro'])
    expect(homeStageCopy().openWorkDesc).toBe(en['home.openWorkDesc'])
    expect(homeStageCopy().newWorkDesc).toBe(en['home.newDesc'])
  })

  it('formats same-year recent dates with month and day, and shortens disk paths', () => {
    const now = new Date(2026, 8, 17)
    const sameYear = new Date(2026, 2, 5).toISOString()
    expect(formatRecentTime(sameYear, now)).toBe('3月5日')
    setLocale('en')
    expect(formatRecentTime(sameYear, now)).toBe('3/5')
    expect(recentWorkPath('C:\\Users\\ada\\Documents\\dsh-editor\\未名之书')).toBe('dsh-editor/未名之书')
    expect(recentWorkPath('未名之书')).toBe('未名之书')
  })
})
