import { describe, expect, it, vi } from 'vitest'
import type { ConfigurableProviderView, CredentialView, EditorRemote, RpcResult, SettingsNamespaceView } from '../dsh-compat.ts'
import type { SettingsDescribeFace, SettingsMirrorSnapshot } from './shared.ts'
import type { ProviderRow, SettingsSchemaOps } from './settings-models-store.ts'
import { managedCredentialRef, ModelsStore, removeProviderProfile } from './settings-models-state.ts'
import { t } from '../i18n/index.ts'

const provider: ConfigurableProviderView = { provider: 'example', settingsNs: 'models', settingsPath: ['example'] }
const namespace: SettingsNamespaceView = {
  ns: 'models', revision: 1, value: { example: { apiKeyEnv: 'EXAMPLE_KEY' } }, user: {}, base: {},
}
const schema: SettingsSchemaOps = {
  rehydrate: value => value,
  nodeAtPath: () => undefined,
  getPath: (value, path) => path.reduce<unknown>((current, key) =>
    typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[key] : undefined, value),
  hasPath: () => false,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  let mirror: SettingsMirrorSnapshot = {
    status: 'ready', error: null, view: { writable: true, hasDocument: true, namespaces: [namespace] },
  }
  const list = vi.fn<() => Promise<RpcResult<ConfigurableProviderView[]>>>().mockResolvedValue({ ok: true, value: [provider] })
  const credentials = vi.fn<() => Promise<RpcResult<Record<string, CredentialView>>>>().mockResolvedValue({
    ok: true, value: { EXAMPLE_KEY: { configured: true, writable: true } },
  })
  const unset = vi.fn(async (): Promise<RpcResult<void>> => ({ ok: true, value: undefined }))
  const mutate = vi.fn(async (): Promise<RpcResult<SettingsNamespaceView>> => ({ ok: true, value: namespace }))
  const describe: SettingsDescribeFace = {
    ensure: vi.fn(async () => {}),
    subscribe: () => () => {},
    getSnapshot: () => mirror,
    acceptView: vi.fn(view => { mirror = { ...mirror, view: { ...mirror.view!, namespaces: [view] } } }),
  }
  // The fixture exposes only methods used by the provider mirror and deletion.
  const api = {
    llm: { listConfigurableProviders: list }, credentials: { describe: credentials, unset }, settings: { mutate },
  } as unknown as EditorRemote
  return { store: new ModelsStore(api, describe, schema), api, list, credentials, unset, mutate, describe, setMirror: (next: SettingsMirrorSnapshot) => { mirror = next } }
}

