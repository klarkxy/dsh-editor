import { describe, expect, it } from 'vitest'
import { GENERATED_DIRECTORIES, isGeneratedPath, isHiddenPath, MAX_FILES } from './tree.ts'

describe('workspace tree constants', () => {
  it('keeps the shared walk bounds used by overview, cards, proofread and snapshot', () => {
    expect(MAX_FILES).toBe(2_000)
    expect([...GENERATED_DIRECTORIES].sort()).toEqual(['build', 'coverage', 'dist', 'node_modules', 'out', 'target'])
    expect(isHiddenPath('正文/.hidden.md')).toBe(true)
    expect(isHiddenPath('正文/第一章.md')).toBe(false)
    expect(isGeneratedPath('dist/out.md')).toBe(true)
    expect(isGeneratedPath('正文/第一章.md')).toBe(false)
  })
})
