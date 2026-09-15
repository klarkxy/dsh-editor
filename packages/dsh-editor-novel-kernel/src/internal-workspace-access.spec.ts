import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FileSystemLike, ManuscriptHost, SessionLike } from 'dsh-manuscript/host-api'
import {
  assertSameWorkspaceRoot,
  resolveInternalWorkspaceAccess,
  sessionIdFromExec,
  withInternalWorkspaceWrite,
  WorkspaceAuthorityError,
} from './internal-workspace-access.ts'

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function fixture(label: string, options: { live?: boolean; member?: boolean } = {}) {
  const canonical = `/mem/dsh-editor-novel-kernel/${label}`
  const resolveCalls: Array<{ path: string; cwd?: string; signal?: AbortSignal }> = []
  const writes: Array<{ path: string; content: string }> = []
  const session: SessionLike = { id: 'session-1', header: { cwd: '/header/workspace' } }
  let live = options.live !== false
  const fs: FileSystemLike = {
    async resolve(path, opts) {
      throwIfAborted(opts?.signal)
      resolveCalls.push({ path, cwd: opts?.cwd, signal: opts?.signal })
      const cwd = opts?.cwd ?? canonical
      const targetKey = path === '.' ? cwd : `${cwd}/${path}`
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
    },
    async stat(target, signal) {
      throwIfAborted(signal)
      if (target.targetKey === canonical) return { type: 'directory', version: 'root' }
      return { type: 'file', version: 'v1', size: 1 }
    },
    async lstat() { return undefined },
    async readText(_target, signal) {
      throwIfAborted(signal)
      return ''
    },
    async listDir(_target, signal) {
      throwIfAborted(signal)
      return []
    },
    async writeText(target, content, _expected, signal) {
      throwIfAborted(signal)
      writes.push({ path: target.targetKey, content })
      return { operation: 'create', version: 'v1', before: null, after: content }
    },
  }
  const host = {
    sessions: { get: vi.fn((id: string) => live && id === 'session-1' ? session : undefined) },
    workspaceRegistry: {
      resolveByPath: vi.fn(async () => ({ path: canonical, sessionIds: options.member === false ? [] : ['session-1'] })),
    },
    sandboxPolicy: {
      resolve: vi.fn(() => ({ mode: 'workspace-write' as const, workspaceRoot: canonical, sessionId: 'session-1' })),
    },
    fs,
  } as unknown as ManuscriptHost
  return {
    host,
    ctx: host as unknown as Context,
    session,
    canonical,
    resolveCalls,
    writes,
    dropSession() { live = false },
  }
}

describe('internal workspace access', () => {
  it('reads the executing session id and rejects a missing session', () => {
    expect(sessionIdFromExec({ signal: new AbortController().signal, agent: { session: { id: 'session-1' } } })).toBe('session-1')
    expect(() => sessionIdFromExec({ signal: new AbortController().signal })).toThrow(WorkspaceAuthorityError)
    expect(() => sessionIdFromExec({ signal: new AbortController().signal, agent: { session: { id: '' } } })).toThrow(/session/)
  })

  it('resolves the registered workspace from the live session, ignoring a forged header on the exec object', async () => {
    const { ctx, canonical, host } = fixture('resolve-live')
    const access = await resolveInternalWorkspaceAccess(ctx, 'session-1', new AbortController().signal)
    expect(access.workspace.path).toBe(canonical)
    expect(access.root.targetKey).toBe(canonical)
    expect(host.workspaceRegistry.resolveByPath).toHaveBeenCalledWith('/header/workspace')
  })

  it('rejects a removed session before any write', async () => {
    const { ctx, writes } = fixture('removed', { live: false })
    await expect(withInternalWorkspaceWrite(ctx, 'session-1', new AbortController().signal, async () => {
      throw new Error('operation must not run')
    })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
    expect(writes).toEqual([])
  })

  it('rejects a workspace membership mismatch before any write', async () => {
    const { ctx, writes } = fixture('mismatch', { member: false })
    await expect(withInternalWorkspaceWrite(ctx, 'session-1', new AbortController().signal, async () => {
      throw new Error('operation must not run')
    })).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
    expect(writes).toEqual([])
  })

  it('does not write when the signal is already aborted', async () => {
    const { ctx, writes } = fixture('aborted-before')
    const controller = new AbortController()
    controller.abort()
    await expect(withInternalWorkspaceWrite(ctx, 'session-1', controller.signal, async () => {
      throw new Error('operation must not run')
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(writes).toEqual([])
  })

  it('does not write when the session disappears after the first resolve', async () => {
    const { ctx, writes, dropSession, host } = fixture('stale-after-resolve')
    const originalGet = host.sessions.get
    let calls = 0
    host.sessions.get = ((id: string) => {
      calls += 1
      if (calls > 1) {
        dropSession()
        return undefined
      }
      return originalGet(id)
    }) as typeof host.sessions.get
    await expect(withInternalWorkspaceWrite(ctx, 'session-1', new AbortController().signal, async () => {
      throw new Error('operation must not run')
    })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
    expect(writes).toEqual([])
  })

  it('does not write when the locked resolve lands on a different root', async () => {
    const { ctx, writes, host, canonical } = fixture('root-change')
    let first = true
    host.workspaceRegistry.resolveByPath = vi.fn(async () => {
      const path = first ? canonical : `${canonical}-other`
      first = false
      return { path, sessionIds: ['session-1'] }
    })
    const otherRoot = `${canonical}-other`
    const originalStat = host.fs.stat
    host.fs.stat = (async (target, signal) => {
      if (target.targetKey === otherRoot) return { type: 'directory', version: 'other' }
      return originalStat(target, signal)
    }) as typeof host.fs.stat
    await expect(withInternalWorkspaceWrite(ctx, 'session-1', new AbortController().signal, async () => {
      throw new Error('operation must not run')
    })).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
    expect(writes).toEqual([])
  })

  it('serializes two writes on the same workspace root', async () => {
    const { ctx, canonical } = fixture('serial')
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const first = withInternalWorkspaceWrite(ctx, 'session-1', new AbortController().signal, async (access) => {
      expect(access.root.targetKey).toBe(canonical)
      order.push('first-start')
      await held
      order.push('first-end')
    })
    const second = withInternalWorkspaceWrite(ctx, 'session-1', new AbortController().signal, async () => {
      order.push('second')
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual(['first-start'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('compares workspace roots by targetKey', () => {
    const left = { root: { targetKey: 'a', displayPath: 'a' } } as Parameters<typeof assertSameWorkspaceRoot>[0]
    const right = { root: { targetKey: 'b', displayPath: 'b' }, workspace: { path: '/b' } } as Parameters<typeof assertSameWorkspaceRoot>[1]
    expect(() => assertSameWorkspaceRoot(left, right, 'session-1')).toThrow(WorkspaceAuthorityError)
  })
})
