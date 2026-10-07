import { describe, expect, it, vi } from 'vitest'
import { provideEditorUiWorkspace, rememberCreatedChatModelError, takeCreatedChatModelError } from './ui-workspace.ts'
import type { ShellContext } from './shared.ts'
import type { WorkspaceView } from '../dsh-compat.ts'

function fixture(defaultChatModel?: () => { provider: string; model: string; reasoningEffort?: string } | undefined) {
  const create = vi.fn(async () => 'session-new')
  const releases = new Map<string, ReturnType<typeof vi.fn>>()
  const retain = vi.fn((sessionId: string) => {
    const release = vi.fn()
    releases.set(sessionId, release)
    const binding = { session: { sessionId } }
    return { sessionId, binding, ready: Promise.resolve(binding), release }
  })
  const archiveSession = vi.fn(async () => undefined)
  const pick = vi.fn(async () => ({ ok: true as const, value: '/picked' }))
  const provide = vi.fn()
  let cleanup: (() => void) | undefined
  const resolve = vi.fn(async (_channel: string, endpoint: string) => ({ ok: true, value: endpoint === 'models.migration.status' ? { chatModel: defaultChatModel?.() } : {} }))
  const selectModel = vi.fn(async (route: { sessionId: string; provider: string; model: string }) => ({ ok: true as const, value: { selected: { provider: route.provider, model: route.model } } }))
  const getSnapshot = vi.fn(() => ({ status: 'ready', value: { chatModel: defaultChatModel?.() } }))
  const ctx = {
    provide,
    effect: vi.fn((setup: () => () => void) => { cleanup = setup(); return cleanup }),
    connection: { rpc: { call: resolve } },
    configForms: { get: () => ({ getSnapshot, subscribe: () => () => {} }) },
    sessions: {
      create,
      retain,
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
  provideEditorUiWorkspace(ctx)
  const uiWorkspace = provide.mock.calls[0]?.[1] as {
    connectWorkspace(id: string, authoritativeWorkspace?: WorkspaceView): Promise<string>
    createSession(id: string): Promise<string>
    openWorkspace(id: string, beforeOpen?: (id: string) => void): Promise<void>
    pickDirectory(): Promise<string | null>
    openSession(id: string): Promise<void>
    clearSession(): void
    current: { getSnapshot(): { sessionId: string } | undefined }
    workspace: { getSnapshot(): { sessionId: string } | undefined }
    openWorkspaceSession(id: string): Promise<void>
  }
  return { archiveSession, cleanup: () => cleanup?.(), create, retain, releases, pick, uiWorkspace, selectModel, resolve, getSnapshot }
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

  it('reuses the Host create receipt while the first workspace feed is delayed', async () => {
    const { create, uiWorkspace, selectModel } = fixture(() => ({ provider: 'configured', model: 'default-chat' }))
    const receipt = { workspaceId: 'ws-missing', path: '/work', title: '作品', sessionIds: ['blank-1'], createdAt: '', updatedAt: '' }
    await expect(uiWorkspace.connectWorkspace(receipt.workspaceId, receipt)).resolves.toBe('blank-1')
    expect(create).not.toHaveBeenCalled()
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('uses a newer feed row before a stale create receipt and rejects a different workspace receipt', async () => {
    const { create, uiWorkspace } = fixture()
    const stale = { workspaceId: 'ws-1', path: '/old-path', title: '旧名称', sessionIds: [], createdAt: '', updatedAt: '' }
    await expect(uiWorkspace.connectWorkspace('ws-1', stale)).resolves.toBe('blank-1')
    await expect(uiWorkspace.connectWorkspace('ws-missing', stale)).resolves.toBe('session-new')
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-missing' })
  })

  it('opens the connected session after optional beforeOpen', async () => {
    const { retain, uiWorkspace } = fixture()
    const beforeOpen = vi.fn()
    await uiWorkspace.openWorkspace('ws-1', beforeOpen)
    expect(beforeOpen).toHaveBeenCalledWith('blank-1')
    expect(retain).toHaveBeenCalledWith('blank-1', expect.objectContaining({ source: 'mainView' }))
  })

  it('unwraps the host directory picker remote', async () => {
    const { pick, uiWorkspace } = fixture()
    await expect(uiWorkspace.pickDirectory()).resolves.toBe('/picked')
    expect(pick).toHaveBeenCalled()
  })

  it('publishes a ready replacement before releasing the previous main reference', async () => {
    const { releases, uiWorkspace } = fixture()
    await uiWorkspace.openSession('blank-1')
    await uiWorkspace.openSession('other')
    expect(uiWorkspace.current.getSnapshot()?.sessionId).toBe('other')
    expect(releases.get('blank-1')).toHaveBeenCalledOnce()
    expect(releases.get('other')).not.toHaveBeenCalled()
  })

  it('keeps the previous selection when a replacement fails and releases the failed reference', async () => {
    const f = fixture()
    await f.uiWorkspace.openSession('blank-1')
    const failedRelease = vi.fn()
    f.retain.mockImplementationOnce((sessionId: string) => {
      const binding = { session: { sessionId } }
      return { sessionId, binding, ready: Promise.reject(new Error('open failed')), release: failedRelease }
    })
    await expect(f.uiWorkspace.openSession('broken')).rejects.toThrow('open failed')
    expect(f.uiWorkspace.current.getSnapshot()?.sessionId).toBe('blank-1')
    expect(failedRelease).toHaveBeenCalledOnce()
  })

  it('keeps the workspace RPC session retained when chat switches to a new conversation', async () => {
    const { releases, retain, uiWorkspace } = fixture()
    await uiWorkspace.openWorkspaceSession('blank-1')
    await uiWorkspace.openSession('conversation-2')
    expect(retain).toHaveBeenCalledWith('blank-1', expect.objectContaining({ source: 'workspaceOperation' }))
    expect(retain).toHaveBeenCalledWith('conversation-2', expect.objectContaining({ source: 'mainView' }))
    expect(uiWorkspace.workspace.getSnapshot()?.sessionId).toBe('blank-1')
    expect(uiWorkspace.current.getSnapshot()?.sessionId).toBe('conversation-2')
    expect(releases.get('blank-1')).not.toHaveBeenCalled()
    uiWorkspace.clearSession()
    expect(releases.get('blank-1')).toHaveBeenCalledOnce()
    expect(releases.get('conversation-2')).toHaveBeenCalledOnce()
  })

  it('releases the current main reference during shell teardown', async () => {
    const { cleanup, releases, uiWorkspace } = fixture()
    await uiWorkspace.openSession('blank-1')
    cleanup()
    expect(uiWorkspace.current.getSnapshot()).toBeUndefined()
    expect(releases.get('blank-1')).toHaveBeenCalledOnce()
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

it('creates a new session when the bound blank session is no longer live, archiving the dead one', async () => {
  const create = vi.fn(async () => 'session-new')
  const provide = vi.fn()
  let cleanup: (() => void) | undefined
  const archiveSession = vi.fn(async () => undefined)
  const ctx = {
    provide,
    effect: vi.fn((setup: () => () => void) => { cleanup = setup(); return cleanup }),
    connection: {
      rpc: {
        call: vi.fn(async () => ({ ok: false, error: { code: 'session-not-found', message: 'session is not live' } })),
      },
    },
    sessions: {
      create,
      retain: vi.fn(),
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
    remote: { directoryPicker: { pick: vi.fn() }, session: { selectModel: vi.fn() } },
  } as unknown as ShellContext
  provideEditorUiWorkspace(ctx)
  const uiWorkspace = provide.mock.calls[0]?.[1] as { connectWorkspace(id: string): Promise<string> }
  await expect(uiWorkspace.connectWorkspace('ws-1')).resolves.toBe('session-new')
  expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
  expect(archiveSession).toHaveBeenCalledWith('blank-1')
})

it('fails the connection instead of churning a new session when the blank session ping fails transiently', async () => {
  const create = vi.fn(async () => 'session-new')
  const provide = vi.fn()
  let cleanup: (() => void) | undefined
  const archiveSession = vi.fn(async () => undefined)
  const ctx = {
    provide,
    effect: vi.fn((setup: () => () => void) => { cleanup = setup(); return cleanup }),
    connection: {
      rpc: {
        call: vi.fn(async () => ({ ok: false, error: { code: 'internal', message: 'backend timeout' } })),
      },
    },
    sessions: {
      create,
      retain: vi.fn(),
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
    remote: { directoryPicker: { pick: vi.fn() }, session: { selectModel: vi.fn() } },
  } as unknown as ShellContext
  provideEditorUiWorkspace(ctx)
  const uiWorkspace = provide.mock.calls[0]?.[1] as { connectWorkspace(id: string): Promise<string> }
  await expect(uiWorkspace.connectWorkspace('ws-1')).rejects.toThrow('操作未能完成，请重试。')
  expect(create).not.toHaveBeenCalled()
  expect(archiveSession).not.toHaveBeenCalled()
})

it('applies the default chat model when createSession forces a new session', async () => {
  const { create, uiWorkspace, selectModel } = fixture(() => ({ provider: 'configured', model: 'default-chat' }))
  await expect(uiWorkspace.createSession('ws-1')).resolves.toBe('session-new')
  expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
  expect(selectModel).toHaveBeenCalledWith({ sessionId: 'session-new', provider: 'configured', model: 'default-chat' })
})

it('remembers a created-chat model error for the next Chat mount', () => {
  rememberCreatedChatModelError('s1', 'failed')
  expect(takeCreatedChatModelError('s1')).toBe('failed')
  expect(takeCreatedChatModelError('s1')).toBeUndefined()
})

it('reads the saved native preference anew for each new session and preserves its effort', async () => {
  let model = 'first'
  const f = fixture(() => ({ provider: 'tier', model, reasoningEffort: 'high' }))
  await f.uiWorkspace.createSession('ws-1')
  expect(f.resolve).toHaveBeenCalledWith('/dsh-editor-shell', 'models.migration.status', {})
  expect(f.selectModel).toHaveBeenLastCalledWith({ sessionId: 'session-new', provider: 'tier', model: 'first', reasoningEffort: 'high' })
  model = 'changed'
  await f.uiWorkspace.createSession('ws-1')
  expect(f.selectModel).toHaveBeenLastCalledWith({ sessionId: 'session-new', provider: 'tier', model: 'changed', reasoningEffort: 'high' })
})
it('retains the session and offers picker recovery when the Host preference request fails', async () => {
  const f = fixture()
  f.resolve.mockRejectedValueOnce(new Error('settings unavailable'))
  await expect(f.uiWorkspace.createSession('ws-1')).resolves.toBe('session-new')
  expect(f.selectModel).not.toHaveBeenCalled()
  expect(takeCreatedChatModelError('session-new')).toBeTruthy()
})
it('leaves the native default selection intact when no chat preference is saved', async () => {
  const f = fixture()
  f.getSnapshot.mockReturnValue({ status: 'ready', value: { chatModel: { provider: 'stale', model: 'cached-old-choice' } } })
  await expect(f.uiWorkspace.createSession('ws-1')).resolves.toBe('session-new')
  expect(f.selectModel).not.toHaveBeenCalled()
  expect(f.getSnapshot).not.toHaveBeenCalled()
  expect(f.resolve).toHaveBeenCalledExactlyOnceWith('/dsh-editor-shell', 'models.migration.status', {})
  expect(takeCreatedChatModelError('session-new')).toBeUndefined()
})
it.each([
  { provider: 'custom', model: '' },
  { provider: '', model: 'named-model' },
  { provider: 42, model: 'named-model' },
  null,
])('reports an invalid saved chat route %j instead of silently selecting native defaults', async route => {
  const f = fixture(() => route as never)
  await expect(f.uiWorkspace.createSession('ws-1')).resolves.toBe('session-new')
  expect(f.selectModel).not.toHaveBeenCalled()
  expect(takeCreatedChatModelError('session-new')).toBeTruthy()
})
it('waits for migration and uses its canonical Host route without reading the client mirror', async () => {
  const f = fixture(() => ({ provider: 'configured', model: 'migrated' }))
  let resolve!: (result: any) => void
  f.resolve.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const creating = f.uiWorkspace.createSession('ws-1')
  await vi.waitFor(() => expect(f.resolve).toHaveBeenCalled())
  expect(f.getSnapshot).not.toHaveBeenCalled()
  expect(f.selectModel).not.toHaveBeenCalled()
  resolve({ ok: true, value: { chatModel: { provider: 'configured', model: 'migrated' } } })
  await expect(creating).resolves.toBe('session-new')
  expect(f.selectModel).toHaveBeenCalledWith({ sessionId: 'session-new', provider: 'configured', model: 'migrated' })
  expect(f.getSnapshot).not.toHaveBeenCalled()
})
it('uses the new Host model while the ready client mirror still holds the old legacy route', async () => {
  const f = fixture(() => ({ provider: 'new', model: 'current-host', reasoningEffort: 'off' }))
  f.getSnapshot.mockReturnValue({ status: 'ready', value: { chatModel: { provider: 'old', model: 'legacy-client-cache' } } })
  await f.uiWorkspace.createSession('ws-1')
  expect(f.selectModel).toHaveBeenCalledWith({ sessionId: 'session-new', provider: 'new', model: 'current-host', reasoningEffort: 'off' })
  expect(f.getSnapshot).not.toHaveBeenCalled()
})
it('reports migration failure without reading stale native chat preferences', async () => {
  const f = fixture(() => ({ provider: 'stale', model: 'old-native' }))
  f.resolve.mockResolvedValueOnce({ ok: true, value: { error: 'migration failed' } } as never)
  await expect(f.uiWorkspace.createSession('ws-1')).resolves.toBe('session-new')
  expect(f.getSnapshot).not.toHaveBeenCalled()
  expect(f.selectModel).not.toHaveBeenCalled()
  expect(takeCreatedChatModelError('session-new')).toBeTruthy()
})
it('keeps model errors separate for concurrent new conversations', () => {
  rememberCreatedChatModelError('first', 'first failure')
  rememberCreatedChatModelError('second', 'second failure')
  expect(takeCreatedChatModelError('first')).toBe('first failure')
  expect(takeCreatedChatModelError('second')).toBe('second failure')
})
