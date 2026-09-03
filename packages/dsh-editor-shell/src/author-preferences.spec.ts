import { describe, expect, it } from 'vitest'
import { AUTHOR_MEMORY_MAX_CHARS, AUTHOR_PREFERENCES_KEY, AUTHOR_PREFERENCES_MAX_CHARS, normalizeAuthorMemory, normalizeAuthorPreferences, readAuthorPreferences } from './author-preferences.ts'

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

describe('cross-workspace author memory', () => {
  it('normalizes author memory within its bounded budget', () => {
    expect(normalizeAuthorMemory('  留白优先\r\n不写直接心理\u0000  ')).toBe('留白优先\n不写直接心理')
    expect(normalizeAuthorMemory('x'.repeat(AUTHOR_MEMORY_MAX_CHARS + 20))).toHaveLength(AUTHOR_MEMORY_MAX_CHARS)
    expect(normalizeAuthorMemory(null)).toBe('')
  })
})
