import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertBasename, createTextFile, FileOpError, listDir, readTextFile, renameTextFile, writeTextFile } from './files.ts'
import { PathConfineError } from './paths.ts'

let cwd = ''

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ms-files-'))
  await fs.mkdir(path.join(cwd, 'notes'))
  await fs.writeFile(path.join(cwd, 'notes', 'a.md'), 'hello', 'utf8')
})

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true })
})

describe('manuscript files', () => {
  it('lists one directory without creating anything', async () => {
    const entries = await listDir(cwd, '.')
    expect(entries.some((e) => e.name === 'notes' && e.type === 'directory')).toBe(true)
  })

  it('reads utf-8 text and returns a version token', async () => {
    const result = await readTextFile(cwd, 'notes/a.md')
    expect(result.text).toBe('hello')
    expect(result.version).toMatch(/^\d+(\.\d+)?:\d+$/)
  })

  it('creates a file only inside an existing directory', async () => {
    const created = await createTextFile(cwd, 'notes/b.md', 'next')
    expect(created.version).toBeTruthy()
    expect(await fs.readFile(path.join(cwd, 'notes', 'b.md'), 'utf8')).toBe('next')
    await expect(createTextFile(cwd, 'missing/c.md', 'nope')).rejects.toMatchObject({ code: 'PARENT_MISSING' })
  })

  it('does not mkdir when creating a file', async () => {
    await expect(createTextFile(cwd, 'ghost/new.md', 'x')).rejects.toBeInstanceOf(FileOpError)
    await expect(fs.stat(path.join(cwd, 'ghost'))).rejects.toThrow()
  })

  it('refuses to overwrite on create', async () => {
    await expect(createTextFile(cwd, 'notes/a.md', 'other')).rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('version-guards writes', async () => {
    const first = await readTextFile(cwd, 'notes/a.md')
    const written = await writeTextFile(cwd, 'notes/a.md', 'hello world', first.version)
    expect(await fs.readFile(path.join(cwd, 'notes', 'a.md'), 'utf8')).toBe('hello world')
    await expect(writeTextFile(cwd, 'notes/a.md', 'stale', first.version)).rejects.toMatchObject({ code: 'STALE' })
    expect(written.version).not.toBe(first.version)
  })

  it('fails closed on escape paths', async () => {
    await expect(readTextFile(cwd, '../x.md')).rejects.toBeInstanceOf(PathConfineError)
    await expect(listDir(cwd, '..')).rejects.toBeInstanceOf(PathConfineError)
    await expect(createTextFile(cwd, '../x.md', 'x')).rejects.toBeInstanceOf(PathConfineError)
  })

  it('renames a basename in place and rejects clashes or escapes', async () => {
    const renamed = await renameTextFile(cwd, 'notes/a.md', 'b')
    expect(renamed.path).toBe('notes/b.md')
    expect(await fs.readFile(path.join(cwd, 'notes', 'b.md'), 'utf8')).toBe('hello')
    await expect(renameTextFile(cwd, 'notes/b.md', '../x')).rejects.toBeInstanceOf(PathConfineError)
    await expect(renameTextFile(cwd, 'notes/b.md', 'CON')).rejects.toMatchObject({ code: 'BAD_NAME' })
    await createTextFile(cwd, 'notes/c.md', 'other')
    await expect(renameTextFile(cwd, 'notes/b.md', 'c.md')).rejects.toMatchObject({ code: 'EXISTS' })
  })

  it('rejects reserved and empty basenames', () => {
    expect(() => assertBasename('')).toThrow(FileOpError)
    expect(() => assertBasename('aux.md')).toThrow(FileOpError)
  })

  it('rejects oversized text files', async () => {
    const big = path.join(cwd, 'notes', 'big.md')
    await fs.writeFile(big, 'x'.repeat(2_000_001), 'utf8')
    await expect(readTextFile(cwd, 'notes/big.md')).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })
})
