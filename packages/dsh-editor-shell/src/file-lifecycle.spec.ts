import { describe, expect, it } from 'vitest'
import { archiveStateText, documentName, visibleArchives, type ArchiveView } from './file-lifecycle.ts'

describe('author file lifecycle presentation', () => {
  it('shows document names without changing their path semantics', () => {
    expect(documentName('正文/第一卷/001.md')).toBe('001')
    expect(documentName('人物卡/阿明.txt')).toBe('阿明')
  })

  it('keeps actionable archive states visible and hides restored history', () => {
    const base = { archiveId: 'a', path: '正文/001.md', createdAt: '2026-08-29T00:00:00Z', bytes: 1 }
    const items: ArchiveView[] = [
      { ...base, archiveId: 'a', state: 'archived' },
      { ...base, archiveId: 'b', state: 'pending-archive' },
      { ...base, archiveId: 'c', state: 'restored' },
    ]
    expect(visibleArchives(items).map((item) => item.archiveId)).toEqual(['a', 'b'])
    expect(archiveStateText(items[1]!)).toBe('待继续归档')
  })
})
