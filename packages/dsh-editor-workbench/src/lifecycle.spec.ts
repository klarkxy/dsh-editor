import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTextFile, type FileSystemLike, type FsTargetLike, type SandboxExecutionPolicyLike, type WorkspaceFileContext } from 'dsh-manuscript/host-api'
import {
  ARCHIVE_DIRECTORY,
  archiveDocument,
  LifecycleError,
  listArchives,
  moveManuscriptDocument,
  moveWindowsNoReplace,
  renameDocument,
  restoreArchive,
  type LifecycleAccess,
} from './lifecycle.ts'
import { readProjectOverview, setChapterStatus } from './overview.ts'

let base = ''
beforeEach(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-lifecycle-')) })
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }) })

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

async function project(): Promise<string> {
  const root = path.join(base, 'project')
  await fs.mkdir(path.join(root, '正文'), { recursive: true })
  return root
}

describe('safe document lifecycle', () => {
  it('renames a saved document in place without overwriting another file', async () => {
    const root = await project()
    await fs.writeFile(path.join(root, '正文', '001.md'), '# one')
    await setChapterStatus({ access: access(root), path: '正文/001.md', status: 'revising', expectedStatusRevision: null })
    const source = await readTextFile(access(root).files, '正文/001.md')
    await expect(renameDocument({ access: access(root), path: '正文/001.md', newName: '序章', expectedVersion: source.version })).resolves.toMatchObject({ path: '正文/序章.md' })
    await expect(fs.readFile(path.join(root, '正文', '序章.md'), 'utf8')).resolves.toBe('# one')
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readProjectOverview(access(root))).resolves.toMatchObject({ chapters: [expect.objectContaining({ path: '正文/序章.md', status: 'revising' })] })

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
    await setChapterStatus({ access: access(root), path: '正文/001.md', status: 'final', expectedStatusRevision: null })
    const observed = await readTextFile(access(root).files, '正文/001.md')
    await expect(moveManuscriptDocument({ access: access(root), path: '正文/001.md', targetDirectory: '正文/第一卷', expectedVersion: observed.version }))
      .resolves.toMatchObject({ path: '正文/第一卷/001.md' })
    await expect(fs.readFile(path.join(root, '正文', '第一卷', '001.md'), 'utf8')).resolves.toBe('# one')
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readProjectOverview(access(root))).resolves.toMatchObject({ chapters: [expect.objectContaining({ path: '正文/第一卷/001.md', status: 'final' })] })

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
    await setChapterStatus({ access: lifecycle, path: '正文/001.md', status: 'final', expectedStatusRevision: null })
    const source = await readTextFile(lifecycle.files, '正文/001.md')
    const archived = await archiveDocument({ access: lifecycle, path: '正文/001.md', expectedVersion: source.version })
    expect(archived).toMatchObject({ path: '正文/001.md', state: 'archived' })
    await expect(fs.stat(path.join(root, '正文', '001.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readProjectOverview(lifecycle)).resolves.toMatchObject({ chapters: [], totals: { byStatus: { draft: 0, revising: 0, final: 0 } } })
    const listed = await listArchives(lifecycle)
    expect(listed).toMatchObject({ invalid: 0, items: [expect.objectContaining({ archiveId: archived.archiveId, state: 'archived' })] })
    const restored = await restoreArchive({ access: lifecycle, archiveId: archived.archiveId, expectedVersion: listed.items[0]!.version })
    expect(restored.state).toBe('restored')
    await expect(fs.readFile(path.join(root, '正文', '001.md'), 'utf8')).resolves.toBe('# one')
    await expect(readProjectOverview(lifecycle)).resolves.toMatchObject({ chapters: [expect.objectContaining({ path: '正文/001.md', status: 'final' })] })
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

describe.skipIf(process.platform !== 'win32')('Windows no-replace move primitive', () => {
  it('atomically refuses an occupied target and preserves both files', async () => {
    const source = path.join(base, 'source.md'); const target = path.join(base, 'target.md')
    await fs.writeFile(source, 'source'); await fs.writeFile(target, 'occupied')
    await expect(moveWindowsNoReplace(source, target)).rejects.toMatchObject({ code: 'EXISTS' })
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('source')
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('occupied')
  })
})
