import { describe, expect, it } from 'vitest'
import { defaultSettings, type ProviderView, type WebStatus } from './contracts.ts'
import {
  canEnableSearch, catalogSearchBackends, isProviderOn, nextSearchEnabled,
  providerCostNote, searchBackends, selectedSearchBackend,
} from './client.tsx'

function provider(partial: Partial<ProviderView> & Pick<ProviderView, 'id' | 'kind'>): ProviderView {
  return {
    label: partial.id, description: '', billing: 'request', configured: true,
    calls: 0, failures: 0, ...partial,
  }
}

function status(patch: Partial<WebStatus> & { settings?: Partial<WebStatus['settings']> }): WebStatus {
  return {
    providers: [], searchActive: false, fetchActive: false, storageFailed: false,
    ...patch, settings: { ...defaultSettings(), ...patch.settings },
  }
}

describe('web search settings cards', () => {
  it('highlights only the enabled card', () => {
    const current = status({
      searchActive: true, fetchActive: true,
      settings: { searchProvider: 'exa', fetchProvider: 'http', searchEnabled: true, fetchEnabled: true },
    })
    expect(isProviderOn(current, provider({ id: 'exa', kind: 'search' }))).toBe(true)
    expect(isProviderOn(current, provider({ id: 'deepseek-official', kind: 'search' }))).toBe(false)
    expect(isProviderOn(current, provider({ id: 'http', kind: 'fetch' }))).toBe(true)
  })

  it('does not highlight a selected provider that is still off', () => {
    const current = status({ settings: { searchProvider: 'exa', searchEnabled: false } })
    expect(isProviderOn(current, provider({ id: 'exa', kind: 'search' }))).toBe(false)
  })

  it('warns that DeepSeek native search may incur extra fees', () => {
    expect(providerCostNote('model-and-tools')).toBe('可能产生额外的搜索费用。')
    expect(providerCostNote('request')).toBe('按供应商 API 计费。')
    expect(providerCostNote('none')).toBe('')
  })

  it('picks one search backend for the single web_search slot', () => {
    const current = status({
      searchActive: true,
      providers: [
        provider({ id: 'exa', kind: 'search' }),
        provider({ id: 'ddg', kind: 'search', billing: 'none' }),
        provider({ id: 'http', kind: 'fetch', billing: 'none' }),
      ],
      settings: { searchProvider: 'exa', searchEnabled: true, searchOrder: ['exa'] },
    })
    expect(searchBackends(current).map(row => row.id)).toEqual(['exa'])
    expect(selectedSearchBackend(current)?.id).toBe('exa')
  })

  it('keeps an unconfigured backend in the explicit order so the key field can show', () => {
    const current = status({
      providers: [
        provider({ id: 'brave', kind: 'search', configured: false, credentialRef: 'search:brave' }),
        provider({ id: 'ddg', kind: 'search', billing: 'none' }),
      ],
      settings: { searchEnabled: false, searchOrder: ['brave'] },
    })
    expect(searchBackends(current).map(row => row.id)).toEqual(['brave'])
    expect(catalogSearchBackends(current).map(row => row.id)).toEqual(['brave', 'ddg'])
  })

  it('only treats ordered backends as enough to enable search', () => {
    const providers = [
      provider({ id: 'ddg', kind: 'search', billing: 'none' }),
      provider({ id: 'brave', kind: 'search', configured: false, credentialRef: 'search:brave' }),
      provider({ id: 'http', kind: 'fetch', billing: 'none' }),
    ]
    expect(canEnableSearch([], providers, {}, {})).toBe(false)
    expect(canEnableSearch(['brave'], providers, {}, {})).toBe(false)
    expect(canEnableSearch(['brave'], providers, { brave: 'sk-test' }, {})).toBe(true)
    expect(canEnableSearch(['brave'], providers, { brave: 'sk-test' }, { 'search:brave': false })).toBe(false)
    expect(canEnableSearch(['brave'], providers, { brave: 'sk-test' }, { 'search:brave': true })).toBe(true)
    expect(canEnableSearch(['ddg'], providers, {}, {})).toBe(true)
    expect(canEnableSearch(['http'], providers, {}, {})).toBe(false)
  })

  it('keeps the master switch off when adding a backend while search is already off', () => {
    const providers = [
      provider({ id: 'brave', kind: 'search', configured: false, credentialRef: 'search:brave' }),
      provider({ id: 'ddg', kind: 'search', billing: 'none' }),
    ]
    expect(nextSearchEnabled(false, ['brave'], providers, { brave: 'sk-test' }, {})).toBe(false)
    expect(nextSearchEnabled(false, ['ddg'], providers, {}, {})).toBe(false)
    expect(nextSearchEnabled(true, ['brave'], providers, {}, {})).toBe(false)
    expect(nextSearchEnabled(true, ['brave'], providers, { brave: 'sk-test' }, {})).toBe(true)
    expect(nextSearchEnabled(true, ['ddg', 'brave'], providers, {}, {})).toBe(true)
    expect(nextSearchEnabled(true, [], providers, {}, {})).toBe(false)
  })
})
