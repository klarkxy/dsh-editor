import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { dispatchEditorFiles, registerEditorFilesRpc } from '../../dsh-manuscript/src/editor-files.ts'
import type { FileSystemLike, ManuscriptHost } from '../../dsh-manuscript/src/host.ts'
import { WORKBENCH_RPC_CHANNEL } from './workbench-rpc.ts'

function fixture() {
  const canonical = '/canonical/workspace'
  const resolveCalls: Array<{ path: string; cwd?: string }> = []
  const fs: FileSystemLike = {
    async resolve(path, options) {
      resolveCalls.push({ path, cwd: options?.cwd })
      const targetKey = path === '.' ? canonical : `${options?.cwd}/${path}`.replace('/./', '/')
      return { targetKey, displayPath: targetKey }
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
    },
    async stat(target) {
      return target.targetKey === canonical ? { type: 'directory', version: 'root' } : undefined
    },
    async lstat(path) {
      return path === '.' ? { type: 'directory', version: 'root' } : undefined
    },
    async readText() { throw new Error('not used') },
    async listDir() { return [] },
    async writeText() { throw new Error('not used') },
  }
  const handle = vi.fn(() => vi.fn())
  const host = {
    sessions: { get: vi.fn(() => ({ id: 'session-1', header: { cwd: '/header/workspace' }, requestHeader: () => undefined })) },
    workspaceRegistry: { resolveByPath: vi.fn(async () => ({ path: canonical, sessionIds: ['session-1'] })) },
    sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: canonical, sessionId: 'session-1' })) },
    fs,
    connection: { rpc: { call: vi.fn(), handle } },
  } as unknown as ManuscriptHost
  return { host, handle, canonical, resolveCalls }
}

describe('private editor workbench Host RPC', () => {
  it('registers only on the loopback workbench channel', () => {
    const { host, handle } = fixture()
    registerEditorFilesRpc(host as unknown as Context)
    expect(handle).toHaveBeenCalledWith(
      WORKBENCH_RPC_CHANNEL,
      expect.any(Function),
      { authority: 'loopback' },
    )
  })

  it('derives private lifecycle access from the live session and ignores a forged cwd', async () => {
    const { host, canonical, resolveCalls } = fixture()
    await expect(dispatchEditorFiles(
      host as unknown as Context,
      'archive.list',
      { sessionId: 'session-1', cwd: '/forged/outside' },
      new AbortController().signal,
    )).resolves.toEqual({ items: [], invalid: 0 })
    expect(host.workspaceRegistry.resolveByPath).toHaveBeenCalledWith('/header/workspace')
    expect(resolveCalls.length).toBeGreaterThan(0)
    expect(resolveCalls.every((call) => call.cwd === canonical)).toBe(true)
  })

  it('requires both restore sessions to be live', async () => {
    const { host } = fixture()
    host.workspaceRegistry.resolveByPath = vi.fn(async () => ({ path: '/canonical/workspace', sessionIds: ['target'] }))
    host.sessions.get = vi.fn((sessionId: string) => sessionId === 'target'
      ? { id: 'target', header: { cwd: '/header/workspace' }, requestHeader: () => undefined }
      : undefined) as ManuscriptHost['sessions']['get']
    await expect(dispatchEditorFiles(
      host as unknown as Context,
      'snapshot.restoreProbe',
      { targetSessionId: 'target', sourceSessionId: 'forged-source' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
  })
})