describe('ModelsStore host mirror', () => {
  it('joins only referenced credential descriptions and publishes immutable snapshot changes', async () => {
    const { store, credentials, list } = fixture()
    const initial = store.getSnapshot()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.refreshIfLoaded()
    expect(list).not.toHaveBeenCalled()
    await store.load()
    expect(credentials).toHaveBeenCalledWith(['EXAMPLE_KEY'])
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', refreshing: false, writable: true, error: null, credentialError: null })
    expect(store.getSnapshot().rows[0]?.credential).toEqual({ configured: true, writable: true })
    expect(initial).toMatchObject({ status: 'idle', rows: [] })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    await store.load()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps provider rows ready when the credential batch fails', async () => {
    const { store, credentials } = fixture()
    credentials.mockResolvedValueOnce({ ok: false, error: { message: 'credential storage unavailable' } })
    await store.load()
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', error: null, credentialError: 'credential storage unavailable' })
    expect(store.getSnapshot().rows[0]?.credential).toBeUndefined()
    credentials.mockRejectedValueOnce(new Error('credential transport unavailable'))
    await store.load()
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', error: null, credentialError: 'credential transport unavailable' })
  })

  it('distinguishes initial source failure from a failed refresh retaining the last usable rows', async () => {
    const { store, list } = fixture()
    list.mockResolvedValueOnce({ ok: false, error: { message: 'providers unavailable' } })
    await store.load()
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'providers unavailable', rows: [] })
    await store.load()
    const rows = store.getSnapshot().rows
    list.mockRejectedValueOnce(new Error('transport disconnected'))
    await store.load()
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', refreshing: false, error: 'transport disconnected' })
    expect(store.getSnapshot().rows).toBe(rows)
  })

  it('treats an unavailable settings mirror as a source failure rather than valid empty configuration', async () => {
    const { store, setMirror } = fixture()
    setMirror({ status: 'unavailable', view: undefined, error: 'settings document unavailable' })
    await store.load()
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'settings document unavailable' })
  })

  it('ignores an older provider response after a newer refresh has completed', async () => {
    const { store, list } = fixture()
    const old = deferred<RpcResult<ConfigurableProviderView[]>>()
    list.mockReturnValueOnce(old.promise)
    const oldLoad = store.load()
    await store.load()
    const newest = store.getSnapshot()
    old.resolve({ ok: false, error: { message: 'obsolete failure' } })
    await oldLoad
    expect(store.getSnapshot()).toBe(newest)
  })

  it('ignores an older credential response after a newer refresh has completed', async () => {
    const { store, credentials } = fixture()
    const old = deferred<RpcResult<Record<string, CredentialView>>>()
    const requested = deferred<void>()
    credentials.mockImplementationOnce(() => { requested.resolve(); return old.promise })
    const oldLoad = store.load()
    await requested.promise
    await store.load()
    const newest = store.getSnapshot()
    old.resolve({ ok: false, error: { message: 'obsolete credential failure' } })
    await oldLoad
    expect(store.getSnapshot()).toBe(newest)
  })

  it('accepts a write response into the host mirror before refreshing rows', async () => {
    const { store, describe } = fixture()
    const accepted = { ...namespace, revision: 2 }
    store.acceptNamespaceView(accepted)
    expect(describe.acceptView).toHaveBeenCalledWith(accepted)
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe('ready'))
    expect(store.getSnapshot().namespaces.get('models')).toBe(accepted)
  })
})

describe('provider deletion', () => {
  const row: ProviderRow = {
    entry: provider, configured: true, removable: true, apiKeyEnv: 'EXAMPLE_API_KEY',
    credential: { configured: true, writable: true },
  }

  it('owns only configured writable keys with the provider-derived reference', () => {
    expect(managedCredentialRef(row)).toBe('EXAMPLE_API_KEY')
    expect(managedCredentialRef({ ...row, apiKeyEnv: 'SHARED_KEY' })).toBeUndefined()
    expect(managedCredentialRef({ ...row, credential: { configured: true, writable: false } })).toBeUndefined()
    expect(managedCredentialRef({ ...row, credential: { configured: false, writable: true } })).toBeUndefined()
    expect(managedCredentialRef({ ...row, credential: undefined })).toBeUndefined()
  })

  it('unsets its managed key before deleting the settings path with the loaded revision', async () => {
    const { store, api, unset, mutate } = fixture()
    await store.load()
    await removeProviderProfile(api, store, row)
    expect(unset).toHaveBeenCalledWith('EXAMPLE_API_KEY')
    expect(mutate).toHaveBeenCalledWith('models', [{ op: 'unset', path: ['example'] }], 1)
    expect(unset.mock.invocationCallOrder[0]).toBeLessThan(mutate.mock.invocationCallOrder[0]!)
  })

  it('preserves externally owned credentials while removing their provider configuration', async () => {
    const { store, api, unset, mutate } = fixture()
    await store.load()
    await removeProviderProfile(api, store, { ...row, apiKeyEnv: 'SHARED_KEY' })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('keeps the configuration intact when managed credential removal fails', async () => {
    const { store, api, unset, mutate } = fixture()
    await store.load()
    unset.mockResolvedValueOnce({ ok: false, error: { message: 'credential removal failed' } })
    await expect(removeProviderProfile(api, store, row)).rejects.toThrow('credential removal failed')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports settings conflicts distinctly after a successful credential removal', async () => {
    const { store, api, mutate } = fixture()
    await store.load()
    mutate.mockResolvedValueOnce({ ok: false, error: { code: 'settings-conflict', message: 'raw conflict' } })
    await expect(removeProviderProfile(api, store, row)).rejects.toThrow(t('models.conflict'))
    expect(store.getSnapshot().rows).toHaveLength(1)
    mutate.mockResolvedValueOnce({ ok: false, error: { message: 'settings storage unavailable' } })
    await expect(removeProviderProfile(api, store, row)).rejects.toThrow('settings storage unavailable')
  })
})
