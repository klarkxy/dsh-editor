import { describe, expect, it, vi } from 'vitest'
import { provideEditorUiWorkspace } from './ui-workspace.ts'
import type { ShellContext } from './shared.ts'

function fixture(defaultChatModel?: () => { provider: string; model: string } | undefined) {
  const create = vi.fn(async () => 'session-new')
  const open = vi.fn()
  const archiveSession = vi.fn(async () => undefined)
  const pick = vi.fn(async () => ({ ok: true as const, value: '/picked' }))
  const provide = vi.fn()
  const selectModel = vi.fn(async (route: { sessionId: string; provider: string; model: string }) => ({ ok: true as const, value: { selected: { provider: route.provider, model: route.model } } }))
  const ctx = {
    provide,
    sessions: {
      create,
      open,
      list: {
        getSnapshot: () => ({
          ids: ['blank-1'],
          byId: { 'blank-1': { id: 'blank-1', blank: true, cwd: '/work' } },
        }),
      },
    },
    workspaces: {
      archiveSession,
      list: {
        getSnapshot: () => ({
          items: [{ workspaceId: 'ws-1', path: '/work', title: '作品', sessionIds: ['blank-1'], createdAt: '', updatedAt: '' }],
          archivedSessionIds: [],
        }),
      },
    },
    remote: { directoryPicker: { pick }, session: { selectModel } },
  } as unknown as ShellContext
  provideEditorUiWorkspace(ctx, { defaultChatModel })
  const uiWorkspace = provide.mock.calls[0]?.[1] as {
    connectWorkspace(id: string): Promise<string>
    openWorkspace(id: string, beforeOpen?: (id: string) => void): Promise<void>
    pickDirectory(): Promise<string | null>
  }
  return { create, open, pick, uiWorkspace, selectModel }
}

describe('provideEditorUiWorkspace', () => {
  it('reuses a blank session already bound to the workspace path', async () => {
    const { create, uiWorkspace } = fixture()
    await expect(uiWorkspace.connectWorkspace('ws-1')).resolves.toBe('blank-1')
    expect(create).not.toHaveBeenCalled()
  })

  it('creates a session when the workspace row is not in the local snapshot yet', async () => {
    const { create, uiWorkspace } = fixture()
    await expect(uiWorkspace.connectWorkspace('ws-missing')).resolves.toBe('session-new')
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-missing' })
  })

  it('opens the connected session after optional beforeOpen', async () => {
    const { open, uiWorkspace } = fixture()
    const beforeOpen = vi.fn()
    await uiWorkspace.openWorkspace('ws-1', beforeOpen)
    expect(beforeOpen).toHaveBeenCalledWith('blank-1')
    expect(open).toHaveBeenCalledWith('blank-1')
  })

  it('unwraps the host directory picker remote', async () => {
    const { pick, uiWorkspace } = fixture()
    await expect(uiWorkspace.pickDirectory()).resolves.toBe('/picked')
    expect(pick).toHaveBeenCalled()
  })
})

it('waits for the configured default selection before returning a newly created session', async () => {
  const {uiWorkspace, selectModel} = fixture(() => ({provider: 'configured', model: 'default-chat'}))
  let release!: () => void
  const selected = new Promise<void>(resolve => {release = resolve})
  selectModel.mockImplementationOnce(async route => {
    await selected
    return {ok: true, value: {selected: {provider: route.provider, model: route.model}}}
  })
  let finished = false
  const creating = uiWorkspace.connectWorkspace('new-work').then(id => {finished = true; return id})
  await vi.waitFor(() => expect(selectModel).toHaveBeenCalledWith({sessionId: 'session-new', provider: 'configured', model: 'default-chat'}))
  expect(finished).toBe(false)
  release()
  await expect(creating).resolves.toBe('session-new')
})

it('never changes the model of a reused blank session when the default changes', async () => {
  const {uiWorkspace, selectModel} = fixture(() => ({provider: 'configured', model: 'new-default'}))
  await expect(uiWorkspace.connectWorkspace('ws-1')).resolves.toBe('blank-1')
  expect(selectModel).not.toHaveBeenCalled()
})
