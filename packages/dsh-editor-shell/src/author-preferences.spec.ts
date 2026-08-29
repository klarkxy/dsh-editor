import { describe, expect, it } from 'vitest'
import { AUTHOR_PREFERENCES_KEY, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorPreferences, readAuthorPreferences } from './author-preferences.ts'

describe('cross-workspace author preferences', () => {
  it('normalizes local text within a fixed prompt bound', () => {
    expect(normalizeAuthorPreferences('  保持克制\r\n少用感叹号\u0000  ')).toBe('保持克制\n少用感叹号')
    expect(normalizeAuthorPreferences('x'.repeat(AUTHOR_PREFERENCES_MAX_CHARS + 20))).toHaveLength(AUTHOR_PREFERENCES_MAX_CHARS)
    expect(normalizeAuthorPreferences(null)).toBe('')
  })

  it('fails closed when optional local storage is unavailable', () => {
    expect(readAuthorPreferences(undefined)).toBe('')
    expect(readAuthorPreferences({ getItem: (key) => key === AUTHOR_PREFERENCES_KEY ? '第三人称限知' : null })).toBe('第三人称限知')
    expect(readAuthorPreferences({ getItem: () => { throw new Error('blocked') } })).toBe('')
  })
})
