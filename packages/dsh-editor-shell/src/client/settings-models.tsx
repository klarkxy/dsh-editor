/**
 * Models settings page: provider rows joined from the configurable-provider
 * directory, the settings namespaces mirror, and the referenced credentials.
 * Mirrors the wire/host semantics of the upstream `dsh-client-ui-settings-models`
 * package without depending on the host runtime plugin: this shell reuses the
 * same store helpers from `./settings-models-store.ts` and binds the data
 * sources through the {@link ShellContext} already available to the editor.
 *
 * The component owns one `ModelsStore` instance, subscribes to it through
 * `useSyncExternalStore`, listens to the host's pushed invalidations
 * (`settings/document-updated`, `credentials/reference-updated`,
 * `llm/adapters-updated`, `connection/reset`), and renders the page states:
 * loading, error with retry, the row list with editor / custom-provider cards
 * inlined, the candidate picker modal, and the delete confirmation.
 */
import {
  createElement as e,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type {
  ConfigurableProviderView,
  CredentialView,
  DiscoveredModelView,
  IApiClient,
  RpcResponse,
  RpcResult,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  addableRows,
  apiKeyFailure,
  credentialDot,
  deriveKeyRef,
  joinProviderRows,
  layoutOf,
  modelDrafts,
  pathOps,
  protocolChoices,
  providerUsable,
  reasoningChoiceOf,
  reasoningEffortsFor,
  refFor,
  routeFailure,
  validateModels,
  type ProviderRow,
  type ReasoningChoice,
} from './settings-models-store.ts'
import { Select, type SelectOption } from './select.tsx'
import { ConfirmDialog } from './dialogs.ts'
import type { SettingsDescribeFace, SettingsSchemaService, ShellContext } from './shared.ts'
import { t, useLocale } from '../i18n/index.ts'

/* Wire types aliased so the rest of the file can read them without a long
   import. The methods we use are all in `IApiClient`; the narrower shape
   keeps the call sites readable and makes any future test injection easier. */
type Api = IApiClient

/* Settings snapshot the page renders from. Mirrors the upstream store's
   observable: status drives the top of the page, rows drive the list,
   namespaces backs the editor's per-row reads, and credentialError is the
   non-fatal warning surface for a failed describe batch. */
type Snapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  credentialError: string | null
  writable: boolean
  rows: ProviderRow[]
  namespaces: Map<string, SettingsNamespaceView>
}

const INITIAL_SNAPSHOT: Snapshot = {
  status: 'idle',
  error: null,
  credentialError: null,
  writable: false,
  rows: [],
  namespaces: new Map(),
}

function shallowCopySnapshot(snapshot: Snapshot, patch: Partial<Snapshot>): Snapshot {
  return {
    ...snapshot,
    ...patch,
    namespaces: patch.namespaces ?? snapshot.namespaces,
    rows: patch.rows ?? snapshot.rows,
  }
}

/* Read the message of a rejected wire call without unwrapping to a host
   stack — the page shows the same text the user would see in the DevTools
   "response" panel. */
function failureMessage(result: RpcResult<unknown>): string {
  const error = (result as { error?: { message?: string } }).error
  return error?.message ?? t('common.requestFailed')
}

function rpcResult<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}

/**
 * Controller shared by the page. Holds the observable snapshot, refreshes
 * from the wire on demand, and exposes the uSES-shaped subscription. One
 * instance per page surface; the React tree re-renders from `getSnapshot`.
 */
class ModelsStore {
  state: Snapshot = INITIAL_SNAPSHOT
  listeners = new Set<() => void>()
  /** Generation counter: only the freshest `load` may commit a snapshot. */
  generation = 0

  constructor(
    private readonly api: Api,
    private readonly describeFace: SettingsDescribeFace,
    private readonly schema: SettingsSchemaService,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): Snapshot => this.state

  /** A no-op refresh before the page has ever loaded — saves a wire call. */
  refreshIfLoaded(): void {
    if (this.state.status === 'idle') return
    void this.load()
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    this.state = shallowCopySnapshot(this.state, { status: 'loading', error: null })
    for (const listener of this.listeners) listener()

    let providers: ConfigurableProviderView[]
    let writable: boolean
    let views: SettingsNamespaceView[]
    try {
      const [providersResponse] = await Promise.all([this.api.llm.providers({}), this.describeFace.ensure()])
      if (generation !== this.generation) return
      const providersResult = rpcResult<{ providers: ConfigurableProviderView[] }>(providersResponse)
      if (!providersResult.ok) throw new Error(failureMessage(providersResult))
      const mirrored = this.describeFace.getSnapshot()
      if (mirrored.view === undefined) throw new Error(mirrored.error ?? t('common.unavailable'))
      providers = providersResult.value.providers
      writable = mirrored.view.writable
      views = [...mirrored.view.namespaces]
    } catch (error) {
      if (generation !== this.generation) return
      this.state = {
        ...this.state,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
      for (const listener of this.listeners) listener()
      return
    }

    const namespaces = new Map(views.map((view) => [view.ns, view]))
    const draftRows = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      return {
        entry,
        configured:
          namespace !== undefined &&
          (entry.settingsPath.length === 0 ||
            this.schema.getPath(namespace.value, entry.settingsPath) !== undefined),
        removable:
          namespace !== undefined &&
          entry.settingsPath.length > 0 &&
          this.schema.hasPath(namespace.user, entry.settingsPath) &&
          !this.schema.hasPath(namespace.base, entry.settingsPath),
        apiKeyEnv: apiKeyEnvOfLocal(namespace, entry.settingsPath, this.schema),
        credential: undefined as CredentialView | undefined,
      }
    })
    const refs = [...new Set(draftRows.flatMap((row) => (row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv])))]
    let credentials: Record<string, CredentialView> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const response = await this.api.credentials.describe({ refs })
        const result = rpcResult<{ credentials: Record<string, CredentialView> }>(response)
        if (result.ok) credentials = result.value.credentials
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
      error: null,
      credentialError,
      writable,
      rows: joinedRows,
      namespaces,
    }
    for (const listener of this.listeners) listener()
  }

  /** Fold one write answer into the in-memory mirror so the row list updates
     without a full refresh — the upstream models section uses the same
     "accept then close" pattern, and the pushed-invalidation subscriptions
     cover the other cases. */
  acceptNamespaceView(view: SettingsNamespaceView): void {
    this.describeFace.acceptView(view)
    void this.load()
  }
}

