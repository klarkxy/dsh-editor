import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

const CLIENT_ROOT = join(import.meta.dirname, '../client')

const CJK_ALLOWLIST = [
  '正文',
  '人物卡',
  '世界书',
  '大纲',
  '.dsh-editor',
  '敏感词',
  '作品索引',
  '文档/dsh-editor',
  '下载已取消',
] as const

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
    expect(zh['status.draft']).toBe('草稿')
    expect(zh['status.revising']).toBe('修订中')
    expect(zh['status.final']).toBe('已定稿')
  })
})

function walkClientFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkClientFiles(path, acc)
    else if (/\.(ts|tsx)$/.test(name) && !/\.spec\.(ts|tsx)$/.test(name)) acc.push(path)
  }
  return acc
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function isAllowlisted(raw: string): boolean {
  let rest = raw
  for (const token of CJK_ALLOWLIST) rest = rest.split(token).join('')
  return !/[\u3400-\u9FFF\uF900-\uFAFF]/.test(rest)
}

function extractUiCjkLiterals(source: string): string[] {
  const stripped = stripComments(source)
  const hits: string[] = []
  const stringRe = /(['"`])(?:\\.|[^\\])*?\1/g
  let match: RegExpExecArray | null
  while ((match = stringRe.exec(stripped))) {
    const literal = match[0]
    if (!/[\u3400-\u9FFF\uF900-\uFAFF]/.test(literal)) continue
    const around = stripped.slice(Math.max(0, match.index - 80), match.index + literal.length + 40)
    const inUi = /\be\s*\(|<[A-Za-z][\w.:-]*|aria-|placeholder|title:|label:|heading:|hint:|message:/.test(around)
    if (!inUi) continue
    if (isAllowlisted(literal)) continue
    hits.push(literal)
  }
  return hits
}

describe('client UI source has no leftover CJK literals', () => {
  it('flags new Chinese UI strings outside the path-constant allowlist', () => {
    const leftover: string[] = []
    for (const file of walkClientFiles(CLIENT_ROOT)) {
      const source = readFileSync(file, 'utf8')
      for (const literal of extractUiCjkLiterals(source)) {
        leftover.push(`${file.replace(/\\/g, '/')}: ${literal.slice(0, 120)}`)
      }
    }
    expect(leftover).toEqual([])
  })
})
