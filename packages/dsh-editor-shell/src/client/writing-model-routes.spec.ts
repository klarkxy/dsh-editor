import { describe, expect, it } from 'vitest'
import { firstUsableCatalogModel, mergeCatalogOptions, type CatalogModelOption } from './writing-model-routes.tsx'

describe('first usable catalog model', () => {
  const catalog: CatalogModelOption[] = [
    { provider: 'deepseek', model: 'DeepSeek-V4-Flash', label: 'DeepSeek · Flash' },
    { provider: 'minimax', model: 'MiniMax-M3', label: 'MiniMax · M3' },
  ]

  it('skips keyless catalog entries and picks the first usable provider', () => {
    expect(firstUsableCatalogModel(catalog, ['minimax'])).toEqual(catalog[1])
    expect(firstUsableCatalogModel(catalog, [])).toBeUndefined()
    expect(firstUsableCatalogModel([], ['minimax'])).toBeUndefined()
  })

  it('keeps mergeCatalogOptions stable for the adopt scan', () => {
    expect(mergeCatalogOptions(catalog, catalog).map((item) => item.model)).toEqual([
      'DeepSeek-V4-Flash',
      'MiniMax-M3',
    ])
  })
})