/* The settings-models-store module already exposes `apiKeyEnvOf`, but the
   helper accepts a narrower `SettingsSchemaOps` (no `setPath` etc.). The
   service we get off the context is the wider one, so we re-export through
   a local cast-free wrapper to keep callers honest. */
function apiKeyEnvOfLocal(
  namespace: SettingsNamespaceView | undefined,
  path: string[],
  schema: SettingsSchemaService,
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = schema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/* The same `proto` model store the rest of the page passes around, just
   a stable alias for the rest of the file. */
type Store = ModelsStore

/* Whether a row is the first-run setup posture: the only existing row whose
   empty settingsPath is the whole section, and only while no other row can
   already serve requests. */
function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

/* The credential reference whose removal would also wipe a stored key. */
function managedCredentialRef(row: ProviderRow): string | undefined {
  const managedRef = deriveKeyRef(row.entry.provider)
  if (row.apiKeyEnv !== managedRef) return undefined
  if (row.credential?.configured !== true) return undefined
  if (row.credential.writable !== true) return undefined
  return managedRef
}

/* A loose draft object we hand to the editor. The store layer accepts plain
   records only, so the editor serializes its working copy through this type. */
type ProfileDraft = Record<string, unknown>

/* Read a user-section subtree as a plain draft, falling back to {} when
   missing. Deep clone is not strictly required: the editor rebuilds objects
   through `setPath` / `deletePath`, which return new objects. */
function draftAt(
  schema: SettingsSchemaService,
  namespace: SettingsNamespaceView,
  path: string[],
): ProfileDraft {
  const subtree = schema.getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return { ...(subtree as Record<string, unknown>) }
}

/* Chinese text: copy keys are the only surface where we deviate from the
   upstream English wire text. Kept in one block so review stays focused. */
function text() {
  return {
  intro: t('models.intro'),
  readOnly: t('models.readOnly'),
  credentialErrorPrefix: t('models.credentialErrorPrefix'),
  loading: t('zhihu.reading'),
  loadFailed: t('models.loadFailed'),
  retry: t('common.retry'),
  saved: t('common.saved'),
  edit: t('common.edit'),
  delete: t('common.delete'),
  add: t('models.add'),
  addCustom: t('models.addCustom'),
  custom: t('common.custom'),
  confirmDeleteTitle: t('models.confirmDeleteTitle'),
  confirmDeleteManage: t('models.confirmDeleteManage'),
  confirmDeleteKeep: t('models.confirmDeleteKeep'),
  cancel: t('common.cancel'),
  apiKey: t('models.apiKey'),
  apiKeyPlaceholderStored: t('models.apiKeyStored'),
  apiKeyPlaceholderLocked: t('models.apiKeyLocked'),
  apiKeyPlaceholder: t('models.apiKeyPlaceholder'),
  keyBlank: t('models.keyBlank'),
  keyIllegal: t('models.keyIllegal'),
  customized: t('models.customized'),
  displayName: t('models.displayName'),
  baseUrl: t('models.baseUrl'),
  baseUrlDeepseekPlaceholder: 'https://api.deepseek.com',
  baseUrlPlaceholder: t('models.baseUrlDefault'),
  protocol: t('models.protocol'),
  protocolUnset: t('select.unselected'),
  models: t('models.catalog'),
  addModel: t('models.addModel'),
  fetchModels: t('models.fetchModels'),
  fetching: t('models.fetching'),
  fetchUnsupported: t('models.fetchUnsupported'),
  noListed: t('models.noListed'),
  noneAdded: t('models.noneAdded'),
  modelId: t('models.modelId'),
  modelName: t('models.displayName'),
  modelContext: t('models.context'),
  modelMax: t('models.maxOut'),
  modelReasoning: t('chat.reasoning'),
  modelReasoningOff: t('models.reasoningOff'),
  modelReasoningStandard: t('models.reasoningStandard'),
  modelReasoningCustom: t('models.reasoningCustom'),
  modelAdvanced: t('models.params'),
  removeModel: t('models.removeModel'),
  deleteProvider: t('common.delete'),
  customRoute: 'Provider ID',
  customRouteHint: t('models.routeHint'),
  customRouteInvalid: t('models.routeHint'),
  customRouteTaken: t('models.routeTaken'),
  customNeedsBaseUrl: t('models.needsBaseUrl'),
  customNeedsModels: t('models.needsModels'),
  createCustom: t('models.createProvider'),
  saving: t('common.saving'),
  creating: t('common.creating'),
  deleteTitle: t('models.deleteTitle'),
  deleteProviderAria: t('models.deleteAria'),
  editProviderAria: t('models.editAria'),
  candidateTitle: t('models.candidateTitle'),
  candidateDescription: t('models.candidateDesc'),
  candidateSelectAll: t('models.selectAll'),
  candidateDeselectAll: t('models.selectNone'),
  candidateAdopt: t('models.addSelected'),
  candidateClose: t('common.close'),
  conflict: t('models.conflict'),
  modelFailure: (index: number, message: string) => t('models.modelFailure', { n: index + 1, text: message }),
  modelIdRequired: t('models.idRequired'),
  modelIdDuplicate: t('models.idDuplicate'),
  modelNameInvalid: t('models.nameInvalid'),
  modelContextInvalid: t('models.contextInvalid'),
  modelMaxTokensInvalid: t('models.maxInvalid'),
  }
}

function modelFailureLabel(key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid' | 'modelMaxTokensInvalid'): string {
  return text()[key]
}

function targetLabel(row: ProviderRow): string {
  return row.entry.displayName
}

function formatTemplate(template: string, target: string): string {
  return template.replace('{provider}', target)
}

/* Top-level page state the section owns. The three card kinds each track
   their own draft; this object only records which card (if any) is open. */
type SectionState = {
  editing: ProviderRow | undefined
  adding: boolean
  declaring: boolean
  deleteTarget: ProviderRow | undefined
  dismissing: Set<string>
  savedNote: string | null
}

function emptySectionState(): SectionState {
  return { editing: undefined, adding: false, declaring: false, deleteTarget: undefined, dismissing: new Set(), savedNote: null }
}

/* The exported entry point. Builds the store once, subscribes to the
   store, and registers the host's invalidation listeners. The component
   delegates all rendering to `Loaded` once the store is ready. */
export function SettingsModelsSection(props: { ctx: ShellContext }): ReactNode {
  useLocale()
  const store = useMemo(
    () => new ModelsStore(props.ctx.connection.api, props.ctx.settingsScope.describe(), props.ctx.settingsSchema),
    [props.ctx],
  )

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    const refresh = () => store.refreshIfLoaded()
    // The remote bridge and the cordis context both expose `$on` / `on`
    // with the same `() => disposer` contract. Subscribe to all four
    // events, then return a single cleanup that disposes every handle.
    const disposers: Array<unknown> = []
    try {
      disposers.push(props.ctx.remote.$on('settings/document-updated', refresh))
    } catch { /* host may not forward this event in every mode */ }
    try {
      disposers.push(props.ctx.remote.$on('credentials/reference-updated', refresh))
    } catch { /* ignore */ }
    try {
      disposers.push(props.ctx.remote.$on('llm/adapters-updated', refresh))
    } catch { /* ignore */ }
    const ctxAny = props.ctx as unknown as { on?: (event: string, listener: () => void) => unknown }
    if (typeof ctxAny.on === 'function') {
      try { disposers.push(ctxAny.on('connection/reset', refresh)) } catch { /* ignore */ }
    }
    return () => {
      for (const handle of disposers) {
        if (typeof handle === 'function') {
          try { (handle as () => void)() } catch { /* ignore */ }
        }
      }
    }
  }, [props.ctx, store])

  useEffect(() => {
    void store.load()
  }, [store])

  return e(Loaded, { ctx: props.ctx, store, state })
}

