import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystemLike, FsInfoLike, FsPathInfoLike, FsTargetLike, FsWriteIntentLike, ManuscriptHost } from 'dsh-manuscript/host-api'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { workbenchMutationEndpoints } from './index.ts'
import { dispatchEditorFiles, mapEditorFilesError } from '../index.ts'
import type { WorkbenchRpcResult } from '../contracts.ts'

/** Exact mutation set from the previous hand-written `mutations` array in dispatchEditorFiles. */
const PREVIOUS_MUTATIONS = [
  'rules.open',
  'memory.apply',
  'memory.undo',
  'project.init',
  'project.prepareIndex',
  'project.importApply',
  'project.importCleanup',
  'snapshot.create',
  'snapshot.rollback',
  'snapshot.restoreApply',
  'snapshot.restoreCleanup',
  'structure.groupCreate',
  'directory.create',
  'file.rename',
  'file.moveManuscript',
  'archive.apply',
  'archive.restore',
  'proposal.apply',
  'entry.copy',
  'entry.move',
  'entry.delete',
  'entry.rename',
  'progress.record',
] as const

describe('workbench handler table', () => {
  it('derives the mutation set from the handler table', () => {
    expect(new Set(workbenchMutationEndpoints())).toEqual(new Set(PREVIOUS_MUTATIONS))
  })
})

