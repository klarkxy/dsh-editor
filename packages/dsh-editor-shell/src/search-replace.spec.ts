import { describe, expect, it } from 'vitest'
import {
  applyReplaceToText,
  classifyReplaceRead,
  planReplace,
  prepareReplaceWrite,
  spansMatchQuery,
  summarizeReplacePlan,
  type ReplaceableHit,
} from './search-replace.ts'

function hit(path: string, start: number, end: number, version = 'v1'): ReplaceableHit {
  return { path, start, end, version }
}

describe('planReplace', () => {
  it('groups hits by file in natural path order and sorts spans descending', () => {
    const plan = planReplace([
      hit('正文/002.md', 10, 12),
      hit('正文/010.md', 0, 2),
      hit('正文/002.md', 4, 6),
      hit('正文/001.md', 1, 3),
    ], 'X')
    expect(plan.replacement).toBe('X')
    expect(plan.files.map((file) => file.path)).toEqual(['正文/001.md', '正文/002.md', '正文/010.md'])
    expect(plan.files[1]!.spans).toEqual([{ start: 10, end: 12 }, { start: 4, end: 6 }])
    expect(plan.files.map((file) => file.version)).toEqual(['v1', 'v1', 'v1'])
    expect(plan.skipped).toBe(0)
    expect(plan.stale).toEqual([])
  })

  it('drops overlapping spans and records the skipped count', () => {
    const plan = planReplace([
      hit('正文/001.md', 0, 5),
      hit('正文/001.md', 3, 8),
      hit('正文/001.md', 10, 12),
    ], '-')
    expect(plan.skipped).toBe(1)
    expect(plan.files[0]!.spans).toEqual([{ start: 10, end: 12 }, { start: 3, end: 8 }])
  })

  it('keeps adjacent spans that only touch at an edge', () => {
    const plan = planReplace([
      hit('正文/001.md', 0, 3),
      hit('正文/001.md', 3, 6),
    ], 'x')
    expect(plan.skipped).toBe(0)
    expect(plan.files[0]!.spans).toEqual([{ start: 3, end: 6 }, { start: 0, end: 3 }])
  })

  it('marks a file stale when its hits disagree on version and excludes it', () => {
    const plan = planReplace([
      hit('正文/001.md', 0, 2, 'v1'),
      hit('正文/001.md', 4, 6, 'v2'),
      hit('正文/002.md', 0, 2, 'v1'),
    ], 'x')
    expect(plan.stale).toEqual(['正文/001.md'])
    expect(plan.files.map((file) => file.path)).toEqual(['正文/002.md'])
    expect(plan.skipped).toBe(0)
  })

  it('drops invalid spans from the plan', () => {
    const plan = planReplace([
      hit('正文/001.md', 4, 2),
      hit('正文/001.md', 0, 2),
    ], 'x')
    expect(plan.skipped).toBe(1)
    expect(plan.files[0]!.spans).toEqual([{ start: 0, end: 2 }])
  })
})

describe('applyReplaceToText', () => {
  it('applies spans from the end so earlier offsets stay valid', () => {
    expect(applyReplaceToText('hello hello', [{ start: 0, end: 5 }, { start: 6, end: 11 }], 'hi')).toBe('hi hi')
    expect(applyReplaceToText('aaXaaX', [{ start: 0, end: 2 }, { start: 3, end: 5 }], 'bbb')).toBe('bbbXbbbX')
  })

  it('treats replacement as a literal string, including $& and $1', () => {
    expect(applyReplaceToText('ab', [{ start: 0, end: 2 }], '$&')).toBe('$&')
    expect(applyReplaceToText('ab', [{ start: 0, end: 2 }], '$1')).toBe('$1')
  })

  it('throws when a span is out of range', () => {
    expect(() => applyReplaceToText('ab', [{ start: 0, end: 3 }], 'x')).toThrow(RangeError)
    expect(() => applyReplaceToText('ab', [{ start: -1, end: 1 }], 'x')).toThrow(RangeError)
    expect(() => applyReplaceToText('ab', [{ start: 2, end: 1 }], 'x')).toThrow(RangeError)
  })
})

describe('summarizeReplacePlan', () => {
  it('counts planned files, occurrences, overlaps, and stale files', () => {
    const plan = planReplace([
      hit('正文/002.md', 0, 2),
      hit('正文/002.md', 4, 6),
      hit('正文/001.md', 0, 2),
      hit('正文/003.md', 0, 2, 'v1'),
      hit('正文/003.md', 4, 6, 'v2'),
      hit('正文/002.md', 5, 8),
    ], 'y')
    expect(summarizeReplacePlan(plan)).toEqual({
      files: 2,
      occurrences: 3,
      skipped: 1,
      staleFiles: 1,
      perFile: [
        { path: '正文/001.md', count: 1 },
        { path: '正文/002.md', count: 2 },
      ],
    })
  })
})

describe('replace write guards', () => {
  const file = { path: '正文/001.md', version: 'v1', spans: [{ start: 0, end: 3 }] }

  it('accepts the host span when the current text still matches the query case-insensitively', () => {
    expect(spansMatchQuery('Foo bar', [{ start: 0, end: 3 }], 'foo')).toBe(true)
    expect(classifyReplaceRead(file, { text: 'FOO', version: 'v1' }, 'foo')).toBe('ok')
    expect(prepareReplaceWrite(file, { text: 'FOO', version: 'v1' }, 'foo', 'bar')).toEqual({ ok: true, text: 'bar' })
  })

  it('marks the file stale when the disk version moved, or changed when the span text no longer matches', () => {
    expect(classifyReplaceRead(file, { text: 'FOO', version: 'v9' }, 'foo')).toBe('stale')
    expect(classifyReplaceRead(file, { text: 'bar', version: 'v1' }, 'foo')).toBe('changed')
    expect(prepareReplaceWrite(file, { text: 'bar', version: 'v1' }, 'foo', 'x')).toEqual({ ok: false, reason: 'changed' })
  })
})
