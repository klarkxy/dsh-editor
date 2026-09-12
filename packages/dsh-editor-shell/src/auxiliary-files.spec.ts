import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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

  it('keeps auxiliary files hidden even when a leftover show preference is stored', () => {
    const source = readFileSync(new URL('./auxiliary-files.ts', import.meta.url), 'utf8')
    const sidebar = readFileSync(new URL('./client/sidebar.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('SHOW_AUXILIARY_FILES_KEY')
    expect(source).not.toContain('storedShowAuxiliaryFiles')
    expect(source).not.toContain('persistShowAuxiliaryFiles')
    expect(sidebar).not.toContain('showAuxiliaryFiles')
    expect(sidebar).toContain('return !isAuxiliaryAuthorFile(item.name)')
    expect(sidebar).not.toContain('if (active === child || highlightPath === child) return true')
    expect(isAuxiliaryAuthorFile('AGENTS.md')).toBe(true)
  })
})
