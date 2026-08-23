import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FileSystemLike, ManuscriptHost, SandboxExecutionPolicyLike } from './host.ts'
import { resolveWorkspaceAccess, WorkspaceAuthorityError } from './host.ts'
import { dispatch, mapError } from './index.ts'

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
    expect(mapError(new WorkspaceAuthorityError('missing', 'SESSION_NOT_FOUND')).error.code).toBe('session-not-found')
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

  it('does not accept provider or model guesses from the RPC payload', async () => {
    const { host } = fixture()
    await expect(dispatch(
      host as unknown as Context,
      'fim.complete',
      { sessionId: 'session-1', provider: 'forged', model: 'forged', prefix: '', suffix: '' },
      new AbortController().signal,
    )).resolves.toEqual({ text: '', route: 'dsh-llm' })
  })
})
