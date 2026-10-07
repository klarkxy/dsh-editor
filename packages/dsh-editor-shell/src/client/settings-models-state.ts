/** Provider settings mirror and host refresh coordination for the models page. */
import type { ConfigurableProviderView, CredentialView, EditorRemote, SettingsNamespaceView } from '../dsh-compat.ts'
import type { SettingsDescribeFace } from './shared.ts'
import { apiKeyEnvOf, deriveKeyRef, joinProviderRows, providerIdOf, type ProviderRow, type SettingsSchemaOps } from './settings-models-store.ts'
import { failureMessage, text } from './settings-models-copy.ts'
import { t } from '../i18n/index.ts'

/* Settings snapshot the page renders from. Mirrors the upstream store's
   observable: status drives the top of the page, rows drive the list,
   namespaces backs the editor's per-row reads, and credentialError is the
   non-fatal warning surface for a failed describe batch. */
export type ModelsSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  refreshing: boolean
  error: string | null
  credentialError: string | null
  writable: boolean
  rows: ProviderRow[]
  namespaces: Map<string, SettingsNamespaceView>
}

const INITIAL_SNAPSHOT: ModelsSnapshot = {
  status: 'idle',
  refreshing: false,
  error: null,
  credentialError: null,
  writable: false,
  rows: [],
  namespaces: new Map(),
}

/**
 * Controller shared by the page. Holds the observable snapshot, refreshes
 * from the wire on demand, and exposes the uSES-shaped subscription. One
 * instance per page surface; the React tree re-renders from `getSnapshot`.
 */
export class ModelsStore {
  state: ModelsSnapshot = INITIAL_SNAPSHOT
  listeners = new Set<() => void>()
  /** Generation counter: only the freshest `load` may commit a snapshot. */
  generation = 0

  constructor(
    private readonly api: EditorRemote,
    private readonly describeFace: SettingsDescribeFace,
    private readonly schema: SettingsSchemaOps,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): ModelsSnapshot => this.state

  /** A no-op refresh before the page has ever loaded — saves a wire call. */
  refreshIfLoaded(): void {
    if (this.state.status === 'idle') return
    void this.load()
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    const loaded = this.state.status === 'ready'
    this.state = { ...this.state, status: loaded ? 'ready' : 'loading', refreshing: loaded, error: null }
    for (const listener of this.listeners) listener()

    let providers: ConfigurableProviderView[]
    let writable: boolean
    let views: SettingsNamespaceView[]
    try {
      const [providersResponse] = await Promise.all([this.api.llm.listConfigurableProviders(), this.describeFace.ensure()])
      if (generation !== this.generation) return
      const providersResult = providersResponse
      if (!providersResult.ok) throw new Error(failureMessage(providersResult))
      const mirrored = this.describeFace.getSnapshot()
      if (mirrored.view === undefined) throw new Error(mirrored.error ?? t('common.unavailable'))
      providers = providersResult.value
      writable = mirrored.view.writable
      views = [...mirrored.view.namespaces]
    } catch (error) {
      if (generation !== this.generation) return
      this.state = {
        ...this.state,
        status: loaded ? 'ready' : 'error',
        refreshing: false,
        error: error instanceof Error ? error.message : String(error),
      }
      for (const listener of this.listeners) listener()
      return
    }

    const namespaces = new Map(views.map((view) => [view.ns, view]))
    const refs = [...new Set(providers.flatMap((entry) => {
      const ref = apiKeyEnvOf(namespaces.get(entry.settingsNs), entry.settingsPath, this.schema)
      return ref === undefined ? [] : [ref]
    }))]
    let credentials: Record<string, CredentialView> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const response = await this.api.credentials.describe(refs)
        const result = response
        if (result.ok) credentials = result.value
        else credentialError = failureMessage(result)
      } catch (error) {
        credentialError = error instanceof Error ? error.message : String(error)
      }
    }
    if (generation !== this.generation) return

    const joinedRows = joinProviderRows(providers, namespaces, credentials, this.schema)
    this.state = {
      ...this.state,
      status: 'ready',
      refreshing: false,
      error: null,
      credentialError,
      writable,
      rows: joinedRows,
      namespaces,
    }
    for (const listener of this.listeners) listener()
  }

  /** Fold one write answer into the in-memory mirror so the row list updates
     before refreshing — the upstream models section uses the same
     "accept then close" pattern, and the pushed-invalidation subscriptions
     cover the other cases. */
  acceptNamespaceView(view: SettingsNamespaceView): void {
    this.describeFace.acceptView(view)
    void this.load()
  }
}

/* The credential reference whose removal would also wipe a stored key. */
export function managedCredentialRef(row: ProviderRow): string | undefined {
  const managedRef = deriveKeyRef(providerIdOf(row.entry))
  if (row.apiKeyEnv !== managedRef) return undefined
  if (row.credential?.configured !== true) return undefined
  if (row.credential.writable !== true) return undefined
  return managedRef
}

/* Drop a user-added provider and (if its key is one this page owns) the
   matching stored credential. The unset lands first so a settings-rejected
   second step leaves the row visible and the operation safely retryable.
   The client gateway counts settings/mutate's revision argument, so this
   call always sends the revision the page last read. */
export async function removeProviderProfile(api: EditorRemote, store: ModelsStore, row: ProviderRow): Promise<void> {
  const managedRef = managedCredentialRef(row)
  if (managedRef !== undefined) {
    const response = await api.credentials.unset(managedRef)
    const result = response
    if (!result.ok) throw new Error(failureMessage(result))
  }
  const expectedRevision = store.getSnapshot().namespaces.get(row.entry.settingsNs)?.revision
  if (expectedRevision === undefined) throw new Error(text().loadFailed)
  const response = await api.settings.mutate(
    row.entry.settingsNs,
    [{ op: 'unset', path: [...row.entry.settingsPath] }],
    expectedRevision,
  )
  const result = response
  if (!result.ok) {
    if (result.error?.code === 'settings-conflict') throw new Error(text().conflict)
    throw new Error(failureMessage(result))
  }
  await store.load()
}