/* Inner component: renders the page after the store is wired up. Owns the
   open-card bookkeeping and the delete confirmation target. */
function Loaded(props: { ctx: ShellContext; store: Store; state: Snapshot }): ReactNode {
  const { ctx, store, state } = props
  const [section, setSection] = useState<SectionState>(emptySectionState)

  if (state.status === 'idle' || state.status === 'loading') {
    return e('section', { className: 'models-page', 'aria-label': t('settings.models') },
      e(Header, {}),
      e('p', { className: 'models-status', role: 'status' }, text().loading),
    )
  }

  if (state.status === 'error') {
    const message = state.error ?? text().loadFailed
    return e('section', { className: 'models-page', 'aria-label': t('settings.models') },
      e(Header, {}),
      e('p', { className: 'models-error', role: 'alert' },
        `${text().loadFailed}：${message}`,
        e('button', { type: 'button', className: 'models-button', onClick: () => void store.load() }, text().retry),
      ),
    )
  }

  const writable = state.writable
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter((row) => row.configured)
  const addable = addableRows(state.rows)
  const piAiNamespace = state.namespaces.get('llm-pi-ai')
  const protocols = protocolChoices(piAiNamespace, ctx.settingsSchema)
  const addTarget = section.adding ? section.editing : undefined
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.entry.settingsNs)

  return e('section', { className: 'models-page', 'aria-label': t('settings.models') },
    e(Header, { note: section.savedNote }),
    !writable ? e('p', { className: 'models-notice', role: 'status' }, text().readOnly) : null,
    state.credentialError !== null
      ? e('p', { className: 'models-warning', role: 'status' },
          `${text().credentialErrorPrefix}${state.credentialError}`,
        )
      : null,
    e('ul', { className: 'models-rows' },
      configured.map((row) => {
        const target = row
        const namespace = state.namespaces.get(target.entry.settingsNs)
        if (namespace === undefined) return null
        const editing = !section.adding && section.editing?.entry.provider === target.entry.provider
        const wantsSetup = needsSetup(target, anyUsable) && !section.dismissing.has(target.entry.provider)
        if (wantsSetup) {
          return e('li', { key: target.entry.provider, className: 'models-row-card' },
            e(ProviderEditor, {
              ctx,
              store,
              namespace,
              row: target,
              hideTitle: false,
              setup: true,
              readOnly: !writable,
              onClose: (changed) => {
                setSection((current) => {
                  const dismissing = new Set(current.dismissing)
                  dismissing.add(target.entry.provider)
                  return {
                    ...current,
                    dismissing,
                    savedNote: changed ? text().saved : current.savedNote,
                  }
                })
              },
            }),
          )
        }
        return e('li', { key: target.entry.provider, className: 'models-row-card' },
          e(RowHead, {
            row: target,
            writable,
            open: editing,
            onEdit: () => {
              setSection((current) => ({
                ...current,
                editing: editing ? undefined : target,
                adding: false,
                declaring: false,
                savedNote: null,
              }))
            },
            onDelete: () => {
              setSection((current) => ({ ...current, deleteTarget: target, savedNote: null }))
            },
          }),
          editing ? e(ProviderEditor, {
            ctx,
            store,
            namespace,
            row: target,
            hideTitle: false,
            setup: false,
            readOnly: !writable,
            onClose: (changed) => {
              setSection((current) => ({
                ...current,
                editing: undefined,
                adding: false,
                declaring: false,
                savedNote: changed ? text().saved : current.savedNote,
              }))
            },
          }) : null,
        )
      }),
    ),
    addTarget !== undefined && addNamespace !== undefined
      ? e('div', { className: 'models-add-card' },
          e('div', { className: 'models-add-picker' },
            e('label', { className: 'models-field' },
              e('span', { className: 'models-field-label' }, t('models.provider')),
              e(Select, {
                value: addTarget.entry.provider,
                options: addable.map<SelectOption>((row) => ({ value: row.entry.provider, label: row.entry.displayName })),
                onChange: (provider) => {
                  const next = addable.find((row) => row.entry.provider === provider)
                  if (next === undefined) return
                  setSection((current) => ({ ...current, editing: next, adding: true }))
                },
                disabled: !writable,
                'aria-label': t('models.provider'),
              }),
            ),
          ),
          e(ProviderEditor, {
            ctx,
            store,
            namespace: addNamespace,
            row: addTarget,
            hideTitle: true,
            setup: false,
            readOnly: !writable,
            onClose: (changed) => {
              setSection((current) => ({
                ...current,
                editing: undefined,
                adding: false,
                declaring: false,
                savedNote: changed ? text().saved : current.savedNote,
              }))
            },
          }),
        )
      : section.declaring
        ? e('div', { className: 'models-add-card' },
            e(CustomProviderCard, {
              ctx,
              store,
              protocols,
              taken: state.rows.map((row) => row.entry.provider),
              readOnly: !writable,
              onClose: (changed) => {
                setSection((current) => ({
                  ...current,
                  declaring: false,
                  savedNote: changed ? text().saved : current.savedNote,
                }))
              },
            }),
          )
        : e('div', { className: 'models-add-actions' },
            e('button', {
              type: 'button',
              className: 'models-button',
              disabled: !writable || addable.length === 0,
              onClick: () => {
                const first = addable[0]
                if (first === undefined) return
                setSection({ ...emptySectionState(), editing: first, adding: true })
              },
            }, text().add),
            e('button', {
              type: 'button',
              className: 'models-button',
              disabled: !writable || protocols.length === 0,
              onClick: () => setSection({ ...emptySectionState(), declaring: true }),
            }, text().addCustom),
          ),
    section.deleteTarget !== undefined
      ? e(DeleteDialog, {
          row: section.deleteTarget,
          onCancel: () => setSection((current) => ({ ...current, deleteTarget: undefined })),
          onConfirm: () => {
            const target = section.deleteTarget
            if (target === undefined) return
            void removeProviderProfile(ctx, store, target)
              .then(() => setSection((current) => ({ ...current, deleteTarget: undefined, savedNote: text().saved })))
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error)
                setSection((current) => ({ ...current, deleteTarget: undefined, savedNote: message }))
              })
          },
        })
      : null,
  )
}

