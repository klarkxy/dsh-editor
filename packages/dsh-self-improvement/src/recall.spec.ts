import { describe, expect, it } from 'vitest'
import { lesson } from './fakes.ts'
import { injectLessonMessages, isSelfImprovementLessonMessage } from './inject.ts'
import { estimateTokens, formatLessonSnapshot, selectActiveLessons } from './recall.ts'

const projectA = { kind: 'project' as const, projectId: '/a' }
const projectB = { kind: 'project' as const, projectId: '/b' }
const now = 100

describe('recall and injection bounds', () => {
  it('never recalls candidates, rejected, revoked, expired, or the wrong project', () => {
    const rows = [
      lesson({ id: 'c', title: 'cand path', content: 'path', status: 'candidate', scope: projectA }),
      lesson({ id: 'r', title: 'rej path', content: 'path', status: 'rejected', scope: projectA }),
      lesson({ id: 'v', title: 'rev path', content: 'path', status: 'revoked', scope: projectA }),
      lesson({ id: 'e', title: 'exp path', content: 'path', status: 'active', scope: projectA, expiresAt: 10 }),
      lesson({ id: 'b', title: 'other path', content: 'path', status: 'active', scope: projectB }),
      lesson({ id: 'g', title: 'global path', content: 'ok path', status: 'active', scope: { kind: 'global' } }),
      lesson({ id: 'a', title: 'here path', content: 'ok path', status: 'active', scope: projectA }),
    ]
    expect(selectActiveLessons(rows, '/a', { now, requestText: 'path' }).map(item => item.id).sort()).toEqual(['a', 'g'])
    expect(selectActiveLessons(rows, '/b', { now, requestText: 'path' }).map(item => item.id).sort()).toEqual(['b', 'g'])
    expect(selectActiveLessons(rows, '/a', { now, requestText: '' })).toEqual([])
  })

  it('ranks by current request relevance instead of latest same-project order', () => {
    const rows = [
      lesson({ id: 'new', title: 'encoding', content: 'always write UTF-16', status: 'active', scope: projectA, updatedAt: 90 }),
      lesson({ id: 'old', title: 'relative paths', content: 'use relative paths', status: 'active', scope: projectA, updatedAt: 10 }),
    ]
    expect(selectActiveLessons(rows, '/a', { now, requestText: 'please keep relative paths' }).map(item => item.id)).toEqual(['old'])
  })

  it('skips oversized records instead of slicing content, and bounds the full wrapper', () => {
    const huge = lesson({
      id: 'huge', title: 'relative', content: 'path '.repeat(8_000), status: 'active', scope: projectA,
    })
    const small = lesson({ id: 'small', title: 'relative path', content: 'keep relative paths', status: 'active', scope: projectA })
    const selected = selectActiveLessons([huge, small], '/a', { now, requestText: 'relative path' })
    expect(selected.map(item => item.id)).toEqual(['small'])
    expect(selected[0]?.content).toBe('keep relative paths')
    expect(estimateTokens(formatLessonSnapshot(selected))).toBeLessThanOrEqual(800)
    expect(formatLessonSnapshot(selected)).not.toMatch(/path path path path/)
  })

  it('injects one source-marked snapshot and will not double-insert', () => {
    const active = [lesson({ id: 'a', title: 'here', content: 'keep paths relative', status: 'active', scope: projectA })]
    const first = injectLessonMessages({ kind: 'enter', messages: [{ id: 'u1' }], startsRequestSeries: true }, active)
    expect(first.kind).toBe('enter')
    if (first.kind !== 'enter') return
    expect(first.startsRequestSeries).toBe(true)
    expect(first.messages.filter(isSelfImprovementLessonMessage)).toHaveLength(1)
    const second = injectLessonMessages(first, active)
    if (second.kind !== 'enter') return
    expect(second.messages.filter(isSelfImprovementLessonMessage)).toHaveLength(1)
  })
})
