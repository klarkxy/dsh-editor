import { describe, expect, it } from 'vitest'
import { planReplace } from '../search-replace.ts'
import { acceptSearchResults, canReplaceAll, executeReplacePlan, groupSearchHits, paperRevealRange, replaceBlockedByDirty, replaceOutcomeForIdentity, scopeSearchResults, searchIdentity, searchQueryClearsResults, searchTextRequest, type SearchHit } from './search-panel.ts'

function hit(path: string, start: number, excerpt: string): SearchHit {
  return { path, line: 1, column: 1, start, end: start + excerpt.length, excerpt, version: 'v1' }
}

describe('search result grouping', () => {
  it('groups hits by file while keeping excerpt order', () => {
    const grouped = groupSearchHits([
      hit('正文/002.md', 10, '后港口'),
      hit('世界书/港口.md', 0, '港口'),
      hit('正文/002.md', 40, '再港口'),
    ])
    expect(grouped.map((group) => group.path)).toEqual(['正文/002.md', '世界书/港口.md'])
    expect(grouped[0]!.hits.map((item) => item.excerpt)).toEqual(['后港口', '再港口'])
    expect(grouped[1]!.hits).toHaveLength(1)
  })

  it('returns an empty list for no hits', () => {
    expect(groupSearchHits([])).toEqual([])
  })

  it('maps a search hit onto paper coordinates after worldbook frontmatter', () => {
    const text = '---\ntriggers: ["港口"]\nenabled: true\npriority: 1\n---\n港口规则'
    const range = paperRevealRange('世界书/港口.md', text, { start: text.indexOf('港口规则'), end: text.indexOf('港口规则') + 4 })
    expect(range.from).toBe(0)
    expect(range.to).toBe(4)
  })

  it('maps a search hit onto paper coordinates after chapter frontmatter', () => {
    const text = '---\nbeats: [码头]\n---\n港口规则'
    const range = paperRevealRange('正文/002.md', text, { start: text.indexOf('港口规则'), end: text.indexOf('港口规则') + 4 })
    expect(range.from).toBe(0)
    expect(range.to).toBe(4)
  })
})

describe('directory search request payload', () => {
  it('sends the active document directory for directory scope and omits it for project scope', () => {
    expect(searchTextRequest({
      sessionId: 's1',
      query: '港口',
      scope: 'directory',
      activePath: 'docs/target.md',
    })).toEqual({
      sessionId: 's1',
      query: '港口',
      scope: 'project',
      directory: 'docs',
    })
    expect(searchTextRequest({
      sessionId: 's1',
      query: '港口',
      scope: 'project',
      activePath: 'docs/target.md',
    })).toEqual({
      sessionId: 's1',
      query: '港口',
      scope: 'project',
    })
    expect(searchTextRequest({
      sessionId: 's1',
      query: '港口',
      scope: 'directory',
      activePath: 'root.md',
    })).toEqual({
      sessionId: 's1',
      query: '港口',
      scope: 'project',
    })
  })

  it('still filters Host hits to the active folder as defense in depth', () => {
    const scoped = scopeSearchResults({
      results: [hit('docs/target.md', 0, 'needle'), hit('aaa.md', 0, 'needle')],
      scannedFiles: 2,
      scannedBytes: 40,
      skipped: 0,
      truncated: true,
    }, 'directory', 'docs/target.md')
    expect(scoped.results.map((item) => item.path)).toEqual(['docs/target.md'])
    expect(scoped.truncated).toBe(true)
  })
})

describe('controlled search query', () => {
  it('clears the current result set when the sidebar query is blank', () => {
    expect(searchQueryClearsResults('')).toBe(true)
    expect(searchQueryClearsResults('   ')).toBe(true)
    expect(searchQueryClearsResults('港口')).toBe(false)
  })
})

describe('auxiliary search filtering', () => {
  it('drops AGENTS.md from accepted hits so replace never plans it', () => {
    const accepted = acceptSearchResults({
      results: [
        hit('AGENTS.md', 0, '隔离测试'),
        hit('正文/001.md', 4, '隔离测试'),
        hit('CLAUDE.md', 0, '隔离测试'),
      ],
      scannedFiles: 8,
      scannedBytes: 1200,
      skipped: 1,
      truncated: true,
    })
    expect(accepted.results.map((item) => item.path)).toEqual(['正文/001.md'])
    expect(accepted.scannedFiles).toBe(8)
    expect(accepted.skipped).toBe(1)
    expect(accepted.truncated).toBe(true)
    const plan = planReplace(accepted.results, '替换')
    expect(plan.files.map((file) => file.path)).toEqual(['正文/001.md'])
    expect(plan.files).toHaveLength(1)
  })
})

