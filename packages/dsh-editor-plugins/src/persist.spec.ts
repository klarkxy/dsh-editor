import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultPersistIo, isRetryableReplaceError, replaceFileAtomic, runQueuedSorted, writeJsonAtomic } from './persist.ts'

function ioError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code }) as NodeJS.ErrnoException
}

describe('atomic replace', () => {
  it('retries EPERM then replaces without deleting the destination first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-persist-'))
    const target = join(dir, 'cordis.patch.yml')
    await writeFile(target, 'old\n')
    let attempts = 0
    let unlinked = false
    const io = {
      ...defaultPersistIo,
      rm: async (path: Parameters<typeof rm>[0], opts?: Parameters<typeof rm>[1]) => {
        if (path === target) unlinked = true
        return rm(path, opts)
      },
      rename: async (from: string, to: string) => {
        attempts += 1
        if (attempts < 3) throw ioError('EPERM', `EPERM: operation not permitted, rename '${from}' -> '${to}'`)
        return rename(from, to)
      },
    }
    await replaceFileAtomic(target, 'new\n', io)
    expect(attempts).toBe(3)
    expect(unlinked).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('new\n')
  })

  it('does not report success after a persistent EPERM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-persist-fail-'))
    const target = join(dir, 'cordis.patch.yml')
    await writeFile(target, 'old\n')
    const io = {
      ...defaultPersistIo,
      rename: async (from: string, to: string) => {
        throw ioError('EPERM', `EPERM: operation not permitted, rename '${from}' -> '${to}'`)
      },
    }
    await expect(replaceFileAtomic(target, 'new\n', io)).rejects.toMatchObject({ code: 'EPERM' })
    expect(await readFile(target, 'utf8')).toBe('old\n')
  })

  it('serializes concurrent writes to the same home/path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-persist-q-'))
    const target = join(dir, 'dsh-plugins.json')
    const order: number[] = []
    await Promise.all([
      runQueuedSorted([dir, target], async () => {
        await writeJsonAtomic(target, { n: 1 })
        order.push(1)
      }),
      runQueuedSorted([dir, target], async () => {
        await writeJsonAtomic(target, { n: 2 })
        order.push(2)
      }),
    ])
    expect(order).toEqual([1, 2])
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ n: 2 })
  })

  it('classifies Windows lock codes as retryable', () => {
    expect(isRetryableReplaceError(ioError('EPERM', 'nope'))).toBe(true)
    expect(isRetryableReplaceError(ioError('ENOENT', 'missing'))).toBe(false)
  })
})
