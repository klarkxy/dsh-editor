import { describe, expect, it } from 'vitest'
import { defaultSearchOrder, pickActiveSearch, resolveSearchOrder } from './contracts.ts'

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

  it('falls back to a legacy single searchProvider', () => {
    expect(resolveSearchOrder(
      ['ddg', 'exa'],
      { searchOrder: [], searchProvider: 'exa' },
      keyed,
    )).toEqual(['exa'])
  })

  it('defaults to DuckDuckGo when it is installed', () => {
    expect(resolveSearchOrder(
      ['ddg', 'exa'],
      { searchOrder: [], searchProvider: '' },
      keyed,
    )).toEqual(['ddg'])
  })

  it('picks the first configured backend and does not skip to a later one just because it exists', () => {
    expect(pickActiveSearch(['deepseek-official', 'exa', 'ddg'], id => id === 'ddg' || id === 'exa')).toBe('exa')
    expect(pickActiveSearch(['deepseek-official', 'exa'], () => false)).toBe('')
  })
})
