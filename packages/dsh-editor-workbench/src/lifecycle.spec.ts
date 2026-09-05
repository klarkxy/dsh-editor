import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTextFile, type FileSystemLike, type FsTargetLike, type SandboxExecutionPolicyLike, type WorkspaceFileContext } from 'dsh-manuscript/host-api'
import {
  ARCHIVE_DIRECTORY,
  archiveDocument,
  copyEntry,
  deleteEntry,
  LifecycleError,
  listArchives,
  moveEntry,
  moveManuscriptDocument,
  moveNoReplace,
  moveNonWindowsNoReplace,
  moveWindowsNoReplace,
  renameDocument,
  renameEntry,
  restoreArchive,
  type LifecycleAccess,
} from './lifecycle.ts'
import { readProjectOverview } from './overview.ts'

let base = ''
beforeEach(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-lifecycle-')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(base, { recursive: true, force: true }) })

function nativeFs(): FileSystemLike {
  const target = (value: string): FsTargetLike => ({ targetKey: path.resolve(value), displayPath: path.resolve(value) })
  const kind = (state: import('node:fs').Stats): 'file' | 'directory' | 'other' => state.isFile() ? 'file' : state.isDirectory() ? 'directory' : 'other'
  return {
    async resolve(value, opts) { return target(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? base, value)) },
    contains(parent, child) { const relative = path.relative(parent.targetKey, child.targetKey); return !relative.startsWith('..') && !path.isAbsolute(relative) },
    async stat(value) { try { const state = await fs.stat(value.targetKey); return { type: kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async lstat(value, opts) { try { const state = await fs.lstat(path.isAbsolute(value) ? value : path.join(opts?.cwd ?? base, value)); return { type: state.isSymbolicLink() ? 'symlink' : kind(state), version: `${state.size}:${state.mtimeMs}`, size: state.size } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } },
    async readText(value) { return await fs.readFile(value.targetKey, 'utf8') },
    async listDir(value) { return (await fs.readdir(value.targetKey, { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const, target: target(path.join(value.targetKey, entry.name)) })) },
    async writeText(value, content, expected) {
      const old = await fs.readFile(value.targetKey, 'utf8').catch(() => null)
      if (expected?.kind === 'createIfAbsent' && old !== null) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
      if (expected?.kind === 'replaceIfVersion') {
        const state = await fs.stat(value.targetKey)
        if (`${state.size}:${state.mtimeMs}` !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
      }
      await fs.writeFile(value.targetKey, content, expected?.kind === 'createIfAbsent' ? { flag: 'wx' } : undefined)
      const state = await fs.stat(value.targetKey)
      return { operation: old === null ? 'create' as const : 'update' as const, version: `${state.size}:${state.mtimeMs}`, before: old, after: content }
    },
  }
}

async function noReplaceMove(source: string, target: string): Promise<void> {
  try {
    await fs.lstat(target)
    throw new LifecycleError('destination exists', 'EXISTS')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await fs.rename(source, target)
}

function access(root: string, mode: SandboxExecutionPolicyLike['mode'] = 'workspace-write', move = noReplaceMove): LifecycleAccess {
  const filesystem = nativeFs()
  const files: WorkspaceFileContext = {
    fs: filesystem,
    cwd: root,
    root: { targetKey: path.resolve(root), displayPath: path.resolve(root) },
    policy: { mode, workspaceRoot: root },
  }
  return { path: root, rootKey: path.resolve(root), mode, files, moveNoReplace: move }
}

function platformAccess(root: string): LifecycleAccess {
  const result = access(root)
  delete result.moveNoReplace
  return result
}

async function project(): Promise<string> {
  const root = path.join(base, 'project')
  await fs.mkdir(path.join(root, '正文'), { recursive: true })
  return root
}

describe('safe document lifecycle', () => {
  it('renames a saved document in place without overwriting another file', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, '正文', '001.md'), '# one')
    const source = await readTextFile(access(root).files, '正文/001.md')
    await expect(renameDocument({ access: access(root), path: '正文/001.md', newName: '序章', expectedVersion: source.version })).resolves.toMatchObject({ path: '正文/序章.md' })
    await expect(fs.readFile(path.join(root, '正文', '序章.md'), 'utf8')).resolves.toBe('# one')
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readProjectOverview(access(root))).resolves.toMatchObject({ chapters: [expect.objectContaining({ path: '正文/序章.md' })] })

    await fs.writeFile(path.join(root, '正文', '002.md'), 'two')
    await fs.writeFile(path.join(root, '正文', '已存在.md'), 'keep')
    const second = await readTextFile(access(root).files, '正文/002.md')
    await expect(renameDocument({ access: access(root), path: '正文/002.md', newName: '已存在', expectedVersion: second.version })).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(fs.readFile(path.join(root, '正文', '已存在.md'), 'utf8')).resolves.toBe('keep')
    await expect(fs.readFile(path.join(root, '正文', '002.md'), 'utf8')).resolves.toBe('two')
  })

  it('moves a saved manuscript document between visible manuscript directories without overwriting', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '正文', '第一卷'))
    await fs.writeFile(path.join(root, '正文', '001.md'), '# one')
    const observed = await readTextFile(access(root).files, '正文/001.md')
    await expect(moveManuscriptDocument({ access: access(root), path: '正文/001.md', targetDirectory: '正文/第一卷', expectedVersion: observed.version }))
      .resolves.toMatchObject({ path: '正文/第一卷/001.md' })
    await expect(fs.readFile(path.join(root, '正文', '第一卷', '001.md'), 'utf8')).resolves.toBe('# one')
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readProjectOverview(access(root))).resolves.toMatchObject({ chapters: [expect.objectContaining({ path: '正文/第一卷/001.md' })] })

    await fs.writeFile(path.join(root, '正文', '002.md'), 'source')
    await fs.writeFile(path.join(root, '正文', '第一卷', '002.md'), 'occupied')
    const second = await readTextFile(access(root).files, '正文/002.md')
    await expect(moveManuscriptDocument({ access: access(root), path: '正文/002.md', targetDirectory: '正文/第一卷', expectedVersion: second.version })).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(fs.readFile(path.join(root, '正文', '002.md'), 'utf8')).resolves.toBe('source')
    await expect(fs.readFile(path.join(root, '正文', '第一卷', '002.md'), 'utf8')).resolves.toBe('occupied')
  })

  it('rejects stale, same-directory, non-manuscript and linked move targets', async () => {
    const root = await project(); const outside = path.join(base, 'move-outside')
    await fs.mkdir(path.join(root, '正文', '第一卷'))
    await fs.mkdir(outside)
    await fs.writeFile(path.join(root, '正文', '001.md'), 'before')
    const observed = await readTextFile(access(root).files, '正文/001.md')
    await fs.writeFile(path.join(root, '正文', '001.md'), 'after')
    await expect(moveManuscriptDocument({ access: access(root), path: '正文/001.md', targetDirectory: '正文/第一卷', expectedVersion: observed.version })).rejects.toMatchObject({ code: 'STALE' })
    const latest = await readTextFile(access(root).files, '正文/001.md')
    await expect(moveManuscriptDocument({ access: access(root), path: '正文/001.md', targetDirectory: '正文', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(moveManuscriptDocument({ access: access(root), path: '人物卡/001.md', targetDirectory: '正文/第一卷', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await fs.symlink(outside, path.join(root, '正文', '链接'), 'junction')
    await expect(moveManuscriptDocument({ access: access(root), path: '正文/001.md', targetDirectory: '正文/链接', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(fs.readFile(path.join(root, '正文', '001.md'), 'utf8')).resolves.toBe('after')
  })

  it('rejects stale, read-only, escaping, case-only, and linked paths', async () => {
    const root = await project(); const outside = path.join(base, 'outside')
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'a.md'), 'outside')
    await fs.writeFile(path.join(root, '正文', 'A.md'), 'a')
    const observed = await readTextFile(access(root).files, '正文/A.md')
    await fs.writeFile(path.join(root, '正文', 'A.md'), 'changed')
    await expect(renameDocument({ access: access(root), path: '正文/A.md', newName: 'B', expectedVersion: observed.version })).rejects.toMatchObject({ code: 'STALE' })
    const latest = await readTextFile(access(root).files, '正文/A.md')
    await expect(renameDocument({ access: access(root, 'read-only'), path: '正文/A.md', newName: 'B', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(renameDocument({ access: access(root), path: '../A.md', newName: 'B', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(renameDocument({ access: access(root), path: '正文/A.md', newName: 'a', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(renameDocument({ access: access(root), path: '正文/A.md', newName: '.hidden', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(fs.readFile(path.join(root, '正文', 'A.md'), 'utf8')).resolves.toBe('changed')
    await fs.symlink(outside, path.join(root, 'link'), 'junction')
    await expect(renameDocument({ access: access(root), path: 'link/a.md', newName: 'B', expectedVersion: latest.version })).rejects.toMatchObject({ code: 'SYMLINK' })
  })

  it('rolls a replaced source path back without deleting either observed file', async () => {
    const root = await project()
    const sourcePath = path.join(root, '正文', '001.md')
    const displacedPath = path.join(root, '正文', 'external-original.md')
    await fs.writeFile(sourcePath, 'observed')
    let swapped = false
    const swapping = access(root, 'workspace-write', async (source, target) => {
      if (!swapped) {
        swapped = true
        await fs.rename(source, displacedPath)
        await fs.writeFile(source, 'external replacement')
      }
      await noReplaceMove(source, target)
    })
    const observed = await readTextFile(swapping.files, '正文/001.md')
    await expect(renameDocument({ access: swapping, path: '正文/001.md', newName: '序章', expectedVersion: observed.version })).rejects.toMatchObject({ code: 'STALE' })
    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe('external replacement')
    await expect(fs.readFile(displacedPath, 'utf8')).resolves.toBe('observed')
    await expect(fs.stat(path.join(root, '正文', '序章.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('archives, lists, and restores without hard deletion or overwrite', async () => {
    const root = await project(); const lifecycle = access(root)
    await fs.writeFile(path.join(root, '正文', '001.md'), '# one')
    const source = await readTextFile(lifecycle.files, '正文/001.md')
    const archived = await archiveDocument({ access: lifecycle, path: '正文/001.md', expectedVersion: source.version })
    expect(archived).toMatchObject({ path: '正文/001.md', state: 'archived' })
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readProjectOverview(lifecycle)).resolves.toMatchObject({ chapters: [], totals: { chapters: 0, chars: 0 } })
    const listed = await listArchives(lifecycle)
    expect(listed).toMatchObject({ invalid: 0, items: [expect.objectContaining({ archiveId: archived.archiveId, state: 'archived' })] })
    const restored = await restoreArchive({ access: lifecycle, archiveId: archived.archiveId, expectedVersion: listed.items[0]!.version })
    expect(restored.state).toBe('restored')
    await expect(fs.readFile(path.join(root, '正文', '001.md'), 'utf8')).resolves.toBe('# one')
    await expect(readProjectOverview(lifecycle)).resolves.toMatchObject({ chapters: [expect.objectContaining({ path: '正文/001.md' })] })
    expect(await listArchives(lifecycle)).toEqual({ invalid: 0, items: [expect.objectContaining({ state: 'restored' })] })
  })

  it('keeps an archive intact when the original path is occupied during restore', async () => {
    const root = await project(); const lifecycle = access(root)
    await fs.writeFile(path.join(root, '正文', '001.md'), 'old')
    const source = await readTextFile(lifecycle.files, '正文/001.md')
    const archived = await archiveDocument({ access: lifecycle, path: '正文/001.md', expectedVersion: source.version })
    await fs.writeFile(path.join(root, '正文', '001.md'), 'new')
    const current = (await listArchives(lifecycle)).items[0]!
    await expect(restoreArchive({ access: lifecycle, archiveId: archived.archiveId, expectedVersion: current.version })).resolves.toMatchObject({ state: 'blocked' })
    await expect(fs.readFile(path.join(root, '正文', '001.md'), 'utf8')).resolves.toBe('new')
    const payload = (await fs.readdir(path.join(root, ARCHIVE_DIRECTORY), { withFileTypes: true })).find((entry) => entry.isDirectory())!
    await expect(fs.readFile(path.join(root, ARCHIVE_DIRECTORY, payload.name, 'payload.md'), 'utf8')).resolves.toBe('old')
  })

  it('exposes an interrupted pre-move record and resumes it explicitly', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    const failing = access(root, 'workspace-write', async () => { throw new LifecycleError('injected stop', 'IO') })
    const observed = await readTextFile(failing.files, '正文/001.md')
    await expect(archiveDocument({ access: failing, path: '正文/001.md', expectedVersion: observed.version })).rejects.toMatchObject({ code: 'IO' })
    const pending = await listArchives(access(root))
    expect(pending).toEqual({ invalid: 0, items: [expect.objectContaining({ state: 'pending-archive', version: expect.any(String) })] })
    await expect(archiveDocument({ access: access(root), archiveId: pending.items[0]!.archiveId })).resolves.toMatchObject({ state: 'archived' })
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recognizes a lost success response and blocks a tampered archive payload', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    const lostResponse = access(root, 'workspace-write', async (source, target) => { await noReplaceMove(source, target); throw new LifecycleError('lost response', 'IO') })
    const observed = await readTextFile(lostResponse.files, '正文/001.md')
    const archived = await archiveDocument({ access: lostResponse, path: '正文/001.md', expectedVersion: observed.version })
    expect(archived.state).toBe('archived')
    const record = (await fs.readdir(path.join(root, ARCHIVE_DIRECTORY), { withFileTypes: true })).find((entry) => entry.isDirectory())!
    await fs.writeFile(path.join(root, ARCHIVE_DIRECTORY, record.name, 'payload.md'), 'tampered')
    const blocked = (await listArchives(access(root))).items[0]!
    expect(blocked.state).toBe('blocked')
    await expect(restoreArchive({ access: access(root), archiveId: archived.archiveId, expectedVersion: blocked.version })).resolves.toMatchObject({ state: 'blocked' })
  })

  it('reports malformed archive records without advertising them as restorable', async () => {
    const root = await project()
    const record = `20260829T120000-${randomUUID()}`
    await fs.mkdir(path.join(root, ARCHIVE_DIRECTORY, record), { recursive: true })
    await fs.writeFile(path.join(root, ARCHIVE_DIRECTORY, record, 'manifest.json'), '{broken')

    await expect(listArchives(access(root))).resolves.toEqual({ items: [], invalid: 1 })
  })
})

describe('entry file-tree operations', () => {
  it('copies a file to another directory, auto-renames on collision, and refuses an occupied target when no slot remains', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '大纲'))
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await expect(copyEntry({ access: access(root), path: '正文/001.md', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/001.md' })
    await expect(fs.readFile(path.join(root, '大纲', '001.md'), 'utf8')).resolves.toBe('one')
    await expect(fs.readFile(path.join(root, '正文', '001.md'), 'utf8')).resolves.toBe('one')

    await expect(copyEntry({ access: access(root), path: '正文/001.md', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/001 2.md' })
    await expect(copyEntry({ access: access(root), path: '正文/001.md', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/001 3.md' })
    await expect(fs.readdir(path.join(root, '大纲'))).resolves.toEqual(['001 2.md', '001 3.md', '001.md'])
  })

  it('recursively copies a directory tree, including nested subdirectories and files', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '大纲'))
    await fs.mkdir(path.join(root, '正文', '卷一'))
    await fs.mkdir(path.join(root, '正文', '卷一', '深层'))
    await fs.writeFile(path.join(root, '正文', '卷一', '001.md'), 'one')
    await fs.writeFile(path.join(root, '正文', '卷一', '深层', '笔记.md'), 'note')

    await expect(copyEntry({ access: access(root), path: '正文/卷一', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/卷一' })

    await expect(fs.readFile(path.join(root, '大纲', '卷一', '001.md'), 'utf8')).resolves.toBe('one')
    await expect(fs.readFile(path.join(root, '大纲', '卷一', '深层', '笔记.md'), 'utf8')).resolves.toBe('note')
    await expect(fs.readFile(path.join(root, '正文', '卷一', '001.md'), 'utf8')).resolves.toBe('one')
    await expect(copyEntry({ access: access(root), path: '正文/卷一', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/卷一 2' })
    await expect(fs.readdir(path.join(root, '大纲', '卷一 2'))).resolves.toEqual(['001.md', '深层'])
  })

  it('accepts the workspace root as a copy target and rejects copying a directory into itself', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '正文', '卷一', '深层'), { recursive: true })
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await fs.writeFile(path.join(root, '正文', '卷一', '深层', '笔记.md'), 'note')

    await expect(copyEntry({ access: access(root), path: '正文/001.md', targetDir: '' })).resolves.toEqual({ path: '001.md' })
    await expect(copyEntry({ access: access(root), path: '正文/001.md', targetDir: '.' })).resolves.toEqual({ path: '001 2.md' })
    await expect(copyEntry({ access: access(root), path: '正文/卷一', targetDir: '正文/卷一' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(copyEntry({ access: access(root), path: '正文/卷一', targetDir: '正文/卷一/深层' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(fs.stat(path.join(root, '正文', '卷一', '卷一'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(root, '正文', '卷一', '深层', '卷一'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('moves a file to another directory, refuses an occupied target, and rejects moving into the same directory', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '大纲'))
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await expect(moveEntry({ access: access(root), path: '正文/001.md', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/001.md' })
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(root, '大纲', '001.md'), 'utf8')).resolves.toBe('one')

    await fs.writeFile(path.join(root, '正文', '002.md'), 'two')
    await fs.writeFile(path.join(root, '大纲', '002.md'), 'occupied')
    await expect(moveEntry({ access: access(root), path: '正文/002.md', targetDir: '大纲' })).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(fs.readFile(path.join(root, '正文', '002.md'), 'utf8')).resolves.toBe('two')
    await expect(fs.readFile(path.join(root, '大纲', '002.md'), 'utf8')).resolves.toBe('occupied')

    await expect(moveEntry({ access: access(root), path: '大纲/001.md', targetDir: '大纲' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })

  it('moves a directory recursively, rejects a missing target dir, and refuses moving a directory into itself', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '大纲'))
    await fs.mkdir(path.join(root, '正文', '卷一'))
    await fs.mkdir(path.join(root, '正文', '卷一', '深层'))
    await fs.writeFile(path.join(root, '正文', '卷一', '001.md'), 'one')
    await fs.writeFile(path.join(root, '正文', '卷一', '深层', '笔记.md'), 'note')

    await expect(moveEntry({ access: access(root), path: '正文/卷一', targetDir: '大纲' })).resolves.toEqual({ path: '大纲/卷一' })
    await expect(fs.stat(path.join(root, '正文', '卷一'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(root, '大纲', '卷一', '001.md'), 'utf8')).resolves.toBe('one')
    await expect(fs.readFile(path.join(root, '大纲', '卷一', '深层', '笔记.md'), 'utf8')).resolves.toBe('note')

    await fs.mkdir(path.join(root, '正文', 'self'))
    await fs.mkdir(path.join(root, '正文', 'self', 'child'))
    await expect(moveEntry({ access: access(root), path: '正文/self', targetDir: '正文/self/child' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(moveEntry({ access: access(root), path: '正文/self', targetDir: 'nonexistent' })).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(fs.readdir(path.join(root, '正文', 'self'))).resolves.toEqual(['child'])
  })

  it('deletes a file or directory recursively, refuses the root, and rejects a missing source', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '大纲'))
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await expect(deleteEntry({ access: access(root), path: '正文/001.md' })).resolves.toEqual({ path: '正文/001.md' })
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    await fs.mkdir(path.join(root, '正文', '卷一'))
    await fs.writeFile(path.join(root, '正文', '卷一', '001.md'), 'one')
    await fs.writeFile(path.join(root, '正文', '卷一', '002.md'), 'two')
    await expect(deleteEntry({ access: access(root), path: '正文/卷一' })).resolves.toEqual({ path: '正文/卷一' })
    await expect(fs.stat(path.join(root, '正文', '卷一'))).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(deleteEntry({ access: access(root), path: '.' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(deleteEntry({ access: access(root), path: 'nope.md' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('renames a file or directory, refuses an occupied target, and rejects case-only or no-op renames', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await expect(renameEntry({ access: access(root), path: '正文/001.md', name: '序章.md' })).resolves.toEqual({ path: '正文/序章.md' })
    await expect(fs.readFile(path.join(root, '正文', '序章.md'), 'utf8')).resolves.toBe('one')
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    await fs.mkdir(path.join(root, '正文', '卷一'))
    await expect(renameEntry({ access: access(root), path: '正文/卷一', name: '第一卷' })).resolves.toEqual({ path: '正文/第一卷' })
    await expect(fs.stat(path.join(root, '正文', '卷一'))).rejects.toMatchObject({ code: 'ENOENT' })
    const renamedStats = await fs.stat(path.join(root, '正文', '第一卷'))
    expect(renamedStats.isDirectory()).toBe(true)

    await fs.writeFile(path.join(root, '正文', 'a.md'), 'a')
    await fs.writeFile(path.join(root, '正文', 'b.md'), 'b')
    await expect(renameEntry({ access: access(root), path: '正文/a.md', name: 'b.md' })).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(renameEntry({ access: access(root), path: '正文/a.md', name: 'a.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await fs.writeFile(path.join(root, '正文', 'A.md'), 'upper')
    await expect(renameEntry({ access: access(root), path: '正文/A.md', name: 'a.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(fs.readFile(path.join(root, '正文', 'A.md'), 'utf8')).resolves.toBe('upper')
  })

  it('rejects absolute paths, .. escapes, the .dsh-editor prefix, read-only access, and bad target directories', async () => {
    const root = await project()
    await fs.mkdir(path.join(root, '大纲'))
    await fs.writeFile(path.join(root, '正文', '001.md'), 'one')
    await expect(copyEntry({ access: access(root), path: '/abs/001.md', targetDir: '大纲' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(moveEntry({ access: access(root), path: '../escape.md', targetDir: '大纲' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(deleteEntry({ access: access(root), path: '.dsh-editor/snapshot.json' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(renameEntry({ access: access(root), path: '正文/001.md', name: 'a/b.md' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(copyEntry({ access: access(root), path: '正文/001.md', targetDir: '.dsh-editor' })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(copyEntry({ access: access(root), path: '正文/001.md', targetDir: 'no-such-dir' })).rejects.toMatchObject({ code: 'BLOCKED' })
    await expect(moveEntry({ access: access(root), path: 'nope.md', targetDir: '大纲' })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const readOnly = access(root, 'read-only')
    await expect(copyEntry({ access: readOnly, path: '正文/001.md', targetDir: '大纲' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(moveEntry({ access: readOnly, path: '正文/001.md', targetDir: '大纲' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(deleteEntry({ access: readOnly, path: '正文/001.md' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(renameEntry({ access: readOnly, path: '正文/001.md', name: 'b.md' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(fs.readFile(path.join(root, '正文', '001.md'), 'utf8')).resolves.toBe('one')
  })
})

describe.skipIf(process.platform !== 'win32')('Windows no-replace move primitive', () => {
  it('atomically refuses an occupied target and preserves both files', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    await fs.writeFile(source, 'source'); await fs.writeFile(target, 'occupied')
    await expect(moveWindowsNoReplace(source, target)).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('source')
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('occupied')
  })
})

describe('portable no-replace move primitive', () => {
  it('does not overwrite an occupied target and restores the source after failure', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    await fs.writeFile(source, 'source'); await fs.writeFile(target, 'occupied')
    await expect(moveNonWindowsNoReplace(source, target)).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('source')
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('occupied')
  })

  it('moves a file through a staged hard link without leaving the source', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    await fs.writeFile(source, 'source')
    await expect(moveNonWindowsNoReplace(source, target)).resolves.toBeUndefined()
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('source')
  })

  it('checks cancellation before modifying either path', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    const controller = new AbortController()
    await fs.writeFile(source, 'source')
    controller.abort()
    await expect(moveNonWindowsNoReplace(source, target, controller.signal)).rejects.toMatchObject({ code: 'IO' })
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('source')
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves an external replacement created before the target link', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    const originalLink = fs.link.bind(fs)
    await fs.writeFile(source, 'old')
    vi.spyOn(fs, 'link').mockImplementationOnce(async (existing, destination) => {
      const replacement = path.join(base, `${randomUUID()}.replacement`)
      await fs.writeFile(replacement, 'new')
      await fs.rename(replacement, source)
      await originalLink(existing, destination)
    })

    await expect(moveNonWindowsNoReplace(source, target)).resolves.toBeUndefined()
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('old')
  })

  it('preserves an external replacement created after the target link', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    const originalLink = fs.link.bind(fs)
    await fs.writeFile(source, 'old')
    vi.spyOn(fs, 'link').mockImplementationOnce(async (existing, destination) => {
      await originalLink(existing, destination)
      const replacement = path.join(base, `${randomUUID()}.replacement`)
      await fs.writeFile(replacement, 'new')
      await fs.rename(replacement, source)
    })

    await expect(moveNonWindowsNoReplace(source, target)).resolves.toBeUndefined()
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('new')
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('old')
  })

  it('retains a recoverable staging file when a failed link finds a replacement source', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    await fs.writeFile(source, 'old')
    vi.spyOn(fs, 'link').mockImplementationOnce(async () => {
      const replacement = path.join(base, `${randomUUID()}.replacement`)
      await fs.writeFile(replacement, 'new')
      await fs.rename(replacement, source)
      throw Object.assign(new Error('injected link failure'), { code: 'EIO' })
    })

    const failure = await moveNonWindowsNoReplace(source, target).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'STALE', recoveryPath: expect.any(String) })
    const recoveryPath = (failure as LifecycleError).recoveryPath!
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('new')
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(recoveryPath, 'utf8')).resolves.toBe('old')
  })

  it('uses the selected platform primitive by default', async () => {
    const root = await project()
    const source = path.join(root, '正文', '001.md'); const target = path.join(root, '正文', '序章.md')
    await fs.writeFile(source, 'one')
    await expect(moveNoReplace(source, target)).resolves.toBeUndefined()
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('one')

    await fs.writeFile(source, 'two')
    const observed = await readTextFile(platformAccess(root).files, '正文/001.md')
    await expect(renameDocument({ access: platformAccess(root), path: '正文/001.md', newName: '第二章', expectedVersion: observed.version }))
      .resolves.toMatchObject({ path: '正文/第二章.md' })
  })
})
it('reports recovery when staged cleanup fails instead of hiding the partial move',async()=>{
  const root=await project()
  const source=path.join(root,'正文','001.md')
  await fs.writeFile(source,'original')
  const acc=access(root)
  acc.moveNoReplace=moveNonWindowsNoReplace
  const version=(await readTextFile(acc.files,'正文/001.md')).version
  const unlink=fs.unlink.bind(fs)
  vi.spyOn(fs,'unlink').mockImplementation(async target=>{
    if(String(target).endsWith('.move')) throw Object.assign(new Error('locked stage'),{code:'EPERM'})
    return unlink(target)
  })
  const error=await renameDocument({access:acc,path:'正文/001.md',newName:'renamed',expectedVersion:version}).catch(e=>e)
  expect(error).toBeInstanceOf(LifecycleError)
  expect(error.recoveryPath).toBeTruthy()
  expect(await fs.readFile(error.recoveryPath,'utf8')).toBe('original')
  expect(await fs.readFile(path.join(root,'正文','renamed.md'),'utf8')).toBe('original')
})