function Header(props: { note?: string | null }): ReactNode {
  return e('header', { className: 'models-header' },
    e('h2', { className: 'models-title' }, t('settings.models')),
    e('p', { className: 'models-intro' }, text().intro),
    props.note ? e('p', { className: 'models-saved', role: 'status' }, props.note) : null,
  )
}

function RowHead(props: {
  row: ProviderRow
  writable: boolean
  open: boolean
  onEdit(): void
  onDelete(): void
}): ReactNode {
  const { row, writable, open, onEdit, onDelete } = props
  const dot = credentialDot(row)
  const label = targetLabel(row)
  return e('div', { className: 'models-row-head' },
    e('div', { className: 'models-row-identity' },
      e('span', { className: 'models-row-name' }, label),
      row.entry.declared === true ? e('span', { className: 'models-row-tag' }, text().custom) : null,
      dot === 'configured'
        ? e('span', { className: 'models-credential-dot models-credential-dot-configured', role: 'img', 'aria-label': t('models.keyConfigured'), title: t('models.keyConfigured') })
        : dot === 'missing'
          ? e('span', { className: 'models-credential-dot models-credential-dot-missing', role: 'img', 'aria-label': t('models.keyMissing'), title: t('models.keyMissing') })
          : null,
    ),
    e('div', { className: 'models-row-actions' },
      e('button', {
        type: 'button',
        className: 'models-button',
        'aria-label': formatTemplate(text().editProviderAria, label),
        onClick: onEdit,
      }, text().edit),
      row.removable
        ? e('button', {
            type: 'button',
            className: 'models-button models-button-danger',
            'aria-label': formatTemplate(text().deleteProviderAria, label),
            disabled: !writable,
            onClick: onDelete,
          }, text().delete)
        : null,
      open ? null : e('span', { className: 'models-row-state', 'aria-hidden': open ? 'true' : 'false' }),
    ),
  )
}

/* Drop a user-added provider and (if its key is one this page owns) the
   matching stored credential. The unset lands first so a settings-rejected
   second step leaves the row visible and the operation safely retryable. */
async function removeProviderProfile(ctx: ShellContext, store: Store, row: ProviderRow): Promise<void> {
  const managedRef = managedCredentialRef(row)
  if (managedRef !== undefined) {
    const response = await ctx.connection.api.credentials.unset({ ref: managedRef })
    const result = rpcResult<Record<string, never>>(response)
    if (!result.ok) throw new Error(failureMessage(result))
  }
  const response = await ctx.connection.api.settings.mutate({
    ns: row.entry.settingsNs,
    ops: [{ op: 'unset', path: [...row.entry.settingsPath] }],
  })
  const result = rpcResult<SettingsNamespaceView>(response)
  if (!result.ok) throw new Error(failureMessage(result))
  await store.load()
}

/* The delete-confirmation dialog. The message changes depending on whether
   this page also owns the stored credential or only the configuration. */
function DeleteDialog(props: { row: ProviderRow; onCancel(): void; onConfirm(): void }): ReactNode {
  const managed = managedCredentialRef(props.row) !== undefined
  const message = managed ? text().confirmDeleteManage : text().confirmDeleteKeep
  return e(ConfirmDialog, {
    id: 'models-delete',
    title: formatTemplate(text().deleteTitle, targetLabel(props.row)),
    message,
    confirmLabel: text().delete,
    onCancel: props.onCancel,
    onConfirm: props.onConfirm,
  })
}

/* A single provider's editor card. Owns its own draft and key buffers so
   closing one card never discards a draft in another. */
