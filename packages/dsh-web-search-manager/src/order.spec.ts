import { describe, expect, it } from 'vitest'
import { DEFAULT_SEARCH_ORDER, defaultSearchOrder, migrateSearchOrder, pickActiveSearch, resolveSearchOrder } from './contracts.ts'

describe('search backend priority', () => {
  const keyed = (id: string) => id !== 'ddg'

  it('defaults to keyed backends before keyless', () => {
    expect(defaultSearchOrder(['ddg', 'exa', 'deepseek-official'], keyed))
      .toEqual(['exa', 'deepseek-official', 'ddg'])
  })

  it('uses only the enabled backends in the saved order', () => {
    expect(resolveSearchOrder(
      ['ddg', 'exa', 'tavily'],
      { searchOrder: ['ddg', 'exa'], searchProvider: 'exa' },
      keyed,
    )).toEqual(['ddg', 'exa'])
  })

  it('keeps an explicit empty searchOrder empty', () => {
    expect(resolveSearchOrder(
      ['ddg', 'exa'],
      { searchOrder: [], searchProvider: 'exa' },
      keyed,
    )).toEqual([])
    expect(resolveSearchOrder(
      ['ddg', 'exa'],
      { searchOrder: [], searchProvider: '' },
      keyed,
    )).toEqual([])
  })

  it('drops an unknown-only searchOrder to empty', () => {
    expect(resolveSearchOrder(
      ['ddg', 'exa'],
      { searchOrder: ['unknown'], searchProvider: 'exa' },
      keyed,
    )).toEqual([])
  })

  it('migrates a missing searchOrder from searchProvider, defaults, and preserves []', () => {
    expect(migrateSearchOrder({ searchProvider: 'exa' })).toEqual(['exa'])
    expect(migrateSearchOrder({})).toEqual([...DEFAULT_SEARCH_ORDER])
    expect(migrateSearchOrder({ searchOrder: [], searchProvider: 'exa' })).toEqual([])
  })

  it('picks the first configured backend and does not skip to a later one just because it exists', () => {
    expect(pickActiveSearch(['deepseek-official', 'exa', 'ddg'], id => id === 'ddg' || id === 'exa')).toBe('exa')
    expect(pickActiveSearch(['deepseek-official', 'exa'], () => false)).toBe('')
  })
})
