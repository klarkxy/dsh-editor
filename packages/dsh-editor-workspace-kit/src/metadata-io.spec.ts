import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetadataIoError, readMetadataText, writeMetadataTextAtomic } from './metadata-io.ts'

const relative = '.dsh-editor/history.json'
let root = ''
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-metadata-io-')) })
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

async function seed(text = 'old history'): Promise<string> {
  await fs.mkdir(path.join(root, '.dsh-editor'), { recursive: true })
  const target = path.join(root, relative)
  await fs.writeFile(target, text)
  return target
}

describe('metadata reads', () => {
  it('distinguishes a missing file from empty and readable metadata', async () => {
    await expect(readMetadataText(root, relative)).resolves.toBeNull()
    await seed('')
    await expect(readMetadataText(root, relative)).resolves.toBe('')
    await fs.writeFile(path.join(root, relative), '[{"date":"2026-10-07","chars":120}]')
    await expect(readMetadataText(root, relative)).resolves.toContain('2026-10-07')
  })

  it('reports read and inspection failures instead of claiming absence', async () => {
    const target = await seed()
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const read = vi.spyOn(fs, 'readFile').mockRejectedValue(denied)
    await expect(readMetadataText(root, relative)).rejects.toMatchObject({ name: 'MetadataIoError', code: 'IO', cause: denied })
    read.mockRestore()
    expect(await fs.readFile(target, 'utf8')).toBe('old history')
    const inspect = fs.lstat.bind(fs)
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      if (String(args[0]) === target) throw denied
      return await inspect(...args)
    })
    await expect(readMetadataText(root, relative)).rejects.toMatchObject({ code: 'IO', cause: denied })
    await expect(readMetadataText(path.join(root, 'unavailable-workspace'), relative)).rejects.toMatchObject({ code: 'IO' })
  })

  it('rejects oversized, invalid, and non-file metadata paths', async () => {
    await seed('x'.repeat(2_000_001))
    await expect(readMetadataText(root, relative)).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(readMetadataText(root, '../outside.json')).rejects.toMatchObject({ code: 'BLOCKED' })
    await fs.unlink(path.join(root, relative))
    await fs.mkdir(path.join(root, relative))
    await expect(readMetadataText(root, relative)).rejects.toBeInstanceOf(MetadataIoError)
    await expect(writeMetadataTextAtomic(root, relative, 'new')).rejects.toMatchObject({ code: 'BLOCKED' })
    expect((await fs.stat(path.join(root, relative))).isDirectory()).toBe(true)
  })

  it('rejects a metadata-directory link without reading or writing outside the workspace', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-metadata-outside-'))
    try {
      await fs.writeFile(path.join(outside, 'history.json'), 'outside history')
      await fs.symlink(outside, path.join(root, '.dsh-editor'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(readMetadataText(root, relative)).rejects.toMatchObject({ code: 'BLOCKED' })
      await expect(writeMetadataTextAtomic(root, relative, 'overwrite')).rejects.toMatchObject({ code: 'BLOCKED' })
      expect(await fs.readFile(path.join(outside, 'history.json'), 'utf8')).toBe('outside history')
    } finally {
      await fs.unlink(path.join(root, '.dsh-editor')).catch(() => undefined)
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})

describe('metadata replacement', () => {
  it('creates and replaces a file with no leftover stage', async () => {
    await writeMetadataTextAtomic(root, relative, 'first history')
    await writeMetadataTextAtomic(root, relative, 'second history')
    expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe('second history')
    expect(await fs.readdir(path.join(root, '.dsh-editor'))).toEqual(['history.json'])
  })

  it('keeps the old value and removes only its stage after a terminal rename failure', async () => {
    const target = await seed()
    const failure = Object.assign(new Error('replace failed'), { code: 'EIO' })
    vi.spyOn(fs, 'rename').mockRejectedValue(failure)
    const unlink = vi.spyOn(fs, 'unlink')
    await expect(writeMetadataTextAtomic(root, relative, 'new history')).rejects.toMatchObject({ code: 'IO', cause: failure })
    expect(await fs.readFile(target, 'utf8')).toBe('old history')
    expect(unlink.mock.calls.some(([value]) => String(value) === target)).toBe(false)
    expect(await fs.readdir(path.join(root, '.dsh-editor'))).toEqual(['history.json'])
  })

  it.skipIf(process.platform !== 'win32')('retries transient Windows locks while the old file remains readable', async () => {
    const target = await seed()
    const rename = fs.rename.bind(fs)
    let attempts = 0
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      attempts++
      expect(await fs.readFile(target, 'utf8')).toBe('old history')
      if (attempts <= 2) throw Object.assign(new Error('file temporarily locked'), { code: attempts === 1 ? 'EPERM' : 'EBUSY' })
      await rename(...args)
    })
    await writeMetadataTextAtomic(root, relative, 'new history')
    expect(attempts).toBe(3)
    expect(await fs.readFile(target, 'utf8')).toBe('new history')
    expect(await fs.readdir(path.join(root, '.dsh-editor'))).toEqual(['history.json'])
  })

  it('eventually reports a persistent lock, preserves the old file, and cleans the stage', async () => {
    const target = await seed()
    const failure = Object.assign(new Error('file locked'), { code: 'EPERM' })
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(failure)
    await expect(writeMetadataTextAtomic(root, relative, 'new history')).rejects.toMatchObject({ code: 'IO', cause: failure })
    expect(rename.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(rename.mock.calls.length).toBeLessThanOrEqual(8)
    expect(await fs.readFile(target, 'utf8')).toBe('old history')
    expect(await fs.readdir(path.join(root, '.dsh-editor'))).toEqual(['history.json'])
  })
})
