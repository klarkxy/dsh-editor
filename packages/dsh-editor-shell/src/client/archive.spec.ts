import { describe, expect, it } from 'vitest'
import { archiveStateText, canArchivePath, visibleArchives, type ArchiveView } from './archive.ts'
import { documentName } from './shared.ts'

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
    expect(archiveStateText(items[1]!)).toBe('归档未完成')
  })

  it('only archives visible Markdown or TXT documents', () => {
    expect(canArchivePath('file', '正文/001.md')).toBe(true)
    expect(canArchivePath('file', '世界书/港口.txt')).toBe(true)
    expect(canArchivePath('directory', '正文')).toBe(false)
    expect(canArchivePath('file', '.dsh-editor/作品索引.md')).toBe(false)
    expect(canArchivePath('file', '封面.jpg')).toBe(false)
  })
})