describe('replace panel helpers', () => {
  it('disables replace when there are no hits or the replacement equals the query', () => {
    expect(canReplaceAll({ query: 'foo', replacement: 'bar', hits: 0 })).toBe(false)
    expect(canReplaceAll({ query: 'foo', replacement: 'foo', hits: 3 })).toBe(false)
    expect(canReplaceAll({ query: 'foo', replacement: 'bar', hits: 3 })).toBe(true)
    expect(canReplaceAll({ query: 'Foo', replacement: 'foo', hits: 1 })).toBe(true)
  })

  it('blocks replace when the open dirty document is in the plan', () => {
    expect(replaceBlockedByDirty({ activePath: '正文/001.md', activeDirty: true, paths: ['正文/001.md'] })).toBe(true)
    expect(replaceBlockedByDirty({ activePath: '正文/001.md', activeDirty: true, paths: ['正文/002.md'] })).toBe(false)
    expect(replaceBlockedByDirty({ activePath: '正文/001.md', activeDirty: false, paths: ['正文/001.md'] })).toBe(false)
    expect(replaceBlockedByDirty({ activePath: '', activeDirty: true, paths: ['正文/001.md'] })).toBe(false)
  })
})


describe('search context identity', () => {
  it('invalidates accepted hits and confirmation on query, scope, or active directory changes', () => {
    const project = searchIdentity({ sessionId: 's1', revision: 1, query: '港口', scope: 'project', activePath: 'docs/a.md' })
    const directory = searchIdentity({ sessionId: 's1', revision: 1, query: '港口', scope: 'directory', activePath: 'docs/a.md' })
    expect(project).not.toBe(directory)
    expect(directory).not.toBe(searchIdentity({ sessionId: 's1', revision: 1, query: '港口', scope: 'directory', activePath: 'other/b.md' }))
    expect(directory).not.toBe(searchIdentity({ sessionId: 's1', revision: 1, query: '海港', scope: 'directory', activePath: 'docs/a.md' }))
    expect(directory).toBe(searchIdentity({ sessionId: 's1', revision: 1, query: '港口', scope: 'directory', activePath: 'docs/b.md' }))
  })
})

describe('replacement outcome context', () => {
  it('retains completed and partial counts across a remount of the same context, then hides them after identity changes', () => {
    const identity = searchIdentity({ sessionId: 's1', revision: 1, query: 'foo', scope: 'directory', activePath: 'docs/a.md' })
    const outcome = { files: 1, occurrences: 2, stale: ['docs/b.md'], changed: [], failed: ['docs/c.md'] }
    const report = { identity, outcome }
    expect(replaceOutcomeForIdentity(report, identity)).toBe(outcome)
    expect(replaceOutcomeForIdentity(report, searchIdentity({
      sessionId: 's1', revision: 1, query: 'other', scope: 'directory', activePath: 'docs/a.md',
    }))).toBeNull()
    expect(replaceOutcomeForIdentity(report, searchIdentity({
      sessionId: 's2', revision: 1, query: 'foo', scope: 'directory', activePath: 'docs/a.md',
    }))).toBeNull()
  })
})

describe('confirmed replace execution', () => {
  it('waits for delayed writes, continues to remaining files, and reports every completed write', async () => {
    const plan = planReplace([hit('docs/a.md', 0, 'foo'), hit('docs/b.md', 0, 'foo')], 'bar')
    let finishFirstWrite!: (value: { ok: true; value: { version: string } }) => void
    const firstWrite = new Promise<{ ok: true; value: { version: string } }>((resolve) => { finishFirstWrite = resolve })
    const writes: string[] = []
    const pending = executeReplacePlan({
      plan,
      query: 'foo',
      read: async () => ({ ok: true, value: { text: 'foo', version: 'v1' } }),
      write: async (path, text, version) => {
        expect(text).toBe('bar')
        expect(version).toBe('v1')
        writes.push(path)
        return path === 'docs/a.md' ? firstWrite : { ok: true as const, value: { version: 'v2' } }
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writes).toEqual(['docs/a.md'])
    finishFirstWrite({ ok: true, value: { version: 'v2' } })
    const completed = await pending
    expect(writes).toEqual(['docs/a.md', 'docs/b.md'])
    expect(completed.written).toEqual(writes)
    expect(completed.outcome).toEqual({ files: 2, occurrences: 2, stale: [], changed: [], failed: [] })
  })

  it('retains stale and failed counts alongside a successful write', async () => {
    const plan = planReplace([
      hit('docs/a.md', 0, 'foo'),
      hit('docs/b.md', 0, 'foo'),
      hit('docs/c.md', 0, 'foo'),
    ], 'bar')
    const completed = await executeReplacePlan({
      plan,
      query: 'foo',
      read: async (path) => ({ ok: true, value: { text: 'foo', version: path === 'docs/b.md' ? 'v2' : 'v1' } }),
      write: async (path) => path === 'docs/c.md'
        ? { ok: false, error: { code: 'DENIED', message: 'denied' } }
        : { ok: true, value: { version: 'v2' } },
    })
    expect(completed.written).toEqual(['docs/a.md'])
    expect(completed.outcome).toEqual({ files: 1, occurrences: 1, stale: ['docs/b.md'], changed: [], failed: ['docs/c.md'] })
  })
})
