import { describe, expect, it } from 'vitest'
import { isAuxiliaryAuthorFile } from './auxiliary-files.ts'

describe('auxiliary author files', () => {
  it('hides identified assistant files and never hides manuscript chapters', () => {
    expect(isAuxiliaryAuthorFile('AGENTS.md')).toBe(true)
    expect(isAuxiliaryAuthorFile('CLAUDE.md')).toBe(true)
    expect(isAuxiliaryAuthorFile('.gitignore')).toBe(true)
    expect(isAuxiliaryAuthorFile('正文/001.md')).toBe(false)
    expect(isAuxiliaryAuthorFile('001.md')).toBe(false)
    expect(isAuxiliaryAuthorFile('人物卡/主角.md')).toBe(false)
    expect(isAuxiliaryAuthorFile('项目总览.md')).toBe(false)
  })
})
