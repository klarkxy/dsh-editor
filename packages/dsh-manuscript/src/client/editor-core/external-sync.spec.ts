import { describe, expect, it } from 'vitest'
import { diffText, rebaseExternal, type ExternalChange } from './external-sync.ts'

function apply(text: string, changes: readonly ExternalChange[]): string {
  let next = text
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    next = next.slice(0, change.from) + change.insert + next.slice(change.to)
  }
  return next
}

describe('rebaseExternal', () => {
  it('applies disk changes to a clean buffer', () => {
    const base = '第一行。\n第二行。\n第三行。\n'
    const result = rebaseExternal(base, base, '第一行。\n改过的第二行。\n第三行。\n')
    expect(result.kind).toBe('apply')
    if (result.kind !== 'apply') return
    expect(result.merged).toBe('第一行。\n改过的第二行。\n第三行。\n')
    expect(apply(base, result.changes)).toBe(result.merged)
    expect(result.highlights).toHaveLength(1)
  })

  it('merges disjoint author and disk edits', () => {
    const base = '甲\n乙\n丙\n丁\n'
    const mine = '甲\n乙改\n丙\n丁\n'
    const theirs = '甲\n乙\n丙\n丁改\n'
    const result = rebaseExternal(base, mine, theirs)
    expect(result.kind).toBe('apply')
    if (result.kind !== 'apply') return
    expect(result.merged).toBe('甲\n乙改\n丙\n丁改\n')
    expect(apply(mine, result.changes)).toBe(result.merged)
    const inserted = result.merged.slice(result.highlights[0]!.from, result.highlights[0]!.to)
    expect(inserted).toBe('丁改\n')
  })

  it('conflicts when author and disk touch the same range', () => {
    const base = '甲\n乙\n丙\n'
    expect(rebaseExternal(base, '甲\n乙作者\n丙\n', '甲\n乙助手\n丙\n').kind).toBe('conflict')
    // An insertion inside the changed range also conflicts.
    expect(rebaseExternal(base, '甲\n乙\n丙\n'.replace('乙', '乙作者'), '甲\n乙助手\n丙\n').kind).toBe('conflict')
  })

  it('handles CRLF and Chinese text exactly', () => {
    const base = '标题\r\n\r\n正文第一段。\r\n第二段。\r\n'
    const theirs = '标题\r\n\r\n正文第一段改。\r\n第二段。\r\n'
    const result = rebaseExternal(base, base, theirs)
    expect(result.kind).toBe('apply')
    if (result.kind !== 'apply') return
    expect(result.merged).toBe(theirs)
    expect(result.merged).toContain('\r\n')
    expect(apply(base, result.changes)).toBe(theirs)
  })

  it('reconstructs the exact merged string for multi-region changes', () => {
    const base = '一\n二\n三\n四\n五\n六\n'
    const mine = '一\n二\n作者插\n四\n五\n六\n'
    const theirs = '一\n二新\n三\n四\n五新\n六\n尾\n'
    const result = rebaseExternal(base, mine, theirs)
    expect(result.kind).toBe('apply')
    if (result.kind !== 'apply') return
    expect(apply(mine, result.changes)).toBe(result.merged)
    expect(result.merged).toBe('一\n二新\n作者插\n四\n五新\n六\n尾\n')
    expect(result.highlights.map((r) => result.merged.slice(r.from, r.to))).toEqual(['二新\n', '五新\n', '尾\n'])
  })

  it('returns unavailable when a change would touch the hidden prefix', () => {
    const base = '---\n头\n---\n正文。\n'
    const theirs = '---\n头改\n---\n正文。\n'
    expect(rebaseExternal(base, base, theirs, { protectedPrefix: 9 }).kind).toBe('unavailable')
    expect(rebaseExternal(base, base, theirs).kind).toBe('apply')
    // A change after the prefix is still allowed.
    const tail = rebaseExternal(base, base, '---\n头\n---\n正文改。\n', { protectedPrefix: 9 })
    expect(tail.kind).toBe('apply')
  })

  it('produces no highlight for pure deletions and reports an empty change set for identical disk text', () => {
    const base = '甲\n乙\n丙\n'
    const deleted = rebaseExternal(base, base, '甲\n丙\n')
    expect(deleted.kind).toBe('apply')
    if (deleted.kind !== 'apply') return
    expect(deleted.highlights).toHaveLength(0)
    expect(deleted.merged).toBe('甲\n丙\n')
    const same = rebaseExternal(base, '甲\n乙作者\n丙\n', base)
    expect(same.kind).toBe('apply')
    if (same.kind !== 'apply') return
    expect(same.changes).toHaveLength(0)
    expect(same.merged).toBe('甲\n乙作者\n丙\n')
  })
})

describe('diffText', () => {
  it('reports a single region for large middle sections over the budget', () => {
    const a = Array.from({ length: 800 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 800 }, (_, i) => `b${i}`).join('\n')
    const changes = diffText(a, b)
    expect(apply(a, changes)).toBe(b)
    expect(changes).toHaveLength(1)
  })
})
