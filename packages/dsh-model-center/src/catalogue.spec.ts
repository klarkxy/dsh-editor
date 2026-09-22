import { describe, expect, it } from 'vitest'
import { BUILTIN_PURPOSE_CATALOGUE, DSH_GENERATE_PURPOSES, purposeLabel } from './catalogue.ts'

describe('purpose catalogue', () => {
  it('only catalogs DSH GenerateOptions purposes and does not invent others', () => {
    expect(BUILTIN_PURPOSE_CATALOGUE.map(item => item.id)).toEqual([...DSH_GENERATE_PURPOSES])
    expect(purposeLabel('compaction')).toBe('会话压缩')
    expect(purposeLabel('session-title', undefined, 'en')).toBe('Session title')
    expect(purposeLabel('mood', '需求澄清')).toBe('需求澄清')
  })
})
