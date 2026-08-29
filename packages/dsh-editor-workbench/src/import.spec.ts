import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsTargetLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import { applyImport, cleanupImport, IMPORT_RECEIPT_PATH, probeImport, type ImportAccess } from './import.ts'

let base = ''
beforeEach(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-import-')) })
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }) })

function nativeFs(hooks: { afterWrite?(target: string, content: string): Promise<void>; afterList?(target: string): Promise<void> } = {}): FileSystemLike {
  const target = (value: string): FsTargetLike => ({ targetKey: path.resolve(value), displayPath: path.resolve(value) })
  const kind = (state: import('node:fs').Stats): 'file' | 'directory' | 'other' => state.isFile() ? 'file' : state.isDirectory() ? 'directory' : 'other'
  return {
    async resolve(value, opts) { return target(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? base, value)) },
    contains(parent, child) { const rel = path.relative(parent.targetKey, child.targetKey); return !rel.startsWith('..') && !path.isAbsolute(rel) },
    async stat(value) { try { const state = await fs.stat(value.targetKey); return { type: kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async lstat(value, opts) { try { const state = await fs.lstat(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? base, value)); return { type: state.isSymbolicLink() ? 'symlink' : kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async readText(value) { return await fs.readFile(value.targetKey, 'utf8') },
    async listDir(value) {
      const entries = await Promise.all((await fs.readdir(value.targetKey, { withFileTypes: true })).map(async (entry) => ({ name: entry.name, type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const, target: target(path.join(value.targetKey, entry.name)) })))
      await hooks.afterList?.(value.targetKey)
      return entries
    },
    async writeText(value, content, expected) {
      const old = await fs.readFile(value.targetKey, 'utf8').catch(() => null)
      if (expected?.kind === 'createIfAbsent' && old !== null) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
      if (expected?.kind === 'replaceIfVersion') { const state = await fs.stat(value.targetKey); if (`${state.size}:${state.mtimeMs}` !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' }) }
      await fs.writeFile(value.targetKey, content, expected?.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
      await hooks.afterWrite?.(value.targetKey, content)
      const state = await fs.stat(value.targetKey); return { operation: old === null ? 'create' as const : 'update' as const, version: `${state.size}:${state.mtimeMs}`, before: old, after: content }
    },
  }
}
function access(root: string, mode: SandboxExecutionPolicyLike['mode'] = 'workspace-write', filesystem = nativeFs()): ImportAccess {
  const files: WorkspaceFileContext = { fs: filesystem, cwd: root, root: { targetKey: root, displayPath: root }, policy: { mode, workspaceRoot: root } }
  return { path: root, rootKey: root, mode, files }
}

describe('safe external import', () => {
  it('maps Markdown and TXT into 正文, skipping hidden paths without modifying the source', async () => {
    const source = path.join(base, 'source'); const target = path.join(base, 'target')
    await fs.mkdir(path.join(source, 'drafts'), { recursive: true }); await fs.mkdir(target)
    await fs.writeFile(path.join(source, 'drafts', 'one.md'), '# one', 'utf8'); await fs.writeFile(path.join(source, 'two.txt'), 'two', 'utf8'); await fs.mkdir(path.join(source, '.git')); await fs.writeFile(path.join(source, '.git', 'ignore'), 'x')
    const ready = await probeImport({ source: access(source), target: access(target) })
    expect(ready).toMatchObject({ state: 'ready', files: 2, preview: ['正文/drafts/one.md', '正文/two.md'] })
    const applied = await applyImport({ source: access(source), target: access(target), token: ready.token! })
    expect(applied).toEqual({ imported: 2, skipped: 0 })
    await expect(fs.readFile(path.join(target, '正文', 'two.md'), 'utf8')).resolves.toBe('two')
    await expect(fs.readFile(path.join(source, 'two.txt'), 'utf8')).resolves.toBe('two')
    await expect(probeImport({ target: access(target) })).resolves.toMatchObject({ state: 'complete', files: 2 })
  })

  it('blocks nonempty, nested, and read-only targets before writes', async () => {
    const source = path.join(base, 'source'); const target = path.join(base, 'target'); await fs.mkdir(path.join(source, 'nested'), { recursive: true }); await fs.mkdir(target); await fs.writeFile(path.join(source, 'a.md'), 'a'); await fs.writeFile(path.join(target, 'keep.md'), 'keep')
    await expect(probeImport({ source: access(source), target: access(target) })).resolves.toMatchObject({ state: 'blocked' })
    await expect(probeImport({ source: access(source), target: access(path.join(source, 'nested')) })).resolves.toMatchObject({ state: 'blocked' })
    const empty = path.join(base, 'empty'); await fs.mkdir(empty)
    await expect(probeImport({ source: access(source), target: access(empty, 'read-only') })).resolves.toMatchObject({ state: 'blocked' })
    await expect(fs.readdir(empty)).resolves.toEqual([])
  })

  it('fails closed on source drift and leaves a recoverable receipt only after copying starts', async () => {
    const source = path.join(base, 'source'); const target = path.join(base, 'target'); await fs.mkdir(source); await fs.mkdir(target); await fs.writeFile(path.join(source, 'a.md'), 'before')
    const ready = await probeImport({ source: access(source), target: access(target) }); await fs.writeFile(path.join(source, 'a.md'), 'after')
    await expect(applyImport({ source: access(source), target: access(target), token: ready.token! })).rejects.toMatchObject({ code: 'STALE' })
    await expect(fs.readdir(target)).resolves.toEqual([])
  })

  it('continues an interrupted receipt without overwriting matching files and blocks cleanup after author changes', async () => {
    const source = path.join(base, 'source'); const target = path.join(base, 'target'); await fs.mkdir(source); await fs.mkdir(target); await fs.writeFile(path.join(source, 'a.md'), 'a'); await fs.writeFile(path.join(source, 'b.md'), 'b')
    const first = await probeImport({ source: access(source), target: access(target) }); await applyImport({ source: access(source), target: access(target), token: first.token! })
    const receiptPath = path.join(target, IMPORT_RECEIPT_PATH); const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); receipt.state = 'copying'; await fs.writeFile(receiptPath, JSON.stringify(receipt)); await fs.unlink(path.join(target, '正文', 'b.md'))
    await expect(probeImport({ target: access(target) })).resolves.toMatchObject({ state: 'recoverable' })
    const resumed = await probeImport({ source: access(source), target: access(target) }); await expect(applyImport({ source: access(source), target: access(target), token: resumed.token! })).resolves.toEqual({ imported: 1, skipped: 1 })
    receipt.state = 'copying'; await fs.writeFile(receiptPath, JSON.stringify(receipt)); await fs.writeFile(path.join(target, '正文', 'a.md'), 'author changed')
    const interrupted = await probeImport({ target: access(target) })
    await expect(cleanupImport({ target: access(target), receiptId: interrupted.receiptId! })).rejects.toMatchObject({ code: 'CLEANUP_BLOCKED' })
    await expect(fs.readFile(path.join(target, '正文', 'a.md'), 'utf8')).resolves.toBe('author changed')
  })

  it('does not create a receipt when the target gains a file after probe', async () => {
    const source = path.join(base, 'source'); const target = path.join(base, 'target'); await fs.mkdir(source); await fs.mkdir(target); await fs.writeFile(path.join(source, 'a.md'), 'a')
    const ready = await probeImport({ source: access(source), target: access(target) }); await fs.writeFile(path.join(target, 'new.md'), 'new')
    await expect(applyImport({ source: access(source), target: access(target), token: ready.token! })).rejects.toMatchObject({ code: 'STALE' })
    await expect(fs.readdir(target)).resolves.toEqual(['new.md'])
  })

  it('never cleans a complete import and rejects cleanup when an owned file changed', async () => {
    const source = path.join(base, 'source'); const target = path.join(base, 'target'); await fs.mkdir(source); await fs.mkdir(target); await fs.writeFile(path.join(source, 'a.md'), 'a')
    const ready = await probeImport({ source: access(source), target: access(target) }); await applyImport({ source: access(source), target: access(target), token: ready.token! })
    const complete = await probeImport({ target: access(target) })
    await expect(cleanupImport({ target: access(target), receiptId: complete.receiptId! })).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(await fs.readFile(path.join(target, IMPORT_RECEIPT_PATH), 'utf8')).toContain('complete')
  })

  it('binds recovery and cleanup to the target root and the probed receipt id', async () => {
    const source = path.join(base, 'source'); const firstTarget = path.join(base, 'first'); const secondTarget = path.join(base, 'second')
    await fs.mkdir(source); await fs.mkdir(firstTarget); await fs.mkdir(secondTarget); await fs.writeFile(path.join(source, 'a.md'), 'a')
    const ready = await probeImport({ source: access(source), target: access(firstTarget) }); await applyImport({ source: access(source), target: access(firstTarget), token: ready.token! })
    const receiptPath = path.join(firstTarget, IMPORT_RECEIPT_PATH); const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); receipt.state = 'copying'; await fs.writeFile(receiptPath, JSON.stringify(receipt))
    await fs.copyFile(receiptPath, path.join(secondTarget, IMPORT_RECEIPT_PATH))
    await expect(probeImport({ target: access(secondTarget) })).rejects.toMatchObject({ code: 'BLOCKED' })
    const recoverable = await probeImport({ target: access(firstTarget) })
    await expect(cleanupImport({ target: access(firstTarget), receiptId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'CLEANUP_BLOCKED' })
    await expect(cleanupImport({ target: access(firstTarget), receiptId: recoverable.receiptId! })).resolves.toEqual({ removed: 1 })
    await expect(fs.readdir(firstTarget)).resolves.toEqual([])
  })

  it('rechecks every owned file after entering cleaning and preserves a concurrent author edit', async () => {
    const source = path.join(base, 'source'); const target = path.join(base, 'target'); await fs.mkdir(source); await fs.mkdir(target); await fs.writeFile(path.join(source, 'a.md'), 'a')
    const ready = await probeImport({ source: access(source), target: access(target) }); await applyImport({ source: access(source), target: access(target), token: ready.token! })
    const receiptPath = path.join(target, IMPORT_RECEIPT_PATH); const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); receipt.state = 'copying'; await fs.writeFile(receiptPath, JSON.stringify(receipt))
    const recoverable = await probeImport({ target: access(target) })
    let changed = false
    const guardedFs = nativeFs({ afterWrite: async (written, content) => {
      if (!changed && written === receiptPath && JSON.parse(content).state === 'cleaning') { changed = true; await fs.writeFile(path.join(target, '正文', 'a.md'), 'changed during cleanup') }
    } })
    await expect(cleanupImport({ target: access(target, 'workspace-write', guardedFs), receiptId: recoverable.receiptId! })).rejects.toMatchObject({ code: 'CLEANUP_BLOCKED' })
    await expect(fs.readFile(path.join(target, '正文', 'a.md'), 'utf8')).resolves.toBe('changed during cleanup')
  })

  it('rejects a queued directory replaced by a junction before enumeration', async () => {
    const source = path.join(base, 'source'); const nested = path.join(source, 'nested'); const outside = path.join(base, 'outside'); const target = path.join(base, 'target')
    await fs.mkdir(nested, { recursive: true }); await fs.mkdir(outside); await fs.mkdir(target); await fs.writeFile(path.join(outside, 'secret.md'), 'outside')
    let swapped = false
    const guardedFs = nativeFs({ afterList: async (listed) => {
      if (!swapped && listed === source) { swapped = true; await fs.rm(nested, { recursive: true }); await fs.symlink(outside, nested, 'junction') }
    } })
    await expect(probeImport({ source: access(source, 'workspace-write', guardedFs), target: access(target) })).rejects.toMatchObject({ code: 'SYMLINK' })
    await expect(fs.readdir(target)).resolves.toEqual([])
  })
})
