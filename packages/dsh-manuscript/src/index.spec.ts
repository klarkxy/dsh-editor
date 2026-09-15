import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FileSystemLike, ManuscriptHost, SandboxExecutionPolicyLike } from './host.ts'
import { resolveWorkspaceAccess, WorkspaceAuthorityError } from './host.ts'
import { dispatch, mapError } from './index.ts'
import { createDraftStore, type DraftTableLike } from './rpc/draft.ts'
import { FileOpError } from './rpc/files.ts'
import { PathConfineError } from './rpc/paths.ts'
import { parseProposal } from './rpc/proposal.ts'
import { SearchError } from './rpc/search.ts'
import { createMemoryContext } from './rpc/test-helpers.ts'

function draftStoreFixture() {
  const rows = new Map<string, NonNullable<ReturnType<DraftTableLike['get']>>>()
  return createDraftStore({
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
    async put(key, value) { rows.set(key, value) },
    async delete(key) { return rows.delete(key) },
  })
}

function fixture(options: { live?: boolean; member?: boolean; mode?: SandboxExecutionPolicyLike['mode'] } = {}) {
  const canonical = '/canonical/workspace'
  const resolveCalls: Array<{ path: string; cwd?: string }> = []
  const writes = vi.fn<FileSystemLike['writeText']>()
  const fs: FileSystemLike = {
    async resolve(path, opts) {
      resolveCalls.push({ path, cwd: opts?.cwd })
      const targetKey = path === '.' ? canonical : `${opts?.cwd}/${path}`.replace('/./', '/')
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
    },
    async stat(target) {
      if (target.targetKey === canonical) return { type: 'directory', version: 'root' }
      if (target.targetKey === `${canonical}/notes`) return { type: 'directory', version: 'notes' }
      return undefined
    },
    async lstat(path) {
      if (path === '.' || path === 'notes') return { type: 'directory', version: 'dir' }
      return undefined
    },
    async readText() { throw new Error('not used') },
    async listDir() { return [] },
    writeText: writes,
  }
  const session = {
    id: 'session-1',
    header: { cwd: '/header/workspace' },
    requestHeader: () => undefined,
  }
  const host = {
    sessions: { get: () => options.live === false ? undefined : session },
    workspaceRegistry: {
      resolveByPath: vi.fn(async () => ({ path: canonical, sessionIds: options.member === false ? [] : ['session-1'] })),
    },
    sandboxPolicy: {
      resolve: vi.fn(() => ({ mode: options.mode ?? 'workspace-write', workspaceRoot: canonical, sessionId: 'session-1' })),
    },
    fs,
    connection: { rpc: { call: vi.fn(), handle: vi.fn() } },
  } as unknown as ManuscriptHost
  return { host, session, canonical, resolveCalls, writes }
}