function ProviderEditor(props: {
  ctx: ShellContext
  store: Store
  namespace: SettingsNamespaceView
  row: ProviderRow
  hideTitle: boolean
  setup: boolean
  readOnly: boolean
  onClose(changed: boolean): void
}): ReactNode {
  const { ctx, store, namespace, row, hideTitle, readOnly, onClose } = props
  const schema = ctx.settingsSchema
  const [draft, setDraft] = useState<ProfileDraft>(() => draftAt(schema, namespace, row.entry.settingsPath))
  const [committedOriginal, setCommittedOriginal] = useState<ProfileDraft>(() => {
    const value = schema.getPath(namespace.user, row.entry.settingsPath)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}
  })
  const [expectedRevision, setExpectedRevision] = useState<number>(namespace.revision)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<CredentialView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const keyRef = useMemo(
    () => refFor(namespace, row.entry.settingsPath, row.entry.provider, schema),
    [namespace, row, schema],
  )

  useEffect(() => {
    let stale = false
    void ctx.connection.api.credentials.describe({ refs: [keyRef] }).then((response) => {
      if (stale) return
      const result = rpcResult<{ credentials: Record<string, CredentialView> }>(response)
      if (result.ok) setKeyState(result.value.credentials[keyRef])
    })
    return () => {
      stale = true
    }
  }, [ctx, keyRef])

  const family = layoutOf(namespace.ns)
  const isPiAi = family === 'pi-ai'
  const isDeclared = row.entry.declared === true
  const protocols = useMemo(() => (isPiAi ? protocolChoices(namespace, schema) : []), [isPiAi, namespace, schema])
  const rootSchema = useMemo(() => schema.rehydrate(namespace.schema), [namespace, schema])
  const node = useMemo(
    () => schema.nodeAtPath(rootSchema, row.entry.settingsPath),
    [rootSchema, row, schema],
  )
  const fallback = useMemo(
    () => schema.getPath(namespace.value, row.entry.settingsPath),
    [namespace, row, schema],
  )
  const fallbackRecord = typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)
    ? (fallback as Record<string, unknown>)
    : undefined

  const setField = (key: string, raw: string): void => {
    const next = raw.trim().length === 0 ? undefined : raw
    setDraft((current) => (next === undefined ? schema.deletePath(current, [key]) : schema.setPath(current, [key], next)) as ProfileDraft)
  }
  const stringAt = (source: Record<string, unknown> | undefined, key: string): string | undefined => {
    if (source === undefined) return undefined
    const value = source[key]
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setModels = (next: Record<string, unknown>[]): void => {
    setDraft((current) => schema.setPath(current, ['models'], next) as ProfileDraft)
  }

  const modelsValue = schema.getPath(draft, ['models'])
  const models = modelDrafts(modelsValue)
  const modelFailure = validateModels(modelsValue)
  const modelFailureText = modelFailure === undefined ? null : text().modelFailure(modelFailure.index, modelFailureLabel(modelFailure.key))
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const isSetup = props.setup
  const showKeyFailure = keyFailure !== undefined ? keyFailure : undefined
  const keyLocked = keyState?.writable === false
  const keyPlaceholder = keyLocked
    ? text().apiKeyPlaceholderLocked
    : keyState?.configured === true
      ? text().apiKeyPlaceholderStored
      : isPiAi
        ? t('models.keyEnv')
        : text().apiKeyPlaceholder

  const setModelsRef = setModels

  const submit = async (): Promise<void> => {
    if (readOnly) return
    if (keyFailure !== undefined) return
    if (modelFailure !== undefined) return
    if (node === undefined) return
    setBusy(true)
    setFailure(undefined)
    try {
      const next = isPiAi
        && stringAt(draft, 'apiKeyEnv') === undefined
        && stringAt(fallbackRecord, 'apiKeyEnv') === undefined
        && keyValue.length > 0
        ? (schema.setPath(draft, ['apiKeyEnv'], keyRef) as ProfileDraft)
        : draft
      if (row.entry.settingsPath.length === 0 && node !== undefined) {
        const sectionError = schema.validate(node, next)
        if (sectionError !== undefined) {
          setFailure(sectionError)
          return
        }
      }
      const materializesNativeProfile = isPiAi
        && fallback === undefined
        && committedOriginal === undefined
        && Object.keys(next).length === 0
      let ops: SettingsPathOpView[]
      if (materializesNativeProfile) {
        ops = [{ op: 'set', path: [...row.entry.settingsPath], value: {} }]
      } else {
        const previous = committedOriginal
        ops = pathOps(row.entry.settingsPath, previous, next)
      }
      if (ops.length > 0) {
        const response = await ctx.connection.api.settings.mutate({
          ns: namespace.ns,
          ops,
          expectedRevision,
        })
        const result = rpcResult<SettingsNamespaceView>(response)
        if (!result.ok) {
          if (result.error?.code === 'settings-conflict') setFailure(text().conflict)
          else setFailure(failureMessage(result))
          return
        }
        store.acceptNamespaceView(result.value)
        setCommittedOriginal(typeof next === 'object' && next !== null ? { ...(next as Record<string, unknown>) } : {})
        setExpectedRevision(result.value.revision)
      }
      if (keyValue.length > 0) {
        const response = await ctx.connection.api.credentials.set({ ref: keyRef, value: keyValue })
        const result = rpcResult<Record<string, never>>(response)
        if (!result.ok) {
          setFailure(failureMessage(result))
          return
        }
      }
      setKeyDraft('')
      onClose(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (node === undefined) {
    return e('div', { className: 'models-editor' },
      e('p', { className: 'models-warning' }, t('models.pathUnresolvable', { ns: namespace.ns })),
    )
  }

  return e('div', { className: 'models-editor' },
    hideTitle ? null : e('div', { className: 'models-editor-header' },
      e('span', { className: 'models-editor-title' }, row.entry.displayName),
      row.entry.displayName !== row.entry.provider
        ? e('span', { className: 'models-editor-route' }, row.entry.provider)
        : null,
    ),
    e('div', { className: 'models-field' },
      e('span', { className: 'models-field-label' }, text().apiKey),
      e('input', {
        type: 'password',
        autoComplete: 'off',
        className: 'models-input',
        value: keyDraft,
        placeholder: keyPlaceholder,
        'aria-label': text().apiKey,
        'aria-invalid': showKeyFailure !== undefined,
        disabled: readOnly || busy || keyLocked,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setKeyDraft(event.target.value),
      }),
      showKeyFailure === undefined
        ? null
        : e('p', { className: 'models-warning', role: 'alert' },
            showKeyFailure === 'keyBlank' ? text().keyBlank : text().keyIllegal,
          ),
    ),
    e('details', { className: 'models-customized' },
      e('summary', { className: 'models-customized-summary' }, text().customized),
      e('div', { className: 'models-customized-body' },
        isDeclared ? e('div', { className: 'models-field' },
          e('span', { className: 'models-field-label' }, text().displayName),
          e('input', {
            type: 'text',
            className: 'models-input',
            value: stringAt(draft, 'displayName') ?? '',
            placeholder: stringAt(fallbackRecord, 'displayName') ?? row.entry.provider,
            'aria-label': text().displayName,
            disabled: readOnly || busy,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setField('displayName', event.target.value),
          }),
        ) : null,
        e('div', { className: 'models-field' },
          e('span', { className: 'models-field-label' }, text().baseUrl),
          e('input', {
            type: 'text',
            className: 'models-input',
            value: stringAt(draft, 'baseURL') ?? '',
            placeholder: family === 'deepseek' ? text().baseUrlDeepseekPlaceholder : text().baseUrlPlaceholder,
            'aria-label': text().baseUrl,
            disabled: readOnly || busy,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setField('baseURL', event.target.value),
          }),
        ),
        isPiAi && isDeclared ? e('div', { className: 'models-field' },
          e('span', { className: 'models-field-label' }, text().protocol),
          e(Select, {
            value: stringAt(draft, 'api') ?? '',
            options: [
              { value: '', label: text().protocolUnset },
              ...protocols.map<SelectOption>((value) => ({ value, label: value })),
            ],
            onChange: (value) => setField('api', value),
            disabled: readOnly || busy,
            'aria-label': text().protocol,
            placeholder: text().protocolUnset,
          }),
        ) : null,
        e(ModelListEditor, {
          ctx,
          models,
          settingsNs: namespace.ns,
          provider: row.entry.provider,
          baseURL: stringAt(draft, 'baseURL') ?? stringAt(fallbackRecord, 'baseURL'),
          api: isPiAi ? stringAt(draft, 'api') ?? stringAt(fallbackRecord, 'api') : undefined,
          apiKey: keyValue.length > 0 ? keyValue : undefined,
          disabled: readOnly || busy,
          onChange: setModelsRef,
          t: text(),
        }),
      ),
    ),
    failure !== undefined ? e('p', { className: 'models-warning', role: 'alert' }, failure) : null,
    isSetup || keyFailure === undefined && modelFailure === undefined
      ? e('div', { className: 'models-editor-actions' },
          e('button', { type: 'button', className: 'models-button', disabled: busy, onClick: () => onClose(false) }, text().cancel),
          e('button', {
            type: 'button',
            className: 'models-button models-button-primary',
            disabled: readOnly || busy || keyFailure !== undefined || modelFailure !== undefined,
            onClick: () => void submit(),
          }, busy ? text().saving : t('common.save')),
        )
      : null,
    modelFailureText !== null ? e('p', { className: 'models-warning', role: 'alert' }, modelFailureText) : null,
  )
}

/* Model-list editor shared by the editing and creating cards. Local state
   owns the per-row capacity keystroke buffer and the candidate picker. */
function ModelListEditor(props: {
  ctx: ShellContext
  models: Record<string, unknown>[]
  settingsNs: string
  provider: string
  baseURL: string | undefined
  api: string | undefined
  apiKey: string | undefined
  disabled?: boolean
  onChange(models: Record<string, unknown>[]): void
  t: ReturnType<typeof text>
}): ReactNode {
  const { ctx, models, onChange, settingsNs, provider, baseURL, api, apiKey, disabled = false, t } = props
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<DiscoveredModelView[] | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())

  const fetchable = (provider !== '' || (baseURL !== undefined && baseURL.length > 0)) && apiKey === undefined || apiKey !== undefined

  const patch = (index: number, next: Record<string, unknown>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      const cleared: string[] = []
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '') cleared.push(key)
      }
      const merged = { ...model, ...next } as Record<string, unknown>
      for (const key of cleared) delete merged[key]
      return merged
    }))
  }
  const remove = (index: number): void => {
    onChange(models.filter((_, at) => at !== index))
    setExpanded((current) => {
      const next = new Set<number>()
      for (const at of current) {
        if (at === index) continue
        next.add(at > index ? at - 1 : at)
      }
      return next
    })
  }
  const toggle = (index: number): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }
  const add = (): void => {
    onChange([...models, { id: '' }])
  }

  const fetch = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await ctx.connection.api.llm.discoverModels({
        settingsNs,
        ...(provider !== '' ? { provider } : {}),
        ...(baseURL !== undefined && baseURL.length > 0 ? { baseURL } : {}),
        ...(api !== undefined ? { api } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
      })
      const result = rpcResult<{ models: DiscoveredModelView[] }>(response)
      if (!result.ok) {
        setFailure(failureMessage(result))
        return
      }
      if (result.value.models.length === 0) {
        setFailure(t.noListed)
        return
      }
      const known = new Set(models.map((model) => (typeof model['id'] === 'string' ? (model['id'] as string) : '')))
      setCandidates(result.value.models)
      setPicked(new Set(result.value.models.filter((model) => !known.has(model.id)).map((model) => model.id)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 协议不支持自动发现时,host 返回 model-discovery-failed,message 已经可读;
      // 其它失败同样显示 message,以免用户被空白卡住。
      if (/discovery|not support|不支持/.test(message)) setFailure(t.fetchUnsupported)
      else setFailure(message)
    } finally {
      setBusy(false)
    }
  }
  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }
  const adoptPicked = (): void => {
    if (candidates === undefined) return
    const byId = new Map<string, Record<string, unknown>>()
    for (const model of models) {
      const id = model['id']
      if (typeof id === 'string') byId.set(id, model)
    }
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      const next: Record<string, unknown> = { id: candidate.id }
      if (candidate.name !== undefined) next['name'] = candidate.name
      if (candidate.contextWindow !== undefined) next['contextWindow'] = candidate.contextWindow
      if (candidate.maxTokens !== undefined) next['maxTokens'] = candidate.maxTokens
      byId.set(candidate.id, next)
    }
    onChange([...byId.values()])
    closePicker()
  }
  const togglePick = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allPicked = candidates !== undefined && candidates.length > 0 && candidates.every((candidate) => picked.has(candidate.id))
  const toggleAll = (): void => {
    if (candidates === undefined) return
    setPicked((current) => {
      if (candidates.every((candidate) => current.has(candidate.id))) return new Set()
      return new Set(candidates.map((candidate) => candidate.id))
    })
  }

  return e('section', { className: 'models-catalog', 'aria-label': t.models },
    e('div', { className: 'models-catalog-head' },
      e('span', { className: 'models-catalog-title' }, t.models),
      e('button', {
        type: 'button',
        className: 'models-button',
        disabled: disabled || busy || !fetchable,
        onClick: () => void fetch(),
      }, busy ? t.fetching : t.fetchModels),
    ),
    models.length === 0
      ? e('p', { className: 'models-empty' }, t.noneAdded)
      : null,
    models.map((model, index) => e('div', { key: `${index}-${typeof model['id'] === 'string' ? model['id'] : ''}`, className: 'models-catalog-entry' },
      e('div', { className: 'models-catalog-row' },
        e('input', {
          type: 'text',
          className: 'models-input models-input-id',
          value: typeof model['id'] === 'string' ? (model['id'] as string) : '',
          placeholder: t.modelId,
          'aria-label': `${t.modelId} ${index + 1}`,
          disabled,
          onChange: (event: ChangeEvent<HTMLInputElement>) => patch(index, { id: event.target.value }),
        }),
        e('input', {
          type: 'text',
          className: 'models-input models-input-name',
          value: typeof model['name'] === 'string' ? (model['name'] as string) : '',
          placeholder: t.modelName,
          'aria-label': `${t.modelName} ${index + 1}`,
          disabled,
          onChange: (event: ChangeEvent<HTMLInputElement>) => patch(index, { name: event.target.value === '' ? undefined : event.target.value }),
        }),
        e('button', {
          type: 'button',
          className: 'models-button models-button-icon',
          'aria-label': `${t.modelAdvanced} ${index + 1}`,
          'aria-expanded': expanded.has(index),
          onClick: () => toggle(index),
        }, expanded.has(index) ? '▾' : '▸'),
        e('button', {
          type: 'button',
          className: 'models-button models-button-icon models-button-danger',
          'aria-label': `${t.removeModel} ${index + 1}`,
          disabled,
          onClick: () => remove(index),
        }, '×'),
      ),
      expanded.has(index) ? e('div', { className: 'models-catalog-advanced' },
        e('label', { className: 'models-field models-field-row' },
          e('span', { className: 'models-field-label' }, t.modelContext),
          e('input', {
            type: 'number',
            className: 'models-input',
            min: 1,
            step: 1,
            value: typeof model['contextWindow'] === 'number' ? String(model['contextWindow']) : '',
            placeholder: '256000',
            'aria-label': `${t.modelContext} ${index + 1}`,
            disabled,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const raw = event.target.value
              if (raw === '') patch(index, { contextWindow: undefined })
              else {
                const n = Number(raw)
                patch(index, { contextWindow: Number.isFinite(n) ? n : raw })
              }
            },
          }),
        ),
        e('label', { className: 'models-field models-field-row' },
          e('span', { className: 'models-field-label' }, t.modelMax),
          e('input', {
            type: 'number',
            className: 'models-input',
            min: 1,
            step: 1,
            value: typeof model['maxTokens'] === 'number' ? String(model['maxTokens']) : '',
            placeholder: '8192',
            'aria-label': `${t.modelMax} ${index + 1}`,
            disabled,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const raw = event.target.value
              if (raw === '') patch(index, { maxTokens: undefined })
              else {
                const n = Number(raw)
                patch(index, { maxTokens: Number.isFinite(n) ? n : raw })
              }
            },
          }),
        ),
        e('label', { className: 'models-field models-field-row' },
          e('span', { className: 'models-field-label' }, t.modelReasoning),
          e(Select, {
            value: reasoningChoiceOf(model),
            options: [
              { value: 'off', label: t.modelReasoningOff },
              { value: 'standard', label: t.modelReasoningStandard },
              ...(reasoningChoiceOf(model) === 'custom' ? [{ value: 'custom', label: t.modelReasoningCustom }] : []),
            ],
            disabled,
            'aria-label': `${t.modelReasoning} ${index + 1}`,
            onChange: (choice) => {
              // custom 只在读取手写配置时出现,不可由此写入;切回其它档位才会落盘。
              if (choice === 'custom') return
              patch(index, { reasoningEfforts: reasoningEffortsFor(choice as ReasoningChoice) })
            },
          }),
        ),
      ) : null,
    )),
    e('button', {
      type: 'button',
      className: 'models-button models-button-add',
      disabled,
      onClick: add,
    }, `+ ${t.addModel}`),
    failure !== undefined ? e('p', { className: 'models-warning', role: 'alert' }, failure) : null,
    candidates !== undefined ? e('div', { className: 'file-dialog-overlay models-overlay', role: 'dialog', 'aria-modal': true, 'aria-label': t.candidateTitle, onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker() }
    } },
      e('div', { className: 'file-dialog models-candidate-dialog' },
        e('header', null,
          e('h2', null, t.candidateTitle),
          e('p', { className: 'models-candidate-description' }, t.candidateDescription),
          e('button', { type: 'button', className: 'models-button', onClick: closePicker }, t.candidateClose),
        ),
        e('div', { className: 'models-candidate-actions' },
          e('button', { type: 'button', className: 'models-button', onClick: toggleAll }, allPicked ? t.candidateDeselectAll : t.candidateSelectAll),
        ),
        e('ul', { className: 'models-candidate-list' },
          candidates.map((candidate) => e('li', { key: candidate.id, className: 'models-candidate' },
            e('label', { className: 'models-candidate-label' },
              e('input', {
                type: 'checkbox',
                checked: picked.has(candidate.id),
                onChange: () => togglePick(candidate.id),
              }),
              e('span', { className: 'models-candidate-id' }, candidate.id),
              candidate.name !== undefined ? e('span', { className: 'models-candidate-name' }, candidate.name) : null,
            ),
          )),
        ),
        e('footer', null,
          e('button', { type: 'button', className: 'models-button', onClick: closePicker }, t.cancel),
          e('button', { type: 'button', className: 'models-button models-button-primary', onClick: adoptPicked }, t.candidateAdopt),
        ),
      ),
    ) : null,
  )
}

