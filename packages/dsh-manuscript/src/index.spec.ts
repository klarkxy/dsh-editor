import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FileSystemLike, ManuscriptHost, SandboxExecutionPolicyLike } from './host.ts'
import { resolveWorkspaceAccess, WorkspaceAuthorityError } from './host.ts'
import { dispatch, mapError } from './index.ts'
import { createDraftStore, type DraftTableLike } from './rpc/draft.ts'
import { FileOpError } from './rpc/files.ts'
import { SearchError } from './rpc/search.ts'
import { createZhihuUsageRecorder } from './rpc/zhihu-usage.ts'

function draftStoreFixture() {
  const rows = new Map<string, ReturnType<DraftTableLike['get']>>()
  return createDraftStore({
    get: (key) => rows.get(key),
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
    )).resolves.toEqual({ stored: true })
    await expect(dispatch(
      host as unknown as Context,
      'draft.get',
      { sessionId: 'session-1', path: 'notes/a.md' },
      new AbortController().signal,
      drafts,
    )).resolves.toEqual({ draft: { path: 'notes/a.md', text: '草稿', baseText: '原文', baseVersion: 'v1' } })
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

  it('serves zhihu.usage without requiring a live session', async () => {
    const { host } = fixture({ live: false })
    const rows = new Map<string, { date: string; calls: number; failures: number; results: number }>()
    const zhihuUsage = createZhihuUsageRecorder({
      get: (key) => rows.get(key),
      async put(key, value) { rows.set(key, value) },
    })
    await zhihuUsage.record({ ok: true, results: 3 })
    const value = await dispatch(
      host as unknown as Context,
      'zhihu.usage',
      { days: 2 },
      new AbortController().signal,
      undefined,
      undefined,
      zhihuUsage,
    ) as { days: Array<{ calls: number; results: number }> }
    expect(value.days).toHaveLength(2)
    expect(value.days[1]).toMatchObject({ calls: 1, results: 3 })
    await expect(dispatch(
      host as unknown as Context,
      'zhihu.usage',
      { days: 2 },
      new AbortController().signal,
    )).rejects.toThrow('manuscript zhihu usage storage is unavailable')
  })
})
