import { describe, expect, it } from 'vitest'
import type { FsTargetLike } from 'dsh-manuscript/host-api'
import { BinaryError, readImageFile, type BinaryAccess } from './binary.ts'
import { FILE_READ_BINARY_MAX_BYTES } from './contracts.ts'
import { createMemoryContext, type MemoryFileSystem } from './test-helpers.ts'

function asBinary(value: ReturnType<typeof createMemoryContext>): BinaryAccess {
  return value as unknown as BinaryAccess
}

function pngBytes(payload: Uint8Array = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])): Uint8Array {
  return payload
}

describe('readImageFile', () => {
  it('reads a PNG through the in-memory filesystem and returns base64 + image/png', async () => {
    const bytes = pngBytes()
    const result = await readImageFile({ access: asBinary(createMemoryContext({ '资源/cover.png': bytes })), path: '资源/cover.png' })
    expect(result.mime).toBe('image/png')
    expect(Buffer.from(result.base64, 'base64').equals(Buffer.from(bytes))).toBe(true)
  })

  it('accepts every whitelisted image extension and maps the correct MIME type', async () => {
    const samples: Array<[string, string]> = [
      ['海报.jpg', 'image/jpeg'],
      ['海报.jpeg', 'image/jpeg'],
      ['海报.PNG', 'image/png'],
      ['海报.gif', 'image/gif'],
      ['海报.webp', 'image/webp'],
      ['海报.avif', 'image/avif'],
      ['海报.svg', 'image/svg+xml'],
    ]
    for (const [relative, mime] of samples) {
      const result = await readImageFile({ access: asBinary(createMemoryContext({ [relative]: new TextEncoder().encode('x') })), path: relative })
      expect(result.mime).toBe(mime)
    }
  })

  it('rejects non-image extensions with an INVALID_EXTENSION error', async () => {
    const access = asBinary(createMemoryContext({ 'notes.md': '# not an image' }))
    await expect(readImageFile({ access, path: 'notes.md' })).rejects.toMatchObject({ code: 'INVALID_EXTENSION' })
    await expect(readImageFile({ access, path: 'archive.zip' })).rejects.toMatchObject({ code: 'INVALID_EXTENSION' })
    await expect(readImageFile({ access, path: 'no-extension' })).rejects.toMatchObject({ code: 'INVALID_EXTENSION' })
  })

  it('rejects files larger than the 20 MB limit with a TOO_LARGE error', async () => {
    const oversized = new Uint8Array(FILE_READ_BINARY_MAX_BYTES + 1)
    oversized[0] = 0x89
    oversized[1] = 0x50
    const access = asBinary(createMemoryContext({ '海报/big.png': oversized }))
    await expect(readImageFile({ access, path: '海报/big.png' })).rejects.toBeInstanceOf(BinaryError)
    await expect(readImageFile({ access, path: '海报/big.png' })).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })

  it('rejects path privilege escalation before touching the filesystem', async () => {
    const access = asBinary(createMemoryContext({ '资源/cover.png': pngBytes() }))
    await expect(readImageFile({ access, path: '../etc/passwd.png' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(readImageFile({ access, path: '/absolute/cover.png' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(readImageFile({ access, path: 'C:/cover.png' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    // `..` segments normalize to a valid in-workspace path, so this should
    // surface as NOT_FOUND rather than as a path escape.
    await expect(readImageFile({ access, path: '资源/../escaped.png' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects symbolic links anywhere along the resolved path', async () => {
    const access = asBinary(createMemoryContext({ '资源/link.png': pngBytes() }))
    const fs = (access.fs as unknown as MemoryFileSystem)
    fs.symlinks.add('/workspace/资源/link.png')
    await expect(readImageFile({ access, path: '资源/link.png' })).rejects.toMatchObject({ code: 'BLOCKED' })
  })

  it('reports a missing file as NOT_FOUND', async () => {
    const access = asBinary(createMemoryContext({ '资源/cover.png': pngBytes() }))
    await expect(readImageFile({ access, path: '资源/missing.png' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('MemoryFileSystem binary support', () => {
  it('preserves binary bytes through stat sizing, readBytes, and listing', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const context = createMemoryContext({ 'bin/payload.png': bytes })
    const target: FsTargetLike = { targetKey: '/workspace/bin/payload.png', displayPath: '/workspace/bin/payload.png' }
    const info = await context.fs.stat(target)
    expect(info?.size).toBe(bytes.byteLength)
    const fs = context.fs as unknown as MemoryFileSystem & { readBytes: (t: FsTargetLike) => Promise<Uint8Array> }
    const read = await fs.readBytes(target)
    expect(Buffer.from(read).equals(Buffer.from(bytes))).toBe(true)
  })
})
