import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceRelative, parentRelative, PathConfineError } from './paths.ts'

describe('workspace-relative paths', () => {
  it('normalizes a nested relative path', () => {
    expect(normalizeWorkspaceRelative('./正文/第一章.md')).toBe('正文/第一章.md')
    expect(normalizeWorkspaceRelative('notes/../正文/第一章.md')).toBe('正文/第一章.md')
    expect(parentRelative('正文/第一章.md')).toBe('正文')
  })

  it('keeps the workspace root as a dot', () => {
    expect(normalizeWorkspaceRelative('')).toBe('.')
    expect(normalizeWorkspaceRelative('.')).toBe('.')
  })

  it('rejects absolute paths in both platform spellings', () => {
    expect(() => normalizeWorkspaceRelative('/etc/passwd')).toThrow(PathConfineError)
    expect(() => normalizeWorkspaceRelative('C:/Windows/notepad.exe')).toThrow(PathConfineError)
    expect(() => normalizeWorkspaceRelative('C:\\Windows\\notepad.exe')).toThrow(PathConfineError)
  })

  it('rejects parent traversal outside the workspace', () => {
    expect(() => normalizeWorkspaceRelative('../secret.txt')).toThrow(PathConfineError)
    expect(() => normalizeWorkspaceRelative('a/../../x')).toThrow(PathConfineError)
  })

  it('rejects NUL and device or alternate-stream spellings', () => {
    expect(() => normalizeWorkspaceRelative('a\0b')).toThrow(PathConfineError)
    expect(() => normalizeWorkspaceRelative('chapter.md:secret')).toThrow(PathConfineError)
  })
})