/* The custom-provider creation card. A separate component so the create
   card and the edit card never share state; each owns one keyDraft and
   one model list, both gone the moment either card closes. */
function CustomProviderCard(props: {
  ctx: ShellContext
  store: Store
  protocols: string[]
  taken: string[]
  readOnly: boolean
  onClose(changed: boolean): void
}): ReactNode {
  const { ctx, store, protocols, taken, readOnly, onClose } = props
  const piAiNamespace = ctx.settingsScope.describe().getSnapshot().view?.namespaces.find((view) => view.ns === 'llm-pi-ai')
  const revision = piAiNamespace?.revision ?? 0
  const [route, setRoute] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [protocol, setProtocol] = useState<string>(protocols[0] ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState<Record<string, unknown>[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [committed, setCommitted] = useState(false)

  const routeInvalid = routeFailure(route, taken)
  const modelFailure = validateModels(models)
  const keyFailure = apiKeyFailure(keyDraft)
  const keyValue = keyDraft.trim()
  const ready =
    route.length > 0 &&
    routeInvalid === undefined &&
    baseURL.trim().length > 0 &&
    models.length > 0 &&
    modelFailure === undefined &&
    keyFailure === undefined

  const submit = async (): Promise<void> => {
    if (readOnly || !ready) return
    setBusy(true)
    setFailure(undefined)
    try {
      const keyRef = deriveKeyRef(route)
      const storesKey = keyValue.length > 0
      if (!committed) {
        const profile: Record<string, unknown> = {
          api: protocol,
          baseURL,
          models: models.map((model) => ({ ...model })),
        }
        if (displayName.trim().length > 0) profile['displayName'] = displayName.trim()
        if (storesKey) profile['apiKeyEnv'] = keyRef
        const response = await ctx.connection.api.settings.mutate({
          ns: 'llm-pi-ai',
          ops: [{ op: 'set', path: ['providers', route], value: profile }],
          expectedRevision: revision,
        })
        const result = rpcResult<SettingsNamespaceView>(response)
        if (!result.ok) {
          if (result.error?.code === 'settings-conflict') setFailure(text().conflict)
          else setFailure(failureMessage(result))
          return
        }
        store.acceptNamespaceView(result.value)
        setCommitted(true)
      }
      if (storesKey) {
        const response = await ctx.connection.api.credentials.set({ ref: deriveKeyRef(route), value: keyValue })
        const result = rpcResult<Record<string, never>>(response)
        if (!result.ok) {
          setFailure(failureMessage(result))
          return
        }
      }
      onClose(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return e('div', { className: 'models-editor' },
    e('div', { className: 'models-editor-header' },
      e('span', { className: 'models-editor-title' }, t('models.customProvider')),
    ),
    e('div', { className: 'models-field' },
      e('span', { className: 'models-field-label' }, text().customRoute),
      e('input', {
        type: 'text',
        className: 'models-input',
        value: route,
        placeholder: 'acme-gateway',
        'aria-label': text().customRoute,
        'aria-invalid': routeInvalid !== undefined,
        disabled: readOnly || busy || committed,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setRoute(event.target.value),
      }),
    ),
    routeInvalid !== undefined
      ? e('p', { className: 'models-warning', role: 'alert' },
          routeInvalid === 'routeInvalid' ? text().customRouteInvalid : text().customRouteTaken,
        )
      : e('p', { className: 'models-hint' }, text().customRouteHint),
    e('div', { className: 'models-field' },
      e('span', { className: 'models-field-label' }, text().displayName),
      e('input', {
        type: 'text',
        className: 'models-input',
        value: displayName,
        placeholder: route.length > 0 ? route : text().displayName,
        'aria-label': text().displayName,
        disabled: readOnly || busy || committed,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value),
      }),
    ),
    e('div', { className: 'models-field' },
      e('span', { className: 'models-field-label' }, text().baseUrl),
      e('input', {
        type: 'text',
        className: 'models-input',
        value: baseURL,
        placeholder: 'https://gateway.example/v1',
        'aria-label': text().baseUrl,
        disabled: readOnly || busy || committed,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setBaseURL(event.target.value),
      }),
    ),
    e('div', { className: 'models-field' },
      e('span', { className: 'models-field-label' }, text().protocol),
      e(Select, {
        value: protocol,
        options: protocols.map<SelectOption>((value) => ({ value, label: value })),
        onChange: setProtocol,
        disabled: readOnly || busy || committed,
        'aria-label': text().protocol,
      }),
    ),
    e('div', { className: 'models-field' },
      e('span', { className: 'models-field-label' }, text().apiKey),
      e('input', {
        type: 'password',
        autoComplete: 'off',
        className: 'models-input',
        value: keyDraft,
        placeholder: text().apiKeyPlaceholder,
        'aria-label': text().apiKey,
        'aria-invalid': keyFailure !== undefined,
        disabled: readOnly || busy,
        onChange: (event: ChangeEvent<HTMLInputElement>) => setKeyDraft(event.target.value),
      }),
      keyFailure === undefined
        ? null
        : e('p', { className: 'models-warning', role: 'alert' },
            keyFailure === 'keyBlank' ? text().keyBlank : text().keyIllegal,
          ),
    ),
    e(ModelListEditor, {
      ctx,
      models,
      settingsNs: 'llm-pi-ai',
      provider: route,
      baseURL,
      api: protocol,
      apiKey: keyValue.length > 0 ? keyValue : undefined,
      disabled: readOnly || busy || committed,
      onChange: setModels,
      t: text(),
    }),
    e('div', { className: 'models-hint' },
      baseURL.trim().length === 0 ? text().customNeedsBaseUrl
        : models.length === 0 ? text().customNeedsModels
          : null,
    ),
    modelFailure !== undefined
      ? e('p', { className: 'models-warning', role: 'alert' },
          text().modelFailure(modelFailure.index, modelFailureLabel(modelFailure.key)),
        )
      : null,
    failure !== undefined ? e('p', { className: 'models-warning', role: 'alert' }, failure) : null,
    e('div', { className: 'models-editor-actions' },
      e('button', { type: 'button', className: 'models-button', disabled: busy, onClick: () => onClose(false) }, text().cancel),
      e('button', {
        type: 'button',
        className: 'models-button models-button-primary',
        disabled: readOnly || busy || !ready,
        onClick: () => void submit(),
      }, busy ? text().creating : text().createCustom),
    ),
  )
}
