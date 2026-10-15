import { describe, expect, it } from 'vitest'
import {
  HOME_RESUME_KEY,
  chapterExcerpt,
  deriveHomeResumeDoc,
  readHomeResumeMap,
  recentWorkRowMeta,
  removeHomeResumeDoc,
  writeHomeResumeDoc,
  type HomeResumeDoc,
} from './home-resume.ts'

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    dump: () => Object.fromEntries(data),
  }
}

describe('chapterExcerpt', () => {
  it('takes the first non-empty non-heading line after frontmatter', () => {
    expect(chapterExcerpt('---\nbeats: [码头]\n---\n# 雾港夜话\n\n林舟出生在雾港。\n第二行')).toBe('林舟出生在雾港。')
  })

  it('collapses whitespace and truncates long lines', () => {
    const line = `  雨   落在   青石镇。${'长'.repeat(120)}`
    const out = chapterExcerpt(line)
    expect(out).toBeDefined()
    expect(out!.startsWith('雨 落在 青石镇。')).toBe(true)
    expect(out!.length).toBeLessThanOrEqual(91)
    expect(out!.endsWith('…')).toBe(true)
  })

  it('returns undefined when only headings or empty lines exist', () => {
    expect(chapterExcerpt('# 只有标题\n\n## 还是标题')).toBeUndefined()
    expect(chapterExcerpt('   \n\n')).toBeUndefined()
    expect(chapterExcerpt('')).toBeUndefined()
  })

  it('skips a BOM', () => {
    expect(chapterExcerpt('﻿# 标题\n正文一句。')).toBe('正文一句。')
  })
})

describe('deriveHomeResumeDoc', () => {
  it('derives the display title from the first heading like the overview', () => {
    expect(deriveHomeResumeDoc('正文/001.md', '# 雨日归家\n\n林舟进门。')).toEqual({
      path: '正文/001.md',
      title: '雨日归家',
      excerpt: '林舟进门。',
    })
  })

  it('falls back to the file name and omits the excerpt when no body line exists', () => {
    expect(deriveHomeResumeDoc('大纲.md', '# 只有标题')).toEqual({ path: '大纲.md', title: '只有标题' })
    expect(deriveHomeResumeDoc('大纲.md', '')).toEqual({ path: '大纲.md', title: '大纲' })
  })
})

describe('home resume store', () => {
  it('round-trips per workspace and survives corrupt payloads', () => {
    const store = fakeStore()
    const doc: HomeResumeDoc = { path: '正文/001.md', title: '雨日归家', excerpt: '林舟进门。' }
    const stamp = Date.parse('2026-10-15T10:00:00Z')
    writeHomeResumeDoc('w1', { ...doc, updatedAt: stamp }, store)
    writeHomeResumeDoc('w2', { path: '第二章.md', title: '渡口' }, store)
    const map = readHomeResumeMap(store)
    expect(map.w1).toMatchObject(doc)
    expect(map.w2).toMatchObject({ path: '第二章.md', title: '渡口' })
    expect(map.w1!.updatedAt).toBe(stamp)
    /* 草稿期的摘录刷新不带时间戳：沿用上一次保存的 stamp，不重置。 */
    writeHomeResumeDoc('w1', { ...doc, excerpt: '第二段更新。' }, store)
    expect(readHomeResumeMap(store).w1).toMatchObject({ excerpt: '第二段更新。', updatedAt: stamp })
    removeHomeResumeDoc('w1', store)
    expect(readHomeResumeMap(store).w1).toBeUndefined()

    const corrupt = fakeStore({ [HOME_RESUME_KEY]: '{not json' })
    expect(readHomeResumeMap(corrupt)).toEqual({})
    const wrong = fakeStore({ [HOME_RESUME_KEY]: JSON.stringify({ w: { path: 1 } }) })
    expect(readHomeResumeMap(wrong)).toEqual({})
  })
})

describe('recentWorkRowMeta', () => {
  const fmt = (iso: string | undefined) => (iso ? `t:${iso}` : '')
  it('keeps time and chapter as two separate spans', () => {
    const { meta, lineInfo } = recentWorkRowMeta(
      { path: 'C:\\Writing\\ux-work', updatedAt: '2026-10-13' },
      { path: '正文/001.md', title: '雨日归家' },
      fmt,
    )
    expect(meta).toEqual(['t:2026-10-13', '雨日归家'])
    /* 右对齐信息是作品位置（目录末尾两段），不是章节路径。 */
    expect(lineInfo).toBe('…\\Writing\\ux-work')
  })

  it('prefers the save timestamp over the workspace open time, and falls back when absent', () => {
    const stamp = Date.parse('2026-10-15T10:00:00Z')
    const { meta: saved } = recentWorkRowMeta(
      { path: 'C:\\Writing\\ux-work', updatedAt: '2026-10-13' },
      { path: '正文/001.md', title: '雨日归家', updatedAt: stamp },
      fmt,
    )
    expect(saved[0]).toBe(`t:${new Date(stamp).toISOString()}`)
    const { meta: opened } = recentWorkRowMeta(
      { path: 'C:\\Writing\\ux-work', updatedAt: '2026-10-13' },
      { path: '正文/001.md', title: '雨日归家' },
      fmt,
    )
    expect(opened[0]).toBe('t:2026-10-13')
  })

  it('shortens a posix work path with an ellipsis', () => {
    const { lineInfo } = recentWorkRowMeta({ path: '/home/ada/Writing/ux-work' }, undefined, fmt)
    expect(lineInfo).toBe('…/Writing/ux-work')
  })

  it('omits missing pieces instead of joining placeholders', () => {
    expect(recentWorkRowMeta({}, undefined, fmt)).toEqual({ lineInfo: '', meta: [] })
    expect(recentWorkRowMeta({ updatedAt: 'x' }, undefined, fmt)).toEqual({ lineInfo: '', meta: ['t:x'] })
    /* 拿到相对的两段路径时原样展示（没有可截掉的前缀就不加 …）。 */
    expect(recentWorkRowMeta({ path: 'Writing\\ux-work' }, undefined, fmt).lineInfo).toBe('Writing\\ux-work')
  })
})
