import { describe, expect, it, vi } from 'vitest'
import { canSubmitComposer, clampPanelWidth, createFlowWorkspace, errorMessage, isStaleFailure, LatestRequestGate, resizedPanelWidth, safeRpcCall, shouldSubmitComposer, workspaceShortcut } from './client.ts'

describe('shell manuscript RPC safety', () => {
  it('drops superseded or cross-session async responses', () => {
    const gate = new LatestRequestGate()
    const first = gate.begin('session-a')
    expect(gate.isCurrent(first)).toBe(true)
    const newer = gate.begin('session-a')
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(newer)).toBe(true)
    gate.setScope('session-b')
    expect(gate.isCurrent(newer)).toBe(false)
  })

  it('clamps both panel resize directions to their accessible bounds', () => {
    expect(clampPanelWidth(120, 196, 420)).toBe(196)
    expect(clampPanelWidth(520, 196, 420)).toBe(420)
    expect(resizedPanelWidth('left', 248, 32, 196, 420)).toBe(280)
    expect(resizedPanelWidth('right', 384, 32, 300, 560)).toBe(352)
    expect(resizedPanelWidth('right', 384, -500, 300, 560)).toBe(560)
  })

  it('maps workspace shortcuts without stealing modified variants', () => {
    const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({
      key: value, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra,
    })
    expect(workspaceShortcut(key('b'))).toBe('toggle-sidebar')
    expect(workspaceShortcut(key('j'))).toBe('toggle-assistant')
    expect(workspaceShortcut(key('\\'))).toBe('toggle-focus')
    expect(workspaceShortcut(key('l'))).toBe('focus-assistant')
    expect(workspaceShortcut(key(',', { ctrlKey: false, metaKey: true }))).toBe('settings')
    expect(workspaceShortcut(key('[', { ctrlKey: false, altKey: true, code: 'BracketLeft' }))).toBe('previous-chapter')
    expect(workspaceShortcut(key('b', { shiftKey: true }))).toBeNull()
  })

  it('sends chat on plain Enter but preserves newlines and IME composition', () => {
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(shouldSubmitComposer({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(shouldSubmitComposer({ key: 'a', shiftKey: false })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: false })).toBe(true)
    expect(canSubmitComposer({ draft: '写下去', connected: false, removed: false })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: true })).toBe(false)
    expect(canSubmitComposer({ draft: '写下去', connected: true, removed: false, outgoingState: 'sending' })).toBe(false)
    expect(canSubmitComposer({ draft: '重试', connected: true, removed: false, outgoingState: 'failed' })).toBe(true)
  })

  it('keeps a successful result unchanged', async () => {
    await expect(safeRpcCall(async () => ({ ok: true, value: { entries: [] } }))).resolves.toEqual({
      ok: true,
      value: { entries: [] },
    })
  })

  it('folds a rejected tree request into a renderable Host failure', async () => {
    await expect(safeRpcCall(async () => { throw new Error('invalid wire result') })).resolves.toEqual({
      ok: false,
      error: { code: 'internal', message: 'invalid wire result' },
    })
  })

  it('still treats remapped stale writes as conflicts', () => {
    const result = { ok: false as const, error: { code: 'bad-request', message: 'file changed on disk' } }
    expect(isStaleFailure(result)).toBe(true)
    expect(errorMessage(result)).toBe('磁盘文件已经变化。')
  })

  it('uses the Host-created flag instead of a possibly stale workspace list', async () => {
    const workspace = { workspaceId: 'workspace-1', path: 'D:\\novel', title: 'novel', sessionIds: [], createdAt: '', updatedAt: '' }
    const createHost = vi.fn(async () => ({ result: { ok: true as const, value: { workspace, created: true } } }))
    const createProjection = vi.fn(async () => workspace)
    const result = await createFlowWorkspace({
      connection: { api: { workspace: { create: createHost } } },
      workspaces: { create: createProjection },
    } as never, 'D:\\novel')

    expect(result).toEqual({ workspace, created: true })
    expect(createHost).toHaveBeenCalledWith({ path: 'D:\\novel' })
    expect(createProjection).toHaveBeenCalledWith({ path: 'D:\\novel' })
  })

  it('removes a newly registered workspace if the local projection cannot adopt it', async () => {
    const workspace = { workspaceId: 'workspace-2', path: 'D:\\target', title: 'target', sessionIds: [], createdAt: '', updatedAt: '' }
    const removeHost = vi.fn(async () => ({ result: { ok: true as const, value: { deleted: true as const } } }))
    await expect(createFlowWorkspace({
      connection: { api: { workspace: {
        create: async () => ({ result: { ok: true as const, value: { workspace, created: true } } }),
        delete: removeHost,
      } } },
      workspaces: { create: async () => { throw new Error('projection failed') } },
    } as never, 'D:\\target')).rejects.toThrow('projection failed')

    expect(removeHost).toHaveBeenCalledWith({ workspaceId: 'workspace-2' })
  })

  it('reports when projection rollback cannot remove the new Host registration', async () => {
    const workspace = { workspaceId: 'workspace-3', path: 'D:\\blocked', title: 'blocked', sessionIds: [], createdAt: '', updatedAt: '' }
    await expect(createFlowWorkspace({
      connection: { api: { workspace: {
        create: async () => ({ result: { ok: true as const, value: { workspace, created: true } } }),
        delete: async () => ({ result: { ok: false as const, error: { code: 'internal', message: 'delete failed', details: {} } } }),
      } } },
      workspaces: { create: async () => { throw new Error('projection failed') } },
    } as never, 'D:\\blocked')).rejects.toThrow('registration could not be removed')
  })
})