describe('manuscript Host workspace authority', () => {
  it('derives the workspace from the immutable live-session header and ignores a forged cwd', async () => {
    const { host, canonical, resolveCalls } = fixture()
    await expect(dispatch(
      host as unknown as Context,
      'tree.list',
      { sessionId: 'session-1', cwd: '/forged/outside', path: 'notes' },
      new AbortController().signal,
    )).resolves.toEqual({ entries: [] })
    expect(host.workspaceRegistry.resolveByPath).toHaveBeenCalledWith('/header/workspace')
    expect(resolveCalls.every((call) => call.cwd === canonical)).toBe(true)
  })

  it('rejects an unknown or non-live session', async () => {
    const { host } = fixture({ live: false })
    await expect(resolveWorkspaceAccess(host, 'missing')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
    expect(mapError(new WorkspaceAuthorityError('missing', 'SESSION_NOT_FOUND', { sessionId: 'missing' }))).toEqual({
      ok: false,
      error: { code: 'session-not-found', message: 'missing', details: { sessionId: 'missing' } },
    })
  })

  it('maps manuscript failures into the closed DSH Host error contract', () => {
    expect(mapError(new WorkspaceAuthorityError('detached', 'WORKSPACE_MISMATCH', {
      sessionId: 'session-1',
      workspacePath: '/canonical/workspace',
    }))).toEqual({
      ok: false,
      error: {
        code: 'workspace-attach-failed',
        message: 'detached',
        details: { sessionId: 'session-1', workspaceId: '/canonical/workspace' },
      },
    })
    expect(mapError(new FileOpError('missing', 'NOT_FOUND'))).toEqual({
      ok: false,
      error: { code: 'directory-unreadable', message: 'missing', details: { path: '' } },
    })
    expect(mapError(new FileOpError('stale', 'STALE'))).toMatchObject({
      error: { code: 'bad-request', details: { issues: [{ code: 'custom', path: [], message: 'stale' }] } },
    })
    expect(mapError(new Error('boom'))).toEqual({
      ok: false,
      error: { code: 'internal', message: 'boom', details: {} },
    })
    expect(mapError(new SearchError('bad query', 'BAD_QUERY'))).toMatchObject({
      error: { code: 'bad-request', details: { issues: [{ message: 'bad query' }] } },
    })
  })

  it('rejects a session absent from the canonical workspace account', async () => {
    const { host } = fixture({ member: false })
    await expect(resolveWorkspaceAccess(host, 'session-1')).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
  })

  it('fails a write closed under read-only without calling ctx.fs.writeText', async () => {
    const { host, writes } = fixture({ mode: 'read-only' })
    await expect(dispatch(
      host as unknown as Context,
      'file.create',
      { sessionId: 'session-1', path: 'notes/a.md', text: 'no' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'DENIED' })
    expect(writes).not.toHaveBeenCalled()
  })

  it('does not expose desktop-only workspace lifecycle endpoints', async () => {
    const { host } = fixture()
    await expect(dispatch(
      host as unknown as Context,
      'file.rename',
      { sessionId: 'session-1', path: 'notes/a.md', newName: 'b.md' },
      new AbortController().signal,
    )).rejects.toThrow('unknown endpoint file.rename')
    await expect(dispatch(
      host as unknown as Context,
      'structure.groupCreate',
      { sessionId: 'session-1', path: '正文/第一卷' },
      new AbortController().signal,
    )).rejects.toThrow('unknown endpoint structure.groupCreate')
    await expect(dispatch(
      host as unknown as Context,
      'file.moveManuscript',
      { sessionId: 'session-1', path: '正文/001.md', targetDirectory: '正文/第一卷' },
      new AbortController().signal,
    )).rejects.toThrow('unknown endpoint file.moveManuscript')
    await expect(dispatch(
      host as unknown as Context,
      'entry.copy',
      { sessionId: 'session-1', path: '正文/001.md', targetDir: '大纲' },
      new AbortController().signal,
    )).rejects.toThrow('unknown endpoint entry.copy')
    await expect(dispatch(
      host as unknown as Context,
      'entry.move',
      { sessionId: 'session-1', path: '正文/001.md', targetDir: '大纲' },
      new AbortController().signal,
    )).rejects.toThrow('unknown endpoint entry.move')
    await expect(dispatch(
      host as unknown as Context,
      'entry.delete',
      { sessionId: 'session-1', path: '正文/001.md' },
      new AbortController().signal,
    )).rejects.toThrow('unknown endpoint entry.delete')
    await expect(dispatch(
      host as unknown as Context,
      'entry.rename',
      { sessionId: 'session-1', path: '正文/001.md', name: '002.md' },
      new AbortController().signal,
    )).rejects.toThrow('unknown endpoint entry.rename')
  })

  it('does not accept provider or model guesses from the RPC payload', async () => {
    const { host } = fixture()
    await expect(dispatch(
      host as unknown as Context,
      'fim.complete',
      { sessionId: 'session-1', provider: 'forged', model: 'forged', prefix: '', suffix: '' },
      new AbortController().signal,
    )).resolves.toEqual({ text: '', route: 'dsh-llm' })
  })

  it('keeps drafts behind the same live-session workspace authority', async () => {
    const { host } = fixture()
    const drafts = draftStoreFixture()
    await expect(dispatch(
      host as unknown as Context,
      'draft.put',
      { sessionId: 'session-1', cwd: '/forged/outside', path: 'notes/a.md', text: '草稿', baseText: '原文', baseVersion: 'v1' },
      new AbortController().signal,
      drafts,
    )).resolves.toMatchObject({ stored: true, revision: expect.any(String) })
    await expect(dispatch(
      host as unknown as Context,
      'draft.get',
      { sessionId: 'session-1', path: 'notes/a.md' },
      new AbortController().signal,
      drafts,
    )).resolves.toMatchObject({ draft: { path: 'notes/a.md', text: '草稿', baseText: '原文', baseVersion: 'v1', revision: expect.any(String) } })
  })

  it('keeps search behind the live-session workspace authority', async () => {
    const { host, canonical, resolveCalls } = fixture()
    await expect(dispatch(
      host as unknown as Context,
      'search.text',
      { sessionId: 'session-1', cwd: '/forged/outside', query: 'needle', scope: 'project' },
      new AbortController().signal,
    )).resolves.toMatchObject({ results: [], scannedFiles: 0 })
    expect(resolveCalls.every((call) => call.cwd === canonical)).toBe(true)
  })

  it('fences search.text directory to the live workspace and fails closed on escape or a missing folder', async () => {
    const { host, canonical, resolveCalls } = fixture()
    await expect(dispatch(
      host as unknown as Context,
      'search.text',
      { sessionId: 'session-1', query: 'needle', directory: 'notes' },
      new AbortController().signal,
    )).resolves.toMatchObject({ results: [], scannedFiles: 0 })
    await expect(dispatch(
      host as unknown as Context,
      'search.text',
      { sessionId: 'session-1', query: 'needle', directory: '../secret' },
      new AbortController().signal,
    )).rejects.toBeInstanceOf(PathConfineError)
    await expect(dispatch(
      host as unknown as Context,
      'search.text',
      { sessionId: 'session-1', query: 'needle', directory: 'missing' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(resolveCalls.every((call) => call.cwd === canonical)).toBe(true)
  })
})

describe('manuscript search RPC directory scope', () => {
  it('finds a selected-directory match through dispatch after a root file fills the result cap', async () => {
    const { host } = proposalHost({
      'aaa.md': Array.from({ length: 200 }, () => 'needle').join('\n'),
      'docs/target.md': 'needle in docs',
    })
    const signal = new AbortController().signal
    const project = await dispatch(
      host as unknown as Context,
      'search.text',
      { sessionId: 'session-1', query: 'needle', scope: 'project' },
      signal,
    ) as { truncated: boolean; results: { path: string }[] }
    expect(project.truncated).toBe(true)
    expect(project.results.every((hit) => hit.path === 'aaa.md')).toBe(true)
    const scoped = await dispatch(
      host as unknown as Context,
      'search.text',
      { sessionId: 'session-1', query: 'needle', directory: 'docs' },
      signal,
    ) as { truncated: boolean; results: { path: string }[] }
    expect(scoped.truncated).toBe(false)
    expect(scoped.results.map((hit) => hit.path)).toEqual(['docs/target.md'])
  })
})

function proposalHost(files: Record<string, string>) {
  const memory = createMemoryContext(files)
  const host = {
    sessions: {
      get: () => ({
        id: 'session-1',
        header: { cwd: '/header/workspace' },
        requestHeader: () => undefined,
      }),
    },
    workspaceRegistry: {
      resolveByPath: vi.fn(async () => ({ path: '/workspace', sessionIds: ['session-1'] })),
    },
    sandboxPolicy: {
      resolve: vi.fn(() => ({ mode: 'workspace-write' as const, workspaceRoot: '/workspace', sessionId: 'session-1' })),
    },
    fs: memory.fs,
    connection: { rpc: { call: vi.fn(), handle: vi.fn() } },
  } as unknown as ManuscriptHost
  return { host, memory }
}

function flatV2Edit(extra: Record<string, unknown> = {}) {
  return {
    marker: 'dsh-editor.proposal',
    version: 2,
    kind: 'edit',
    path: '正文/001.md',
    oldText: '旧句。',
    newText: '新句。',
    summary: '替换一句',
    targetVersion: 'initial-正文/001.md',
    ...extra,
  }
}

describe('manuscript proposal RPC envelope', () => {
  it('keeps V2 parseProposal strict about sessionId and expectedVersion', () => {
    expect(() => parseProposal({ ...flatV2Edit(), sessionId: 'session-1' })).toThrow(/unsupported/)
    expect(() => parseProposal({ ...flatV2Edit(), expectedVersion: 'v1' })).toThrow(/unsupported/)
  })

  it('accepts a flat V2 edit prepare/apply envelope with sessionId, expectedVersion, and basis', async () => {
    const { host } = proposalHost({ '正文/001.md': '# 第一章\n旧句。\n', '大纲/总纲.md': '来源纲要' })
    const signal = new AbortController().signal
    const basisSource = await dispatch(
      host as unknown as Context,
      'file.read',
      { sessionId: 'session-1', path: '大纲/总纲.md' },
      signal,
    ) as { version: string }
    const envelope = {
      ...flatV2Edit(),
      sessionId: 'session-1',
      basis: [{ path: '大纲/总纲.md', version: basisSource.version, label: '总纲' }],
    }
    const prepared = await dispatch(host as unknown as Context, 'proposal.prepare', envelope, signal) as {
      applicable: boolean
      version: string
      before: string
      after: string
    }
    expect(prepared).toMatchObject({ applicable: true, before: '旧句。', after: '新句。', kind: 'edit' })
    await expect(dispatch(
      host as unknown as Context,
      'proposal.apply',
      { ...envelope, expectedVersion: prepared.version },
      signal,
    )).resolves.toMatchObject({ operation: 'edit', path: '正文/001.md' })
    await expect(dispatch(
      host as unknown as Context,
      'file.read',
      { sessionId: 'session-1', path: '正文/001.md' },
      signal,
    )).resolves.toMatchObject({ text: '# 第一章\n新句。\n' })
  })

  it('still fail-closes extra proposal fields on prepare and apply', async () => {
    const { host } = proposalHost({ '正文/001.md': '# 第一章\n旧句。\n' })
    const signal = new AbortController().signal
    const extra = { ...flatV2Edit(), sessionId: 'session-1', extra: true }
    await expect(dispatch(host as unknown as Context, 'proposal.prepare', extra, signal))
      .rejects.toMatchObject({ code: 'INVALID', message: expect.stringMatching(/unsupported/) })
    await expect(dispatch(
      host as unknown as Context,
      'proposal.apply',
      { ...extra, expectedVersion: 'initial-正文/001.md' },
      signal,
    )).rejects.toMatchObject({ code: 'INVALID', message: expect.stringMatching(/unsupported/) })
    await expect(dispatch(
      host as unknown as Context,
      'file.read',
      { sessionId: 'session-1', path: '正文/001.md' },
      signal,
    )).resolves.toMatchObject({ text: '# 第一章\n旧句。\n' })
  })

  it('keeps V1 edit prepare/apply working with the same RPC envelope', async () => {
    const { host } = proposalHost({ '正文/001.md': '# 第一章\n旧句。\n' })
    const signal = new AbortController().signal
    const envelope = {
      sessionId: 'session-1',
      kind: 'edit',
      path: '正文/001.md',
      oldText: '旧句。',
      newText: '新句。',
      summary: '替换一句',
    }
    const prepared = await dispatch(host as unknown as Context, 'proposal.prepare', envelope, signal) as {
      version: string
    }
    expect(prepared).toMatchObject({ applicable: true, before: '旧句。', after: '新句。' })
    await expect(dispatch(
      host as unknown as Context,
      'proposal.apply',
      { ...envelope, expectedVersion: prepared.version },
      signal,
    )).resolves.toMatchObject({ operation: 'edit', path: '正文/001.md' })
  })
})
