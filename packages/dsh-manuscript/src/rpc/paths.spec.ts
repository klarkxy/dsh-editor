import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { confinePath, PathConfineError } from './paths.ts'

const cwd = path.join(os.tmpdir(), 'dsh-ms-root')

describe('confinePath', () => {
  it('resolves a nested relative path inside cwd', () => {
    expect(confinePath(cwd, '正文/一.md')).toBe(path.resolve(cwd, '正文', '一.md'))
  })

  it('rejects absolute posix paths', () => {
    expect(() => confinePath(cwd, '/etc/passwd')).toThrow(PathConfineError)
  })

  it('rejects windows absolute paths', () => {
    expect(() => confinePath(cwd, 'C:/Windows/notepad.exe')).toThrow(PathConfineError)
  })

  it('rejects parent traversal', () => {
    expect(() => confinePath(cwd, '../secret.txt')).toThrow(PathConfineError)
    expect(() => confinePath(cwd, 'a/../../x')).toThrow(PathConfineError)
  })

  it('rejects empty cwd', () => {
    expect(() => confinePath('', 'a.md')).toThrow(PathConfineError)
  })
})
