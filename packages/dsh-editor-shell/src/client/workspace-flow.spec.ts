import { describe, expect, it, vi } from 'vitest'
import { cleanupFlowWorkspace, createFlowWorkspace } from './shared.ts'

describe('flow workspace ownership', () => {
  it.each(['cancel', 'failed source probe', 'failed source session'])('%s keeps an existing registration and removes a new one', async () => {
    for (const created of [false, true]) {
      const workspace = { workspaceId: 'source', path: 'H:/fixture', title: 'Fixture', sessionIds: [], createdAt: '', updatedAt: '' }
      const owned = new Set<string>()
      const remove = vi.fn(async () => {})
      const result = await createFlowWorkspace({ remote: { workspace: { create: async () => ({ ok: true, value: { workspace, created } }) } } } as never, workspace.path, owned)
      expect(result.created).toBe(created)
      expect(await cleanupFlowWorkspace({ delete: remove }, owned, workspace.workspaceId)).toBe(true)
      expect(remove).toHaveBeenCalledTimes(created ? 1 : 0)
      expect(owned.size).toBe(0)
    }
  })

  it('retains ownership after failed cleanup so retry can remove the new registration', async () => {
    const owned = new Set(['new'])
    const remove = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(undefined)
    expect(await cleanupFlowWorkspace({ delete: remove }, owned, 'new')).toBe(false)
    expect(owned.has('new')).toBe(true)
    expect(await cleanupFlowWorkspace({ delete: remove }, owned, 'new')).toBe(true)
    expect(owned.has('new')).toBe(false)
  })

  it('never claims or deletes a registration when Host create rejects', async () => {
    const owned = new Set<string>()
    await expect(createFlowWorkspace({ remote: { workspace: { create: async () => ({ ok: false, error: { message: 'Denied' } }) } } } as never, 'H:/fixture', owned)).rejects.toThrow('Denied')
    expect(owned.size).toBe(0)
  })
})
