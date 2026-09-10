import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTextFile, writeTextFile, withWorkspaceWrite, type FileSystemLike, type FsDirEntryLike, type FsInfoLike, type FsPathInfoLike, type FsTargetLike, type FsWriteIntentLike, type SandboxExecutionPolicyLike } from 'dsh-manuscript/host-api'
import { updateMemory, applyMemoryChange, undoMemoryChange, listMemoryChanges, getMemoryChange, type MemoryAccess } from './memory.ts'
import type { MemoryUpdate } from './memory-contracts.ts'
let root = ''
class NodeFileSystem implements FileSystemLike {
  constructor(private readonly root: string) {}

  async resolve(value: string, opts?: { cwd?: string }): Promise<FsTargetLike> {
    const base = opts?.cwd ?? this.root
    return { targetKey: path.resolve(base, value), displayPath: path.resolve(base, value) }
  }

  contains(parent: FsTargetLike, child: FsTargetLike): boolean {
    const relative = path.relative(parent.targetKey, child.targetKey)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  async stat(target: FsTargetLike): Promise<FsInfoLike | undefined> {
    try {
      const value = await fs.stat(target.targetKey)
      return { type: value.isDirectory() ? 'directory' : value.isFile() ? 'file' : 'other', version: `${value.mtimeMs}:${value.size}`, size: value.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async lstat(value: string, opts?: { cwd?: string }): Promise<FsPathInfoLike | undefined> {
    try {
      const target = path.resolve(opts?.cwd ?? this.root, value)
      const state = await fs.lstat(target)
      return { type: state.isSymbolicLink() ? 'symlink' : state.isDirectory() ? 'directory' : state.isFile() ? 'file' : 'other', version: `${state.mtimeMs}:${state.size}`, size: state.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async readText(target: FsTargetLike): Promise<string> { return await fs.readFile(target.targetKey, 'utf8') }

  async listDir(target: FsTargetLike): Promise<FsDirEntryLike[]> {
    const entries = await fs.readdir(target.targetKey, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
    }))
  }

  async writeText(target: FsTargetLike, content: string, expected?: FsWriteIntentLike, _signal?: AbortSignal, _policy?: SandboxExecutionPolicyLike): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const before = await this.readText(target).catch(() => null)
    const current = await this.stat(target)
    if (expected?.kind === 'createIfAbsent' && current) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (expected?.kind === 'replaceIfVersion' && current?.version !== expected.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    await fs.writeFile(target.targetKey, content, 'utf8')
    return { operation: before === null ? 'create' : 'update', version: (await this.stat(target))!.version, before, after: content }
  }
}


beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-memory-')); await fs.mkdir(path.join(root, '正文')); await fs.writeFile(path.join(root, '正文', '001.md'), '林舟出生于雾港。'); await fs.writeFile(path.join(root, 'AGENTS.md'), '# 项目规则\n') })
afterEach(async () => { if (!path.basename(root).startsWith('dsh-memory-') || path.dirname(root) !== os.tmpdir()) throw new Error('unsafe fixture cleanup'); await fs.rm(root, { recursive: true, force: true }) })
function access(options: { dirty?: boolean; readonly?: boolean } = {}): MemoryAccess {
  return { path: root, rootKey: root, mode: options.readonly ? 'read-only' : 'workspace-write', sessionId: 'author-session',
    files: { fs: new NodeFileSystem(root), cwd: root, root: { targetKey: root, displayPath: root }, policy: { mode: options.readonly ? 'read-only' : 'workspace-write', workspaceRoot: root } },
    events: [{ type: 'user/message', data: { id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text: '以后都使用第三人称。不要全知视角。' }] } }], hasDraft: () => Boolean(options.dirty) }
}
async function rule(text = '- 使用第三人称。'): Promise<MemoryUpdate> { return { path: 'AGENTS.md', operation: 'append', category: 'rule', certainty: 'explicit', summary: '记录明确长期约定', expectedVersion: (await readTextFile(access().files, 'AGENTS.md')).version, text, evidence: [{ kind: 'user', messageId: 'current', quote: '以后都使用第三人称。' }] } }
async function fact(): Promise<MemoryUpdate> { return { path: '世界书/林舟.md', operation: 'create', category: 'fact', certainty: 'explicit', summary: '记录出生地', expectedVersion: null, text: '# 林舟\n\n第一章记载林舟出生于雾港。', evidence: [{ kind: 'file', path: '正文/001.md', version: (await readTextFile(access().files, '正文/001.md')).version, quote: '林舟出生于雾港。' }] } }

describe('collaboration memory through durable guarded files', () => {
  it('appends an explicit rule once and survives a fresh access instance', async () => {
    const update = await rule(); const first = await updateMemory(access(), update); expect(first.status).toBe('applied')
    expect((await updateMemory(access(), update)).id).toBe(first.id)
    const saved = await readTextFile(access().files, 'AGENTS.md'); expect(saved.text.match(/使用第三人称/g)).toHaveLength(1)
    const record = await getMemoryChange(access(), first.id); expect(record.before).toBe('# 项目规则\n'); expect(record.update.evidence[0]).toMatchObject({ messageId: 'user-1' })
    expect((await listMemoryChanges(access())).items).toHaveLength(1)
  })
  it('creates a fact with source and archives that file when undoing after restart', async () => {
    const applied = await updateMemory(access(), await fact()); expect(applied.status).toBe('applied')
    const text = (await readTextFile(access().files, '世界书/林舟.md')).text; expect(text).toContain('[正文/001.md]'); expect(text).toContain('原文：林舟出生于雾港。')
    const undone = await undoMemoryChange(access(), applied.id); expect(undone.status).toBe('undone')
    expect(await fs.stat(path.join(root, '世界书/林舟.md')).catch(() => null)).toBeNull()
    expect((await getMemoryChange(access(), applied.id)).status).toBe('undone')
    expect(await fs.readdir(path.join(root, '.dsh-editor/archive'))).not.toHaveLength(0)
  })
  it('requires confirmation for revisions even when marked explicit', async () => {
    const update = { ...await rule(), operation: 'edit' as const, text: undefined, oldText: '# 项目规则', newText: '# 本书规则' }
    const pending = await updateMemory(access(), update); expect(pending.status).toBe('pending'); expect((await readTextFile(access().files, 'AGENTS.md')).text).toBe('# 项目规则\n')
    expect((await applyMemoryChange(access(), pending.id)).status).toBe('applied')
  })
  it('keeps uncertain new facts pending', async () => { expect((await updateMemory(access(), { ...await fact(), certainty: 'uncertain' })).status).toBe('pending'); expect(await fs.stat(path.join(root, '世界书/林舟.md')).catch(() => null)).toBeNull() })
  it('rejects fabricated, assistant, and changed source evidence', async () => {
    const a = access(); a.events = [{ type: 'user/message', data: { id: 'fake', source: { kind: 'plugin' }, content: [{ type: 'text', text: '以后都使用第三人称。' }] } }]
    await expect(updateMemory(a, await rule())).rejects.toMatchObject({ code: 'STALE' })
    const update = await fact(); await fs.writeFile(path.join(root, '正文/001.md'), '林舟出生于别处。')
    await expect(updateMemory(access(), update)).rejects.toMatchObject({ code: 'STALE' })
  })
  it('rejects stale target versions without editing a file', async () => { const update=await rule(); await fs.writeFile(path.join(root, 'AGENTS.md'), '作者后来改过。'); expect((await updateMemory(access(), update)).status).toBe('stale'); expect(await fs.readFile(path.join(root,'AGENTS.md'),'utf8')).toBe('作者后来改过。') })
  it('defers draft targets and rechecks the draft before confirmed apply', async () => {
    const pending = await updateMemory(access({ dirty: true }), await rule()); expect(pending.status).toBe('pending'); expect(pending.message).toContain('草稿')
    expect((await applyMemoryChange(access(), pending.id)).status).toBe('applied')
  })
  it('read-only operation leaves no history or changed data', async () => { await expect(updateMemory(access({ readonly: true }), await rule())).rejects.toMatchObject({ code: 'BLOCKED' }); expect(await fs.stat(path.join(root,'.dsh-editor')).catch(()=>null)).toBeNull() })
  it('restricts maintenance targets and rule evidence', async () => {
    for (const target of ['正文/001.md', '../AGENTS.md', '世界书/../AGENTS.md', '.dsh-editor/x.md', 'C:/AGENTS.md']) await expect(updateMemory(access(), { ...await rule(), path: target })).rejects.toMatchObject({ code: 'INVALID' })
    await expect(updateMemory(access(), { ...await fact(), path:'AGENTS.md', category:'rule' })).rejects.toMatchObject({ code: 'INVALID' })
  })
  it('retains later edits until the author confirms an undo proposal', async () => {
    const applied = await updateMemory(access(), await rule()); await fs.appendFile(path.join(root,'AGENTS.md'), '\n作者后来增加的内容。')
    const undo = await undoMemoryChange(access(), applied.id); expect(undo.status).toBe('pending'); expect((await readTextFile(access().files,'AGENTS.md')).text).toContain('作者后来')
    expect((await applyMemoryChange(access(),undo.id)).status).toBe('applied'); expect((await readTextFile(access().files,'AGENTS.md')).text).toBe('# 项目规则\n')
  })
  it('revalidates evidence when applying a pending proposal', async () => {
    const pending = await updateMemory(access(), { ...await fact(), certainty:'uncertain' }); await fs.writeFile(path.join(root,'正文/001.md'), '原始依据已经修改。')
    expect((await applyMemoryChange(access(),pending.id)).status).toBe('stale')
  })
  it('serializes competing updates without losing either writer silently', async () => {
    const first=await rule('- 使用第三人称。'); const second=await rule('- 不要全知视角。')
    const results=await Promise.all([withWorkspaceWrite(root,()=>updateMemory(access(),first)),withWorkspaceWrite(root,()=>updateMemory(access(),second))]); expect(results.map(r=>r.status)).toEqual(['applied','stale'])
  })
  it('never converts cancellation into a successful update', async () => { const a=access(); const controller=new AbortController(); controller.abort();a.files.signal=controller.signal; await expect(updateMemory(a,await rule())).rejects.toThrow(); expect(await fs.stat(path.join(root,'.dsh-editor')).catch(()=>null)).toBeNull() })
  it('allows a valid retry after rereading a stale target', async () => {
    const update = await rule(); await fs.appendFile(path.join(root,'AGENTS.md'),'作者修改。')
    expect((await updateMemory(access(),update)).status).toBe('stale')
    const version=(await readTextFile(access().files,'AGENTS.md')).version
    expect((await updateMemory(access(),{...update,expectedVersion:version})).status).toBe('applied')
  })
  it('recovers a committed file after the final journal write fails', async () => {
    const a=access(); const write=a.files.fs.writeText.bind(a.files.fs)
    a.files.fs.writeText=async (...args) => { if(args[0].targetKey.includes('history') && args[1].includes('"status": "applied"')) throw new Error('simulated journal failure'); return write(...args) }
    const receipt=await updateMemory(a,await rule()); expect(receipt.status).toBe('applied'); expect(receipt.message).toContain('瞬时错误')
    expect((await getMemoryChange(access(),receipt.id)).status).toBe('applied')
  })
  it('resumes archive undo when the file moved but its final receipt could not be saved', async () => {
    const original=await updateMemory(access(),await fact())
    const a=access(); const write=a.files.fs.writeText.bind(a.files.fs)
    a.files.fs.writeText=async (...args) => { if(args[0].targetKey.includes('history') && args[1].includes('"archiveOnApply": true') && args[1].includes('"status": "undone"')) throw new Error('simulated exit after archive'); return write(...args) }
    const interrupted=await undoMemoryChange(a,original.id);expect(interrupted.status).toBe('failed')
    expect(await fs.stat(path.join(root,'世界书/林舟.md')).catch(()=>null)).toBeNull()
    expect((await undoMemoryChange(access(),original.id)).status).toBe('undone')
    expect((await getMemoryChange(access(),original.id)).status).toBe('undone')
  })

})
