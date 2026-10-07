import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceView } from '../dsh-compat.ts'
import type { ShellContext } from './shared.ts'
import { collectWorkspaceFiles, connectUsableWorkspaceSession, verifyRelocatedWorkspaceSession, verifyWorkspaceSession } from './root-workspaces.tsx'

const live = { ok: true, value: { entries: [] } }
const missing = { ok: false, error: { code: 'session-not-found' } }

function context(call: ReturnType<typeof vi.fn>) {
  const connectWorkspace = vi.fn(async () => 'connected')
  const createSession = vi.fn(async () => 'new')
  const archiveSession = vi.fn(async () => undefined)
  const ctx = { connection: { rpc: { call } }, uiWorkspace: { connectWorkspace, createSession }, workspaces: { archiveSession } } as unknown as ShellContext
  return { ctx, connectWorkspace, createSession, archiveSession }
}

describe('retained workspace session verification', () => {
  it('keeps a readable preferred session without reconnecting or archiving it', async () => {
    const call = vi.fn(async () => live)
    const host = context(call)
    await expect(connectUsableWorkspaceSession(host.ctx, 'work', 'preferred')).resolves.toBe('preferred')
    expect(call).toHaveBeenCalledWith('/manuscript', 'tree.list', { sessionId: 'preferred', path: '.' })
    expect(host.connectWorkspace).not.toHaveBeenCalled()
    expect(host.archiveSession).not.toHaveBeenCalled()
  })

  it('reconnects a missing preferred session using the authoritative workspace view', async () => {
    const call = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(live)
    const host = context(call)
    const workspace = { workspaceId: 'work', path: 'H:/manuscript' } as WorkspaceView
    await expect(connectUsableWorkspaceSession(host.ctx, 'work', 'preferred', workspace)).resolves.toBe('connected')
    expect(host.connectWorkspace).toHaveBeenCalledWith('work', workspace)
    expect(host.archiveSession).not.toHaveBeenCalled()
  })

  it('creates a fresh session when archiving still leaves the same missing selection', async () => {
    const call = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(live)
    const host = context(call)
    host.connectWorkspace.mockResolvedValue('old')
    await expect(connectUsableWorkspaceSession(host.ctx, 'work')).resolves.toBe('new')
    expect(host.archiveSession).toHaveBeenCalledWith('old')
    expect(host.createSession).toHaveBeenCalledWith('work')
    expect(call.mock.calls.at(-1)?.[2]).toEqual({ sessionId: 'new', path: '.' })
  })

  it('rejects a still-missing retry instead of presenting it as a usable workspace', async () => {
    const host = context(vi.fn(async () => missing))
    await expect(connectUsableWorkspaceSession(host.ctx, 'work')).rejects.toThrow('session is not live')
    expect(host.archiveSession).toHaveBeenCalledTimes(1)
  })

  it('preserves a permission or I/O failure instead of archiving a healthy session', async () => {
    const host = context(vi.fn(async () => ({ ok: false, error: { code: 'denied', message: 'permission denied' } })))
    await expect(connectUsableWorkspaceSession(host.ctx, 'work', 'preferred')).rejects.toThrow()
    expect(host.connectWorkspace).not.toHaveBeenCalled()
    expect(host.archiveSession).not.toHaveBeenCalled()
  })
})

describe('workspace manuscript census', () => {
  it('traverses visible folders without exposing hidden workspace metadata', async () => {
    const call = vi.fn(async (_channel: string, _endpoint: string, request: { path: string }) => ({
      ok: true, value: { entries: request.path === '.'
        ? [{ name: '.dsh-editor', type: 'directory' }, { name: '正文', type: 'directory' }, { name: '封面.png', type: 'file' }]
        : [{ name: '一.md', type: 'file' }, { name: '.草稿.md', type: 'file' }] },
    }))
    await expect(collectWorkspaceFiles(context(call).ctx, 'file-session')).resolves.toEqual(['封面.png', '正文/一.md'])
    expect(call.mock.calls.map(([, , request]) => request.path)).toEqual(['.', '正文'])
  })

  it('does not treat AGENTS.md as a manuscript or issue a read for it', async () => {
    const call = vi.fn()
    await expect(verifyWorkspaceSession(context(call).ctx, 'file-session', ['AGENTS.md'])).resolves.toBeUndefined()
    expect(call).not.toHaveBeenCalled()
  })

  it('verifies the chosen document is readable before completing workspace open', async () => {
    const call = vi.fn(async () => ({ ok: true, value: { text: '稿件', version: 'v1' } }))
    await expect(verifyWorkspaceSession(context(call).ctx, 'file-session', ['AGENTS.md', '稿件.txt'])).resolves.toBe('稿件.txt')
    expect(call).toHaveBeenCalledWith('/manuscript', 'file.read', { sessionId: 'file-session', path: '稿件.txt' })
  })

  it('rejects an unreadable document and a relocation containing only project rules', async () => {
    const denied = context(vi.fn(async () => ({ ok: false, error: { code: 'denied' } })))
    await expect(verifyWorkspaceSession(denied.ctx, 'file-session', ['稿件.md'])).rejects.toThrow()
    const call = vi.fn(async () => ({ ok: true, value: { entries: [{ name: 'AGENTS.md', type: 'file' }] } }))
    await expect(verifyRelocatedWorkspaceSession(context(call).ctx, 'file-session')).rejects.toThrow('no readable manuscript')
    expect(call).toHaveBeenCalledTimes(1)
  })
})
