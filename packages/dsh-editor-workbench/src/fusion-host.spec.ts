import type { Context } from '@deepseek-ai/cordis'
import type { FusionActor, FusionCandidate } from '@klarkxy/dsh-fusion/contracts'
import type { FusionApplicationAccess } from '@klarkxy/dsh-fusion/host-contracts'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withWorkspaceWrite, type FileSystemLike, type FsTargetLike, type FsWriteIntentLike, type SandboxExecutionPolicyLike } from 'dsh-manuscript/host-api'
import { createFusionWritingHost } from './fusion-host.ts'

// Real filesystem-backed provider with deterministic version checks and the same
// provider contract as production. No live model or second draft store is involved.

/** realpath that also canonicalizes the nearest existing ancestor of a missing path. */
async function canonicalizeExisting(absolute: string): Promise<string> {
  try {
    return await fs.realpath(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(absolute)
    if (parent === absolute) return absolute
    return path.join(await canonicalizeExisting(parent), path.basename(absolute))
  }
}

class TestFs implements FileSystemLike {
  writes: Array<{ text: string; intent?: FsWriteIntentLike; policy?: SandboxExecutionPolicyLike }> = []
  constructor(readonly root: string) {}
  async resolve(value: string, opts?: { cwd?: string }): Promise<FsTargetLike> {
    const absolute = path.resolve(opts?.cwd ?? this.root, value)
    const canonical = await canonicalizeExisting(absolute)
    return { targetKey: canonical, displayPath: canonical }
  }
  contains(parent: FsTargetLike, child: FsTargetLike) {
    const relative = path.relative(parent.targetKey, child.targetKey)
    return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
  async stat(target: FsTargetLike) {
    try {
      const stat = await fs.stat(target.targetKey, { bigint: true })
      return { type: stat.isDirectory() ? 'directory' as const : stat.isFile() ? 'file' as const : 'other' as const,
        version: `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`, size: Number(stat.size) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
  async lstat(value: string, opts?: { cwd?: string }) {
    try {
      const stat = await fs.lstat(path.resolve(opts?.cwd ?? this.root, value), { bigint: true })
      return { type: stat.isSymbolicLink() ? 'symlink' as const : stat.isDirectory() ? 'directory' as const : stat.isFile() ? 'file' as const : 'other' as const,
        version: `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`, size: Number(stat.size) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
  async readText(target: FsTargetLike) { return fs.readFile(target.targetKey, 'utf8') }
  async listDir(target: FsTargetLike) {
    return (await fs.readdir(target.targetKey, { withFileTypes: true })).map(entry => ({ name: entry.name,
      type: entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : 'other' as const,
      target: { targetKey: path.join(target.targetKey, entry.name), displayPath: path.join(target.targetKey, entry.name) },
    }))
  }
  async writeText(target: FsTargetLike, text: string, intent?: FsWriteIntentLike, signal?: AbortSignal, policy?: SandboxExecutionPolicyLike) {
    signal?.throwIfAborted()
    if (policy?.mode === 'read-only') throw Object.assign(new Error('denied'), { code: 'FS_SANDBOX_DENIED' })
    const current = await this.stat(target)
    if (intent?.kind === 'createIfAbsent' && current) throw Object.assign(new Error('exists'), { code: 'FS_NOT_OBSERVED' })
    if (intent?.kind === 'replaceIfVersion' && current?.version !== intent.version) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    const before = current ? await this.readText(target) : null
    await fs.writeFile(target.targetKey, text, { encoding: 'utf8', flag: intent?.kind === 'createIfAbsent' ? 'wx' : 'w' })
    this.writes.push({ text, intent, policy })
    return { operation: before === null ? 'create' as const : 'update' as const, version: (await this.stat(target))!.version, before, after: text }
  }
}

let root: string
let provider: TestFs
let actor: FusionActor
let controller: AbortController
let session: { id: string; header: { cwd: string; agentPreset: string; parentSession?: string } }
let policy: SandboxExecutionPolicyLike
let workspace: { path: string; sessionIds: string[] }
let drafts: Array<{ window: string; path: string; dirty: boolean }>
let context: Context
let draftService: { hasUnsaved: (workspace: string, relative: string) => boolean } | undefined
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-fusion-host-')))
  provider = new TestFs(root)
  actor = { sessionId: 'lead', project: root }
  controller = new AbortController()
  session = { id: 'lead', header: { cwd: root, agentPreset: 'dsh-editor-writing' } }
  policy = { mode: 'workspace-write', workspaceRoot: root, sessionId: 'lead' }
  workspace = { path: root, sessionIds: ['lead'] }
  drafts = []
  draftService = { hasUnsaved: (project, relative) => project === root && drafts.some(draft => draft.path.toLowerCase() === relative.toLowerCase() && draft.dirty) }
  context = { fs: provider, sessions: { get: (id: string) => id === session.id ? session : undefined },
    workspaceRegistry: { resolveByPath: async () => workspace }, sandboxPolicy: { resolve: () => policy },
    get: (key: string) => key === 'manuscriptDrafts' ? draftService : undefined,
  } as unknown as Context
  await fs.writeFile(path.join(root, 'chapter.txt'), '开头\n原文\n结尾')
  await fs.writeFile(path.join(root, 'basis.md'), '依据')
})
afterEach(async () => {
  if (path.dirname(root) !== await fs.realpath(os.tmpdir()) || !path.basename(root).startsWith('dsh-fusion-host-')) throw new Error('unsafe fixture cleanup')
  await fs.rm(root, { recursive: true, force: true })
})
const candidate = (text = '新的原文'): FusionCandidate => ({ id: 'candidate', revision: 1, taskRevision: 1, hash: 'backend-verified', text, report: '', createdAt: 1 })
async function version(relative = 'chapter.txt') { return (await provider.stat(await provider.resolve(relative)))!.version }
async function editInput() { return { kind: 'edit', path: 'chapter.txt', oldText: '原文', targetVersion: await version(), basis: [{ path: 'basis.md', version: await version('basis.md') }] } }
function host() { return createFusionWritingHost(context) }

describe('Fusion Editor writing authority', () => {
  it('uses real presets and an explicit read/research-only Writer surface', () => {
    const service = host()
    expect(service.matches({ agentPreset: 'dsh-editor-article' })).toBe(true)
    expect(service.matches({ agentPreset: 'standard' })).toBe(false)
    expect(service.writerTools).toEqual(expect.arrayContaining(['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'skill', 'novel_knowledge']))
    for (const name of ['writing_propose', 'write', 'edit', 'bash', 'pwsh', 'novel_memory_update', 'author_observe', 'subagent', 'novel_scratch_write']) expect(service.writerTools).not.toContain(name)
    for (const name of ['read_image', 'web_search', 'web_fetch', 'novel_memory_update', 'novel_index_write', 'novel_scratch_write', 'author_observe', 'ask_user_question']) expect(service.allowLeadTool(name, {})).toBe(true)
    for (const name of ['write', 'bash', 'unknown_write']) expect(service.allowLeadTool(name, {})).toBe(false)
    for (const name of ['writing_propose', 'novel_propose']) {
      for (const kind of ['create', 'edit']) expect(service.allowLeadTool(name, { kind, path: '大纲/plan.md' })).toBe(false)
      for (const kind of ['split', 'merge', 'renames']) expect(service.allowLeadTool(name, { kind })).toBe(true)
    }
  })
  it.each(['forged project', 'claimed child', 'hidden child', 'wrong preset', 'detached session', 'wrong registry root', 'wrong policy root', 'wrong policy session'])( 'rejects %s', async scenario => {
    const input = await editInput()
    if (scenario === 'forged project') actor.project = path.dirname(root)
    if (scenario === 'claimed child') actor.parentSessionId = 'another'
    if (scenario === 'hidden child') session.header.parentSession = 'another'
    if (scenario === 'wrong preset') session.header.agentPreset = 'standard'
    if (scenario === 'detached session') workspace.sessionIds = []
    if (scenario === 'wrong registry root') workspace.path = path.dirname(root)
    if (scenario === 'wrong policy root') policy.workspaceRoot = path.dirname(root)
    if (scenario === 'wrong policy session') policy.sessionId = 'another'
    await expect(host().capture(actor, input, controller.signal)).rejects.toThrow()
    expect(provider.writes).toHaveLength(0)
  })
  it('rejects a root session that changes during asynchronous authority resolution', async () => {
    const original = provider.resolve.bind(provider)
    let roots = 0
    provider.resolve = async (value, opts) => {
      const target = await original(value, opts)
      if (value === '.' && ++roots === 3) session.header.parentSession = 'late-parent'
      return target
    }
    await expect(host().capture(actor, await editInput(), controller.signal)).rejects.toThrow()
    expect(provider.writes).toHaveLength(0)
  })
  it('preserves the original target and basis versions rather than refreshing stale baselines', async () => {
    const service = host()
    const input = await editInput()
    const target = await service.capture(actor, input, controller.signal)
    expect(target).toEqual({ domain: 'dsh-editor.writing', data: input })
    await fs.writeFile(path.join(root, 'chapter.txt'), 'changed')
    await expect(service.capture(actor, input, controller.signal)).rejects.toMatchObject({ code: 'STALE' })
    await expect(service.transact(actor, target, candidate(), controller.signal, access => access.prepare())).rejects.toMatchObject({ code: 'STALE' })
    expect(provider.writes).toHaveLength(0)
  })
  it('rejects stale basis at capture and again between preview and commit', async () => {
    const service = host()
    const input = await editInput()
    const target = await service.capture(actor, input, controller.signal)
    await service.transact(actor, target, candidate(), controller.signal, async access => {
      const preview = await access.prepare()
      await fs.writeFile(path.join(root, 'basis.md'), 'changed basis')
      await expect(access.commit(preview.version)).rejects.toThrow()
    })
    await expect(service.capture(actor, input, controller.signal)).rejects.toMatchObject({ code: 'STALE' })
    expect(provider.writes).toHaveLength(0)
  })
  it.each(['chapter.txt', 'basis.md'])('blocks unsaved %s in another window, including late drafts', async relative => {
    const service = host()
    const target = await service.capture(actor, await editInput(), controller.signal)
    await service.transact(actor, target, candidate(), controller.signal, async access => {
      const preview = await access.prepare()
      drafts.push({ window: 'another-window', path: relative, dirty: true })
      await expect(access.commit(preview.version)).rejects.toThrow('unsaved author draft')
    })
    expect(provider.writes).toHaveLength(0)
    drafts[0]!.dirty = false
    await expect(service.transact(actor, target, candidate(), controller.signal, async access => access.commit((await access.prepare()).version))).resolves.toMatchObject({ path: 'chapter.txt' })
  })
  it('fails closed when shared draft protection is unavailable', async () => {
    draftService = undefined
    await expect(host().capture(actor, await editInput(), controller.signal)).rejects.toThrow('Draft protection')
  })
  it('previews the full file and writes exact replacement bytes, including dollar substitutions', async () => {
    const service = host()
    const target = await service.capture(actor, await editInput(), controller.signal)
    const text = '$&\n$1\r\n精确候选'
    await service.transact(actor, target, candidate(text), controller.signal, async access => {
      const preview = await access.prepare()
      expect(preview).toMatchObject({ before: '开头\n原文\n结尾', after: `开头\n${text}\n结尾` })
      await access.commit(preview.version)
    })
    expect(await fs.readFile(path.join(root, 'chapter.txt'), 'utf8')).toBe(`开头\n${text}\n结尾`)
    expect(provider.writes[0]).toMatchObject({ intent: { kind: 'replaceIfVersion', version: target.data.targetVersion }, policy })
  })
  it('creates .md and .txt exclusively, including missing visible parent directories', async () => {
    for (const relative of ['new.md', 'nested/new.txt']) {
      const service = host()
      const target = await service.capture(actor, { kind: 'create', path: relative }, controller.signal)
      await service.transact(actor, target, candidate('新文件\r\n'), controller.signal, async access => {
        expect(await access.inspect()).toBeUndefined()
        expect(await access.prepare()).toEqual({ path: relative, before: '', after: '新文件\r\n', version: '' })
        await access.commit('')
      })
      expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe('新文件\r\n')
      await expect(service.capture(actor, { kind: 'create', path: relative }, controller.signal)).rejects.toThrow()
    }
    expect(provider.writes.every(write => write.intent?.kind === 'createIfAbsent')).toBe(true)
  })
  it('never fills existing empty files through create, and uses versioned empty edit', async () => {
    await fs.writeFile(path.join(root, 'empty.md'), '')
    const service = host()
    await expect(service.capture(actor, { kind: 'create', path: 'empty.md' }, controller.signal)).rejects.toThrow()
    const target = await service.capture(actor, { kind: 'edit', path: 'empty.md', oldText: '', targetVersion: await version('empty.md') }, controller.signal)
    await service.transact(actor, target, candidate('正文'), controller.signal, async access => access.commit((await access.prepare()).version))
    expect(await fs.readFile(path.join(root, 'empty.md'), 'utf8')).toBe('正文')
  })
  it.each(['../outside.md', 'a/../outside.md', '.dsh-editor/x.md', 'dist/x.txt', 'a.json', 'C:/outside.md'])('rejects invalid V2 path %s', async relative => {
    await expect(host().capture(actor, { kind: 'create', path: relative }, controller.signal)).rejects.toThrow()
    expect(provider.writes).toHaveLength(0)
  })
  it('rejects symlink/junction ancestors and canonical provider escapes', async () => {
    await fs.mkdir(path.join(root, 'real'))
    await fs.writeFile(path.join(root, 'real', 'file.md'), 'original')
    await fs.symlink(path.join(root, 'real'), path.join(root, 'link'), 'junction')
    await expect(host().capture(actor, { kind: 'create', path: 'link/new.md' }, controller.signal)).rejects.toThrow()
    const original = provider.resolve.bind(provider)
    provider.resolve = async (value, opts) => value === 'evil.md' ? { targetKey: path.join(path.dirname(root), 'evil.md'), displayPath: 'evil' } : original(value, opts)
    await expect(host().capture(actor, { kind: 'create', path: 'evil.md' }, controller.signal)).rejects.toThrow()
    expect(provider.writes).toHaveLength(0)
  })
  it('cancels after preview and while waiting for the existing workspace write lock', async () => {
    const service = host()
    const target = await service.capture(actor, await editInput(), controller.signal)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const hold = withWorkspaceWrite((await provider.resolve('.')).targetKey, () => held)
    const pending = service.transact(actor, target, candidate(), controller.signal, async access => access.commit((await access.prepare()).version))
    const rejected = expect(pending).rejects.toThrow()
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    release()
    await hold
    await rejected
    expect(provider.writes).toHaveLength(0)
  })
  it('rechecks cancellation, draft and basis after file helper path resolution', async () => {
    for (const cause of ['cancel', 'draft', 'basis']) {
      controller = new AbortController()
      drafts = []
      await fs.writeFile(path.join(root, 'basis.md'), `basis ${cause}`)
      const service = host()
      const target = await service.capture(actor, await editInput(), controller.signal)
      const original = provider.resolve.bind(provider)
      let targetResolves = 0
      provider.resolve = async (value, opts) => {
        const resolved = await original(value, opts)
        // First is commit's prepare; second is writeTextFile's own resolution.
        if (value === 'chapter.txt' && ++targetResolves === 2) {
          if (cause === 'cancel') controller.abort()
          if (cause === 'draft') drafts.push({ window: 'late-window', path: 'chapter.txt', dirty: true })
          if (cause === 'basis') await fs.writeFile(path.join(root, 'basis.md'), 'late basis')
        }
        return resolved
      }
      await expect(service.transact(actor, target, candidate(), controller.signal, access => access.commit(String(target.data.targetVersion)))).rejects.toThrow()
      provider.resolve = original
    }
    expect(provider.writes).toHaveLength(0)
  })
  it('revalidates live workspace, parent and read-only policy after preview', async () => {
    for (const cause of ['cwd', 'parent', 'policy']) {
      session.header.cwd = root; delete session.header.parentSession; policy.mode = 'workspace-write'
      const service = host()
      const target = await service.capture(actor, await editInput(), controller.signal)
      await service.transact(actor, target, candidate(), controller.signal, async access => {
        const preview = await access.prepare()
        if (cause === 'cwd') session.header.cwd = path.dirname(root)
        if (cause === 'parent') session.header.parentSession = 'forged'
        if (cause === 'policy') policy.mode = 'read-only'
        await expect(access.commit(preview.version)).rejects.toThrow()
      })
    }
    expect(provider.writes).toHaveLength(0)
  })
  it('reads a persisted intent result without requiring old target/basis versions', async () => {
    const service = host()
    const target = await service.capture(actor, await editInput(), controller.signal)
    await service.transact(actor, target, candidate(), controller.signal, async access => access.commit((await access.prepare()).version))
    await fs.writeFile(path.join(root, 'basis.md'), 'later basis')
    drafts.push({ window: 'other', path: 'chapter.txt', dirty: true })
    const current = await host().transact(actor, target, candidate(), controller.signal, access => access.inspect())
    expect(current?.text).toBe('开头\n新的原文\n结尾')
  })
  it('does not append twice, including concurrent adoption attempts and escaped access', async () => {
    const service = host()
    const target = await service.capture(actor, await editInput(), controller.signal)
    let escaped!: FusionApplicationAccess
    const outcomes = await Promise.allSettled([1, 2].map(() => service.transact(actor, target, candidate('原文\n追加'), controller.signal, async access => {
      escaped = access
      const preview = await access.prepare()
      const applied = await access.commit(preview.version)
      await expect(access.commit(preview.version)).rejects.toThrow()
      return applied
    })))
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
    await expect(escaped.commit(String(target.data.targetVersion))).rejects.toThrow()
    expect(provider.writes).toHaveLength(1)
    expect(await fs.readFile(path.join(root, 'chapter.txt'), 'utf8')).toBe('开头\n原文\n追加\n结尾')
  })
  it('refuses mismatched preview versions and ambiguous original text', async () => {
    const service = host()
    const target = await service.capture(actor, await editInput(), controller.signal)
    await expect(service.transact(actor, target, candidate(), controller.signal, access => access.commit('forged'))).rejects.toMatchObject({ code: 'STALE' })
    await fs.writeFile(path.join(root, 'chapter.txt'), '哈哈哈')
    await expect(service.capture(actor, { kind: 'edit', path: 'chapter.txt', oldText: '哈哈', targetVersion: await version() }, controller.signal)).rejects.toMatchObject({ code: 'AMBIGUOUS' })
    expect(provider.writes).toHaveLength(0)
  })
})
