import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileSystemLike, FsTargetLike, SandboxExecutionPolicyLike, WorkspaceFileContext } from 'dsh-manuscript/host-api'
import {
  createSnapshot,
  listSnapshots,
  RESTORE_RECEIPT_PATH,
  restoreApply,
  restoreCleanup,
  restoreProbe,
  SNAPSHOT_DIRECTORY,
  type SnapshotAccess,
} from './snapshot.ts'

let base = ''
beforeEach(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-snapshot-')) })
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }) })

function nativeFs(hooks: { afterWrite?(target: string, content: string): Promise<void>; afterList?(target: string): Promise<void> } = {}): FileSystemLike {
  const target = (value: string): FsTargetLike => ({ targetKey: path.resolve(value), displayPath: path.resolve(value) })
  const kind = (state: import('node:fs').Stats): 'file' | 'directory' | 'other' => state.isFile() ? 'file' : state.isDirectory() ? 'directory' : 'other'
  return {
    async resolve(value, opts) { return target(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? base, value)) },
    contains(parent, child) { const relative = path.relative(parent.targetKey, child.targetKey); return !relative.startsWith('..') && !path.isAbsolute(relative) },
    async stat(value) { try { const state = await fs.stat(value.targetKey); return { type: kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async lstat(value, opts) { try { const state = await fs.lstat(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? base, value)); return { type: state.isSymbolicLink() ? 'symlink' : kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async readText(value) { return await fs.readFile(value.targetKey, 'utf8') },
    async listDir(value) {
      const entries = (await fs.readdir(value.targetKey, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const,
        target: target(path.join(value.targetKey, entry.name)),
      }))
      await hooks.afterList?.(value.targetKey)
      return entries
    },
    async writeText(value, content, expected) {
      const old = await fs.readFile(value.targetKey, 'utf8').catch(() => null)
      if (expected?.kind === 'createIfAbsent' && old !== null) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
      if (expected?.kind === 'replaceIfVersion') {
        const state = await fs.stat(value.targetKey)
        if (`${state.size}:${state.mtimeMs}` !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
      }
      await fs.writeFile(value.targetKey, content, expected?.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
      await hooks.afterWrite?.(value.targetKey, content)
      const state = await fs.stat(value.targetKey)
      return { operation: old === null ? 'create' as const : 'update' as const, version: `${state.size}:${state.mtimeMs}`, before: old, after: content }
    },
  }
}

function access(root: string, mode: SandboxExecutionPolicyLike['mode'] = 'workspace-write', filesystem = nativeFs()): SnapshotAccess {
  const files: WorkspaceFileContext = {
    fs: filesystem,
    cwd: root,
    root: { targetKey: path.resolve(root), displayPath: path.resolve(root) },
    policy: { mode, workspaceRoot: root },
  }
  return { path: root, rootKey: path.resolve(root), mode, files }
}

async function project(name: string): Promise<string> {
  const root = path.join(base, name)
  await fs.mkdir(root)
  return root
}

describe('whole-work text snapshots', () => {
  it('publishes verified payloads, excludes hidden/generated content, and never snapshots snapshots', async () => {
    const source = await project('source')
    await fs.mkdir(path.join(source, '正文'), { recursive: true })
    await fs.mkdir(path.join(source, '.private'))
    await fs.mkdir(path.join(source, '.dsh-editor'))
    await fs.mkdir(path.join(source, 'dist'))
    await fs.writeFile(path.join(source, '正文', '001.md'), '# first')
    await fs.writeFile(path.join(source, 'notes.txt'), 'notes')
    await fs.writeFile(path.join(source, '.private', 'secret.md'), 'secret')
    await fs.writeFile(path.join(source, '.dsh-editor', 'chapter-status.json'), '{"version":1,"statuses":{}}')
    await fs.writeFile(path.join(source, '.dsh-editor', 'do-not-copy.txt'), 'private')
    await fs.writeFile(path.join(source, 'dist', 'generated.md'), 'generated')
    const before = await fs.readFile(path.join(source, '正文', '001.md'), 'utf8')

    const first = await createSnapshot(access(source), '开篇')
    expect(first).toMatchObject({ label: '开篇', files: 3 })
    expect(await fs.readFile(path.join(source, SNAPSHOT_DIRECTORY, first.snapshotId, 'files', '正文', '001.md'), 'utf8')).toBe('# first')
    expect(await fs.readFile(path.join(source, SNAPSHOT_DIRECTORY, first.snapshotId, 'files', '.dsh-editor', 'chapter-status.json'), 'utf8')).toContain('"version":1')
    await expect(fs.stat(path.join(source, SNAPSHOT_DIRECTORY, first.snapshotId, 'files', '.dsh-editor', 'do-not-copy.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listSnapshots(access(source))).toMatchObject([{ snapshotId: first.snapshotId, label: '开篇', files: 3 }])
    const second = await createSnapshot(access(source))
    expect(second.files).toBe(3)
    expect(await fs.readFile(path.join(source, '正文', '001.md'), 'utf8')).toBe(before)
    await expect(createSnapshot(access(source, 'read-only'))).rejects.toMatchObject({ code: 'READ_ONLY' })
  })

  it('rejects a tampered payload before writing the target', async () => {
    const source = await project('source'); const target = await project('target')
    await fs.writeFile(path.join(source, 'book.md'), 'original')
    const snapshot = await createSnapshot(access(source))
    await fs.writeFile(path.join(source, SNAPSHOT_DIRECTORY, snapshot.snapshotId, 'files', 'book.md'), 'tampered')
    await expect(restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(fs.readdir(target)).resolves.toEqual([])
  })

  it('restores the exact chapter status sidecar while keeping other hidden metadata excluded', async () => {
    const source = await project('status-source'); const target = await project('status-target')
    await fs.mkdir(path.join(source, '正文'))
    await fs.mkdir(path.join(source, '.dsh-editor'))
    await fs.writeFile(path.join(source, '正文', '001.md'), '# 第一章\n\n正文')
    await fs.writeFile(path.join(source, '.dsh-editor', 'chapter-status.json'), '{"version":1,"statuses":{"正文/001.md":"final"}}')
    await fs.writeFile(path.join(source, '.dsh-editor', 'secret.txt'), 'do not copy')
    const snapshot = await createSnapshot(access(source))
    const ready = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    await restoreApply({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId, token: ready.token! })
    await expect(fs.readFile(path.join(target, '.dsh-editor', 'chapter-status.json'), 'utf8')).resolves.toContain('"final"')
    await expect(fs.stat(path.join(target, '.dsh-editor', 'secret.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('blocks nonempty, read-only, same, and nested targets without a receipt', async () => {
    const source = await project('source'); const target = await project('target')
    await fs.writeFile(path.join(source, 'book.md'), 'book')
    const snapshot = await createSnapshot(access(source))
    await fs.writeFile(path.join(target, 'keep.md'), 'keep')
    await expect(restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })).resolves.toMatchObject({ state: 'blocked' })
    const empty = await project('empty')
    await expect(restoreProbe({ source: access(source), target: access(empty, 'read-only'), snapshotId: snapshot.snapshotId })).resolves.toMatchObject({ state: 'blocked' })
    await expect(restoreProbe({ source: access(source), target: access(source), snapshotId: snapshot.snapshotId })).resolves.toMatchObject({ state: 'blocked' })
    const nested = path.join(source, 'new-copy'); await fs.mkdir(nested)
    await expect(restoreProbe({ source: access(source), target: access(nested), snapshotId: snapshot.snapshotId })).resolves.toMatchObject({ state: 'blocked' })
    await expect(fs.readdir(empty)).resolves.toEqual([])
  })

  it('detects snapshot drift after probe and leaves the target untouched', async () => {
    const source = await project('source'); const target = await project('target')
    await fs.writeFile(path.join(source, 'book.md'), 'before')
    const snapshot = await createSnapshot(access(source))
    const ready = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    await fs.writeFile(path.join(source, SNAPSHOT_DIRECTORY, snapshot.snapshotId, 'files', 'book.md'), 'after')
    await expect(restoreApply({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId, token: ready.token! })).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(fs.readdir(target)).resolves.toEqual([])
  })

  it('resumes an interrupted copy and recognizes a lost complete response', async () => {
    const source = await project('source'); const target = await project('target')
    await fs.writeFile(path.join(source, 'a.md'), 'a'); await fs.writeFile(path.join(source, 'b.md'), 'b')
    const snapshot = await createSnapshot(access(source))
    const ready = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    let failed = false
    const interruptedFs = nativeFs({ afterWrite: async (written) => {
      if (!failed && written === path.join(target, 'b.md')) { failed = true; throw new Error('simulated crash') }
    } })
    await expect(restoreApply({ source: access(source), target: access(target, 'workspace-write', interruptedFs), snapshotId: snapshot.snapshotId, token: ready.token! })).rejects.toThrow('simulated crash')
    await expect(restoreProbe({ target: access(target) })).resolves.toMatchObject({ state: 'recoverable', snapshotId: snapshot.snapshotId })
    const resumed = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    await expect(restoreApply({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId, token: resumed.token! })).resolves.toMatchObject({ complete: true })
    await expect(restoreApply({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId, token: resumed.token! })).resolves.toEqual({ restored: 0, skipped: 2, complete: true })
    await expect(restoreProbe({ target: access(target) })).resolves.toMatchObject({ state: 'complete' })
  })

  it('fails cleanup closed after an author edit', async () => {
    const source = await project('source'); const target = await project('target')
    await fs.writeFile(path.join(source, 'a.md'), 'a'); await fs.writeFile(path.join(source, 'b.md'), 'b')
    const snapshot = await createSnapshot(access(source))
    const ready = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    let failed = false
    const interruptedFs = nativeFs({ afterWrite: async (written) => { if (!failed && written === path.join(target, 'b.md')) { failed = true; throw new Error('stop') } } })
    await expect(restoreApply({ source: access(source), target: access(target, 'workspace-write', interruptedFs), snapshotId: snapshot.snapshotId, token: ready.token! })).rejects.toThrow()
    await fs.writeFile(path.join(target, 'a.md'), 'author edit')
    const recovery = await restoreProbe({ target: access(target) })
    await expect(restoreCleanup({ target: access(target), receiptId: recovery.receiptId! })).rejects.toMatchObject({ code: 'CLEANUP_BLOCKED' })
    await expect(fs.readFile(path.join(target, 'a.md'), 'utf8')).resolves.toBe('author edit')
  })

  it('never marks a resumed target complete when an unexpected file appeared', async () => {
    const source = await project('source'); const target = await project('target')
    await fs.writeFile(path.join(source, 'a.md'), 'a'); await fs.writeFile(path.join(source, 'b.md'), 'b')
    const snapshot = await createSnapshot(access(source))
    const ready = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    let failed = false
    const interruptedFs = nativeFs({ afterWrite: async (written) => { if (!failed && written === path.join(target, 'b.md')) { failed = true; throw new Error('stop') } } })
    await expect(restoreApply({ source: access(source), target: access(target, 'workspace-write', interruptedFs), snapshotId: snapshot.snapshotId, token: ready.token! })).rejects.toThrow()
    await fs.writeFile(path.join(target, 'foreign.txt'), 'foreign')
    const resumed = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    await expect(restoreApply({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId, token: resumed.token! })).rejects.toMatchObject({ code: 'STALE' })
    await expect(restoreProbe({ target: access(target) })).resolves.toMatchObject({ state: 'recoverable' })
  })

  it('rejects a directory swapped to a junction during cleanup', async () => {
    const source = await project('source'); const target = await project('target'); const outside = await project('outside')
    await fs.mkdir(path.join(source, '正文')); await fs.writeFile(path.join(source, '正文', 'a.md'), 'a'); await fs.writeFile(path.join(source, '正文', 'b.md'), 'b')
    await fs.writeFile(path.join(outside, 'a.md'), 'outside')
    const snapshot = await createSnapshot(access(source))
    const ready = await restoreProbe({ source: access(source), target: access(target), snapshotId: snapshot.snapshotId })
    let failed = false
    const interruptedFs = nativeFs({ afterWrite: async (written) => { if (!failed && written === path.join(target, '正文', 'b.md')) { failed = true; throw new Error('stop') } } })
    await expect(restoreApply({ source: access(source), target: access(target, 'workspace-write', interruptedFs), snapshotId: snapshot.snapshotId, token: ready.token! })).rejects.toThrow()
    await fs.rm(path.join(target, '正文'), { recursive: true })
    await fs.symlink(outside, path.join(target, '正文'), 'junction')
    const receipt = JSON.parse(await fs.readFile(path.join(target, RESTORE_RECEIPT_PATH), 'utf8')) as { receiptId: string }
    await expect(restoreCleanup({ target: access(target), receiptId: receipt.receiptId })).rejects.toMatchObject({ code: 'CLEANUP_BLOCKED' })
    await expect(fs.readFile(path.join(outside, 'a.md'), 'utf8')).resolves.toBe('outside')
  })
})
