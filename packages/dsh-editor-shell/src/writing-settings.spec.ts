import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_KEY, normalizeAuthorMemory } from './author-preferences.ts'
import { COMPLETION_PREFERENCE_KEY } from './completion-preference.ts'
import { DEFAULT_WRITING_PREFERENCES, decodeWritingPreferences, migrateLegacyWritingPreferences, writingPreferences, type WritingPreferences } from './writing-settings.ts'

function scopeWith(snapshot: SettingsScopeSnapshot<WritingPreferences>, write?: (field: string, value: unknown) => Promise<void>): SettingsScope<WritingPreferences> {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async (field, value) => {
      if (write) return await write(field, value)
      snapshot = {
        ...snapshot,
        value: { ...DEFAULT_WRITING_PREFERENCES, ...(snapshot.value ?? {}), [field]: value },
        user: { ...(snapshot.user as object ?? {}), [field]: value },
      }
    },
    unset: async () => {},
  }
}

describe('writing preference migration', () => {
  it('uses defaults while the Host has no user layer yet', () => {
    expect(writingPreferences({
      status: 'loading', value: undefined, user: undefined, base: undefined, revision: undefined, writable: false, mode: 'host',
    })).toEqual(DEFAULT_WRITING_PREFERENCES)
  })

  it('lets an existing DSH user field win and removes only its matching legacy key', async () => {
    const removeItem = vi.fn()
    const set = vi.fn()
    const scope = scopeWith({
      status: 'ready', value: { completion: 'manual', authorPreferences: '', authorMemory: '' }, user: { completion: 'manual' }, base: {}, revision: 1, writable: true, mode: 'host',
    }, async (...args) => { set(...args) })
    const result = await migrateLegacyWritingPreferences(scope, {
      getItem: (key) => key === COMPLETION_PREFERENCE_KEY ? 'pause' : null,
      removeItem,
    })
    expect(result).toEqual({ failed: [] })
    expect(set).not.toHaveBeenCalled()
    expect(removeItem).toHaveBeenCalledWith(COMPLETION_PREFERENCE_KEY)
    expect(removeItem).not.toHaveBeenCalledWith(AUTHOR_PREFERENCES_KEY)
  })

  it('writes each valid legacy value into DSH before removing its old key', async () => {
    const removeItem = vi.fn()
    const scope = scopeWith({
      status: 'ready', value: DEFAULT_WRITING_PREFERENCES, user: {}, base: {}, revision: 1, writable: true, mode: 'host',
    })
    const result = await migrateLegacyWritingPreferences(scope, {
      getItem: (key) => key === COMPLETION_PREFERENCE_KEY ? 'pause' : key === AUTHOR_PREFERENCES_KEY ? '  第三人称限知\r\n少用感叹号  ' : null,
      removeItem,
    })
    expect(result).toEqual({ failed: [] })
    expect(removeItem).toHaveBeenCalledWith(COMPLETION_PREFERENCE_KEY)
    expect(removeItem).toHaveBeenCalledWith(AUTHOR_PREFERENCES_KEY)
    expect(scope.getSnapshot().value).toEqual({ completion: 'pause', authorPreferences: '第三人称限知\n少用感叹号', authorMemory: '' })
  })

  it('retains a legacy key and reports a retryable failure when the scope write does not commit', async () => {
    const removeItem = vi.fn()
    const scope = scopeWith({
      status: 'ready', value: DEFAULT_WRITING_PREFERENCES, user: {}, base: {}, revision: 1, writable: true, mode: 'host',
    }, async () => {})
    const result = await migrateLegacyWritingPreferences(scope, {
      getItem: (key) => key === COMPLETION_PREFERENCE_KEY ? 'pause' : null,
      removeItem,
    })
    expect(result).toEqual({ failed: ['completion'] })
    expect(removeItem).not.toHaveBeenCalled()
  })
})

describe('author memory normalization and decode', () => {
  it('clamps the author memory string to the bounded budget', () => {
    expect(normalizeAuthorMemory('  留白优先\r\n不写直接心理\u0000  ')).toBe('留白优先\n不写直接心理')
    expect(normalizeAuthorMemory('x'.repeat(AUTHOR_MEMORY_MAX_CHARS + 30))).toHaveLength(AUTHOR_MEMORY_MAX_CHARS)
    expect(normalizeAuthorMemory(null)).toBe('')
  })

  it('falls back to the empty default for a legacy snapshot without the author memory field', () => {
    const snapshot: SettingsScopeSnapshot<WritingPreferences> = {
      status: 'ready', value: { completion: 'manual', authorPreferences: '', authorMemory: '' }, user: { completion: 'manual' }, base: {}, revision: 1, writable: true, mode: 'host',
    }
    expect(writingPreferences(snapshot)).toMatchObject({ authorMemory: '' })
  })

  it('decodeWritingPreferences round-trips an empty author memory field', () => {
    expect(decodeWritingPreferences({ completion: 'manual', authorPreferences: '', authorMemory: '' })).toEqual(DEFAULT_WRITING_PREFERENCES)
    expect(decodeWritingPreferences({ completion: 'manual', authorPreferences: '克制', authorMemory: '留白优先' })).toEqual({
      completion: 'manual', authorPreferences: '克制', authorMemory: '留白优先',
    })
    expect(decodeWritingPreferences({ completion: 'manual', authorPreferences: '', authorMemory: 42 })).toBeUndefined()
  })
})