class NodeFileSystem implements FileSystemLike {
  constructor(private readonly root: string) {}
  async resolve(value: string, options?: { cwd?: string }): Promise<FsTargetLike> {
    const absolute = path.resolve(options?.cwd ?? this.root, value)
    return { targetKey: absolute, displayPath: absolute }
  }
  contains(parent: FsTargetLike, child: FsTargetLike): boolean {
    const relative = path.relative(parent.targetKey, child.targetKey)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
  async stat(target: FsTargetLike): Promise<FsInfoLike | undefined> {
    try {
      const state = await fs.stat(target.targetKey)
      return { type: state.isDirectory() ? 'directory' : state.isFile() ? 'file' : 'other', version: `${state.mtimeMs}:${state.size}`, size: state.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async lstat(value: string, options?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    try {
      const state = await fs.lstat(path.resolve(options?.cwd ?? this.root, value))
      return { type: state.isSymbolicLink() ? 'symlink' : state.isDirectory() ? 'directory' : state.isFile() ? 'file' : 'other', version: `${state.mtimeMs}:${state.size}`, size: state.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async readText(target: FsTargetLike): Promise<string> { return await fs.readFile(target.targetKey, 'utf8') }
  async listDir(target: FsTargetLike) {
    return (await fs.readdir(target.targetKey, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : 'other' as const,
      target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
    }))
  }
  async writeText(target: FsTargetLike, text: string, intent?: FsWriteIntentLike) {
    const current = await this.stat(target)
    if (intent?.kind === 'createIfAbsent' && current) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (intent?.kind === 'replaceIfVersion' && current?.version !== intent.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    const before = current ? await this.readText(target) : null
    await fs.writeFile(target.targetKey, text)
    return { operation: current ? 'update' as const : 'create' as const, version: (await this.stat(target))!.version!, before, after: text }
  }
}

describe('adapted proposal RPC with real files', () => {
  let root = ''
  let host: ManuscriptHost
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-proposal-dispatch-'))
    host = {
      sessions: { get: () => ({ id: 'session-1', header: { cwd: root }, requestHeader: () => undefined }) },
      workspaceRegistry: { resolveByPath: async () => ({ path: root, sessionIds: ['session-1'] }) },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root, sessionId: 'session-1' }) },
      fs: new NodeFileSystem(root),
      connection: { requestRejection: () => undefined },
    } as unknown as ManuscriptHost
  })
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

  async function seed(relative: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await fs.writeFile(path.join(root, relative), text)
  }
  async function version(relative: string): Promise<string> {
    return String((await host.fs.stat(await host.fs.resolve(relative, { cwd: root })))!.version)
  }
  async function read(relative: string): Promise<string> { return await fs.readFile(path.join(root, relative), 'utf8') }
  async function call(endpoint: 'proposal.prepare' | 'proposal.apply', proposal: unknown, expectedVersions?: Record<string, string>): Promise<WorkbenchRpcResult> {
    try {
      return { ok: true, value: await dispatchEditorFiles(host as unknown as Context, endpoint, { sessionId: 'session-1', proposal, expectedVersions }, new AbortController().signal) }
    } catch (error) { return mapEditorFilesError(error) }
  }
  async function prepared<T>(proposal: unknown): Promise<T> {
    const result = await call('proposal.prepare', proposal)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }
  const envelope = (version: 1 | 2) => ({ marker: 'dsh-editor.proposal', version, summary: '作者确认的修改' })

  it('preserves V1 empty-placeholder fill and V2 exclusive creation, including nested TXT receipts', async () => {
    await seed('notes/empty.md', ' ')
    const create = { ...envelope(1), kind: 'create', path: 'notes/empty.md', text: '作者批准的内容' }
    const exclusive = { ...create, version: 2 }
    expect(await call('proposal.prepare', exclusive)).toMatchObject({ ok: false, error: { details: { reason: 'EXISTS' } } })
    expect(await call('proposal.apply', exclusive, { [create.path]: '' })).toMatchObject({ ok: false, error: { details: { reason: 'EXISTS' } } })
    expect(await read(create.path)).toBe(' ')
    const blank = await prepared<{ create: { version: string } }>(create)
    expect(blank.create.version).toBeTruthy()
    expect(await call('proposal.apply', create, { [create.path]: blank.create.version })).toMatchObject({ ok: true, value: { path: create.path, operation: 'create' } })
    expect(await read(create.path)).toBe(create.text)

    const text = { ...envelope(2), kind: 'create', path: 'world/places/harbor.txt', text: '港口设定' }
    const preview = await prepared<{ create: { version: string; missingDirectories: string[] } }>(text)
    expect(preview.create).toMatchObject({ version: '', missingDirectories: ['world', 'world/places'] })
    await expect(fs.stat(path.join(root, 'world'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await call('proposal.apply', text)).toMatchObject({ ok: false, error: { details: { reason: 'STALE' } } })
    expect(await call('proposal.apply', text, { [text.path]: preview.create.version })).toMatchObject({ ok: true, value: { path: text.path, operation: 'create', version: expect.any(String) } })
    expect(await read(text.path)).toBe(text.text)
    expect(await call('proposal.apply', text, { [text.path]: '' })).toMatchObject({ ok: false, error: { details: { reason: 'EXISTS' } } })
  })

  it.each([1, 2] as const)('prepares and applies split/merge through the common executor for V%i', async (wireVersion) => {
    const extension = wireVersion === 1 ? 'md' : 'txt'
    const target = `notes/full.${extension}`
    const tail = `notes/tail.${extension}`
    const original = '前文\n## 转折\n后文'
    await seed(target, original)
    const split = { ...envelope(wireVersion), kind: 'split', path: target, newPath: tail, anchor: '## 转折', ...(wireVersion === 2 ? { targetVersion: await version(target) } : {}) }
    const preview = await prepared<{ split: { version: string; before: string; after: string } }>(split)
    expect(preview.split).toMatchObject({ before: '前文\n', after: '## 转折\n后文' })
    expect(await read(target)).toBe(original)
    const result = await call('proposal.apply', split, { [target]: preview.split.version })
    expect(result).toMatchObject({ ok: true, value: { applied: [target, tail], snapshotDir: expect.stringContaining('.dsh-editor/history/') } })
    if (!result.ok) throw new Error(result.error.message)
    const snapshotDir = (result.value as { snapshotDir: string }).snapshotDir
    expect(await read(`${snapshotDir}/${target}`)).toBe(original)
    expect(await read(target)).toBe('前文')
    expect(await read(tail)).toBe('## 转折\n后文')
    const merge = { ...envelope(wireVersion), kind: 'merge', path: target, sourcePath: tail, ...(wireVersion === 2 ? { targetVersion: await version(target), sourceVersion: await version(tail) } : {}) }
    const mergePlan = await prepared<{ merge: { versions: { path: string; sourcePath: string } } }>(merge)
    expect(await call('proposal.apply', merge, { [target]: mergePlan.merge.versions.path, [tail]: mergePlan.merge.versions.sourcePath })).toMatchObject({ ok: true, value: { applied: [target, tail] } })
    expect(await read(target)).toBe('前文\n\n## 转折\n后文\n')
    await expect(fs.stat(path.join(root, tail))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves V1 movement restrictions and enables V2 ordinary TXT rename plus movement', async () => {
    await seed('notes/a.md', 'Markdown source')
    await seed('notes/b.txt', 'TXT source')
    await fs.mkdir(path.join(root, 'archive'))
    const legacy = { ...envelope(1), kind: 'renames', renames: [{ from: 'notes/a.md', to: 'archive/renamed.md' }] }
    expect(await call('proposal.prepare', legacy)).toMatchObject({ ok: false, error: { details: { reason: 'INVALID' } } })
    const proposal = { ...envelope(2), kind: 'renames', renames: [
      { from: 'notes/a.md', to: 'archive/renamed.md', version: await version('notes/a.md') },
      { from: 'notes/b.txt', to: 'archive/renamed.txt', version: await version('notes/b.txt') },
    ] }
    const preview = await prepared<{ renames: { versions: Record<string, string>; entries: unknown[] } }>(proposal)
    expect(preview.renames.entries).toEqual(proposal.renames)
    expect(await call('proposal.apply', proposal, preview.renames.versions)).toMatchObject({ ok: true, value: { applied: ['archive/renamed.md', 'archive/renamed.txt'] } })
    expect(await read('archive/renamed.md')).toBe('Markdown source')
    expect(await read('archive/renamed.txt')).toBe('TXT source')
    await expect(fs.stat(path.join(root, 'notes/b.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the V1 same-directory lifecycle behavior for historical generated-directory paths', async () => {
    await seed('dist/a.md', 'historical V1 file')
    const proposal = { ...envelope(1), kind: 'renames', renames: [{ from: 'dist/a.md', to: 'dist/b.md' }] }
    const preview = await prepared<{ renames: { versions: Record<string, string> } }>(proposal)
    expect(await call('proposal.apply', proposal, preview.renames.versions)).toMatchObject({ ok: true, value: { applied: ['dist/b.md'] } })
    expect(await read('dist/b.md')).toBe('historical V1 file')
    expect(await call('proposal.prepare', { ...envelope(2), kind: 'renames', renames: [{ from: 'dist/b.md', to: 'dist/c.md', version: await version('dist/b.md') }] })).toMatchObject({ ok: false, error: { details: { reason: 'INVALID' } } })
  })

  it.each(['split', 'merge', 'renames'] as const)('retains the V2 generation baseline for %s even with a fresh confirmation version', async (kind) => {
    await seed('notes/a.txt', '前文\n## 转折\n后文')
    await seed('notes/b.txt', '附录')
    const targetVersion = await version('notes/a.txt')
    const proposal = kind === 'renames'
      ? { ...envelope(2), kind, renames: [{ from: 'notes/a.txt', to: 'notes/changed.txt', version: targetVersion }] }
      : { ...envelope(2), kind, path: 'notes/a.txt', targetVersion, ...(kind === 'split' ? { anchor: '## 转折', newPath: 'notes/tail.txt' } : { sourcePath: 'notes/b.txt', sourceVersion: await version('notes/b.txt') }) }
    await prepared(proposal)
    const changed = '作者已经修改前文\n## 转折\n后文'
    await seed('notes/a.txt', changed)
    expect(await call('proposal.prepare', proposal)).toMatchObject({ ok: false, error: { details: { reason: 'STALE' } } })
    expect(await call('proposal.apply', proposal, { 'notes/a.txt': await version('notes/a.txt'), 'notes/b.txt': await version('notes/b.txt') })).toMatchObject({ ok: false, error: { details: { reason: 'STALE' } } })
    expect(await read('notes/a.txt')).toBe(changed)
    expect(await read('notes/b.txt')).toBe('附录')
    await expect(fs.stat(path.join(root, kind === 'renames' ? 'notes/changed.txt' : 'notes/tail.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rechecks a V2 source basis on both preview and application', async () => {
    await seed('notes/guide.md', '原设定')
    const proposal = { ...envelope(2), kind: 'create', path: 'notes/new.txt', text: '根据设定写出的内容', basis: [{ path: 'notes/guide.md', version: await version('notes/guide.md') }] }
    await prepared(proposal)
    await seed('notes/guide.md', '作者已改设定')
    expect(await call('proposal.prepare', proposal)).toMatchObject({ ok: false, error: { details: { reason: 'STALE' } } })
    expect(await call('proposal.apply', proposal, { [proposal.path]: '' })).toMatchObject({ ok: false, error: { details: { reason: 'STALE' } } })
    await expect(fs.stat(path.join(root, proposal.path))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns partial rename receipts after a later destination is occupied without replacing either file', async () => {
    await seed('notes/a.txt', 'first')
    await seed('notes/b.txt', 'second')
    const proposal = { ...envelope(2), kind: 'renames', renames: [
      { from: 'notes/a.txt', to: 'notes/a-moved.txt', version: await version('notes/a.txt') },
      { from: 'notes/b.txt', to: 'notes/b-moved.txt', version: await version('notes/b.txt') },
    ] }
    const preview = await prepared<{ renames: { versions: Record<string, string> } }>(proposal)
    await seed('notes/b-moved.txt', 'author destination')
    const result = await call('proposal.apply', proposal, preview.renames.versions)
    expect(result).toMatchObject({ ok: true, value: { applied: ['notes/a-moved.txt'], failed: { from: 'notes/b.txt' }, snapshotDir: expect.any(String) } })
    expect(await read('notes/a-moved.txt')).toBe('first')
    expect(await read('notes/b.txt')).toBe('second')
    expect(await read('notes/b-moved.txt')).toBe('author destination')
    if (!result.ok) throw new Error(result.error.message)
    const snapshotDir = (result.value as { snapshotDir: string }).snapshotDir
    expect(await read(`${snapshotDir}/notes/a.txt`)).toBe('first')
    expect(await read(`${snapshotDir}/notes/b.txt`)).toBe('second')
  })

  it.each(['split', 'merge'] as const)('maps %s partial failure to a recovery receipt and preserves the source snapshot', async (kind) => {
    const original = '前文\n## 转折\n后文'
    await seed('notes/a.txt', original)
    await seed('notes/b.txt', '附录')
    const proposal = { ...envelope(2), kind, path: 'notes/a.txt', targetVersion: await version('notes/a.txt'), ...(kind === 'split' ? { anchor: '## 转折', newPath: 'notes/tail.txt' } : { sourcePath: 'notes/b.txt', sourceVersion: await version('notes/b.txt') }) }
    const preview = await prepared(proposal)
    const versions = kind === 'split'
      ? { 'notes/a.txt': (preview as { split: { version: string } }).split.version }
      : { 'notes/a.txt': (preview as { merge: { versions: { path: string } } }).merge.versions.path, 'notes/b.txt': (preview as { merge: { versions: { sourcePath: string } } }).merge.versions.sourcePath }
    const write = host.fs.writeText.bind(host.fs)
    host.fs.writeText = async (...args) => {
      const target = String(args[0].targetKey).replace(/\\/g, '/')
      if ((kind === 'split' && target === path.join(root, 'notes/a.txt').replace(/\\/g, '/') && args[2]?.kind === 'replaceIfVersion')
        || (kind === 'merge' && target.includes('/.dsh-editor/archive/'))) {
        throw Object.assign(new Error('injected persistence failure'), { code: 'FS_PERMISSION_DENIED' })
      }
      return await write(...args)
    }
    const result = await call('proposal.apply', proposal, versions)
    expect(result).toMatchObject({ ok: false, error: { code: 'internal', details: { partial: true, appliedPaths: [kind === 'split' ? 'notes/tail.txt' : 'notes/a.txt'], recoveryPath: expect.any(String) } } })
    if (result.ok) throw new Error('expected a recovery receipt')
    const recoveryPath = (result.error.details as { recoveryPath: string }).recoveryPath
    expect(await read(`${recoveryPath}/notes/a.txt`)).toBe(original)
    if (kind === 'split') {
      expect(await read('notes/a.txt')).toBe(original)
      expect(await read('notes/tail.txt')).toBe('## 转折\n后文')
    } else {
      expect(await read('notes/a.txt')).toBe(`${original}\n\n附录\n`)
      expect(await read('notes/b.txt')).toBe('附录')
      expect(await read(`${recoveryPath}/notes/b.txt`)).toBe('附录')
    }
  })
})
