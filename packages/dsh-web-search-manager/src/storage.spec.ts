import { describe, expect, it } from 'vitest'
import { defaultSettings, validateBaseURL } from './contracts.ts'
import { settingsSchema, storedSettingsSchema, updateSchema } from './storage.ts'
describe('secret-free settings contract', () => {
  it('accepts defaults and rejects unexpected secret fields', () => {
    expect(settingsSchema.safeParse(defaultSettings()).success).toBe(true)
    expect(settingsSchema.safeParse({ ...defaultSettings(), apiKey: 'must-not-persist' }).success).toBe(false)
  })
  it('rejects invalid bounds and revisions', () => {
    const { revision: _revision, ...settings } = defaultSettings()
    expect(updateSchema.safeParse({ settings, expectedRevision: 0 }).success).toBe(true)
    expect(updateSchema.safeParse({ settings: { ...settings, maxQueries: 0 }, expectedRevision: 0 }).success).toBe(false)
    expect(updateSchema.safeParse({ settings, expectedRevision: -1 }).success).toBe(false)
  })
  it('migrates stored settings missing searchOrder and keeps an explicit empty list', () => {
    const { searchOrder: _searchOrder, ...rest } = defaultSettings()
    expect(storedSettingsSchema.parse(rest).searchOrder).toEqual(['ddg'])
    expect(storedSettingsSchema.parse({ ...defaultSettings(), searchOrder: [] }).searchOrder).toEqual([])
  })
  it('rejects updates that omit searchOrder', () => {
    const { revision: _revision, searchOrder: _searchOrder, ...settings } = defaultSettings()
    expect(updateSchema.safeParse({ settings, expectedRevision: 0 }).success).toBe(false)
  })
  it.each(['http://example.com', 'https://name:secret@example.com', 'https://example.com?key=secret', 'https://example.com#secret'])('rejects endpoint %s', endpoint => {
    expect(() => validateBaseURL(endpoint)).toThrow()
  })
})
