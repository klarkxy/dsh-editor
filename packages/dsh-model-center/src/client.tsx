import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { purposeLabel } from './catalogue.ts'
import {
  MODEL_ROLES, type AiPolicy, type DiscoveredModel, type ModelCenterLocale, type ModelCenterRenderProps,
  type ModelCenterTab, type ModelRole, type ModelRoute, type ModelTarget, type ProviderListing, type RegisteredPurpose,
  type ResolvedRoute,
} from './contracts.ts'
import {
  centerLabel, copy, hostChannel, isHostEnabledStatus, readHostEnabled, registerExclusiveSettingsSeats, tabLabel,
  tablistKey, unwrapRpc, type SlotSpec,
} from './client-view.ts'
import { loadModelCenter, savePolicyUpdate, stillCurrent, createGenerationGate } from './load.ts'
import {
  catalogChoices, choiceOf, effortOptions, emptyCatalog, parseRouteKey, routeKey, type SessionModelCatalog,
} from './model-catalog.ts'
import { formatRoute, previewResolve, purposeRows } from './policy.ts'
import {
  authLabel, canDiscoverModels, canOpenSettingsDocument, nativeSettingsNote, shouldLoadNativeProviders,
} from './providers.ts'
import { LIMIT_BOUNDS, editablePolicy } from './schema.ts'

export const name = 'dsh-model-center-client'
export const inject = ['slots', 'connection', 'remote', 'remote.llm', 'remote.settings', 'remote.session', 'remote.credentials', 'settingsScope', 'settingsSchema'] as const

interface CredentialsRemote {
  describe(refs: string[]): Promise<unknown>
}
interface LlmRemote {
  listConfigurableProviders(): Promise<unknown>
  listProviders?(): Promise<unknown>
  discoverModels?(settingsNs: string, request: unknown, signal?: AbortSignal): Promise<unknown>
}
interface SettingsRemote {
  openSettingsDocument?(signal?: AbortSignal): Promise<unknown>
}
export interface ModelCenterClient {
  connection: { rpc: { call(channel: string, endpoint: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> } }
  remote: {
    llm: LlmRemote
    settings: SettingsRemote
    session: { modelCatalog(): Promise<unknown> }
    credentials?: CredentialsRemote
  }
  settingsScope?: { describe?: () => { getSnapshot?: () => unknown; ensure?: () => Promise<unknown> } }
  settingsSchema?: { getPath?(value: unknown, path: string[]): unknown }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: SlotSpec, render: unknown): () => void
  }
}

const COMMON_PURPOSES = new Set(['manuscript.completion', 'manuscript.rewrite'])

export function presetLabel(role: ModelRole, locale: ModelCenterLocale): string {
  const text = copy(locale)
  return role === 'normal' ? text.defaultPreset : role === 'weak' ? text.efficientPreset : text.qualityPreset
}

export function purposeTargetValue(target: ModelTarget): string {
  if (target.kind === 'session') return 'session'
  if (target.kind === 'role') return `role:${target.role}`
  return `model:${routeKey(target.provider, target.model)}`
}

export function purposeTargetFromValue(value: string): ModelTarget {
  if (value === 'session') return { kind: 'session' }
  if (value.startsWith('role:')) {
    const role = value.slice(5) as ModelRole
    if (role === 'normal' || role === 'weak' || role === 'strong') return { kind: 'role', role }
  }
  if (value.startsWith('model:')) {
    const parsed = parseRouteKey(value.slice(6))
    if (parsed) return { kind: 'model', ...parsed }
  }
  return { kind: 'role', role: 'normal' }
}

export function registerModelCenterSlots(
  client: ModelCenterClient,
  render: (props: ModelCenterRenderProps) => ReactNode,
  locale: ModelCenterLocale = 'zh',
): () => void {
  return registerExclusiveSettingsSeats(client.slots, render, locale)
}

export async function activateClientUi(
  client: ModelCenterClient,
  cancelled: () => boolean,
  signal?: AbortSignal,
): Promise<() => void> {
  const enabled = await readHostEnabled((channel, endpoint, payload, next) => (
    client.connection.rpc.call(channel, endpoint, payload, next ?? signal)
  ), signal)
  if (cancelled() || signal?.aborted || !shouldAttach(enabled)) return () => {}
  return registerModelCenterSlots(client, props => <ModelCenterSettings client={client} {...props} />)
}

export function shouldAttach(enabled: boolean): boolean {
  return enabled === true
}

export function apply(ctx: Context): void {
  const client = ctx as unknown as ModelCenterClient
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style')
    style.setAttribute('data-plugin', name)
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'model-center.styles')
  ctx.effect(() => {
    const controller = new AbortController()
    let disposeSlots = () => {}
    void activateClientUi(client, () => controller.signal.aborted, controller.signal).then(dispose => {
      if (controller.signal.aborted) { dispose(); return }
      disposeSlots = dispose
    })
    return () => { controller.abort(); disposeSlots() }
  }, 'model-center.ui')
}

export function ModelCenterSettings(props: ModelCenterRenderProps & { client: ModelCenterClient }): ReactNode {
  const locale: ModelCenterLocale = props.locale === 'en' ? 'en' : 'zh'
  const text = copy(locale)
  const tabsId = useId()
  const generation = useRef(createGenerationGate())
  const [tab, setTab] = useState<ModelCenterTab>('policy')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [policy, setPolicy] = useState<AiPolicy>()
  const [purposes, setPurposes] = useState<RegisteredPurpose[]>([])
  const [providers, setProviders] = useState<ProviderListing[]>([])
  const [resolved, setResolved] = useState<Record<string, ResolvedRoute | { error: string }>>({})
  const [catalog, setCatalog] = useState<SessionModelCatalog>(emptyCatalog())
  const [discovered, setDiscovered] = useState<Record<string, DiscoveredModel[]>>({})
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined)
  const [storageFailed, setStorageFailed] = useState(false)
  const hostedProviders = !shouldLoadNativeProviders(props.renderProviders)

  async function hostStatus(signal?: AbortSignal): Promise<boolean> {
    return isHostEnabledStatus(await props.client.connection.rpc.call(hostChannel(), 'status', {}, signal))
  }

  async function load(token: number, signal: AbortSignal): Promise<void> {
    const gate = generation.current
    const live = await hostStatus(signal)
    if (!stillCurrent(token, gate, signal)) return
    setEnabled(live)
    if (!live) {
      setError(text.hostOff)
      return
    }
    const snapshot = await loadModelCenter({
      call: (channel, endpoint, payload, next) => props.client.connection.rpc.call(channel, endpoint, payload, next ?? signal),
      sessionId: props.sessionId,
      loadProviders: !hostedProviders,
      llm: props.client.remote.llm,
      credentials: props.client.remote.credentials,
      session: props.client.remote.session,
      settingsScope: props.client.settingsScope,
      settingsSchema: props.client.settingsSchema,
      signal,
    }, () => stillCurrent(token, gate, signal))
    if (!stillCurrent(token, gate, signal) || !snapshot) return
    setPolicy(snapshot.policy)
    setPurposes(snapshot.purposes)
    setProviders(snapshot.providers)
    setResolved(snapshot.resolved)
    setCatalog(snapshot.catalog)
    setStorageFailed(snapshot.storageFailed)
  }

  useEffect(() => {
    const token = generation.current.next()
    const controller = new AbortController()
    setError('')
    setNote('')
    void load(token, controller.signal).catch(cause => {
      if (!stillCurrent(token, generation.current, controller.signal)) return
      setError(cause instanceof Error ? cause.message : text.policyMissing)
    })
    return () => {
      controller.abort()
      generation.current.next()
    }
  }, [props.client, props.sessionId, locale, hostedProviders])

  async function action(run: () => Promise<void>): Promise<void> {
    const token = generation.current.current()
    const signal = new AbortController().signal
    setBusy(true); setNote(''); setError('')
    try {
      await run()
    } catch (cause) {
      if (!stillCurrent(token, generation.current, signal)) return
      setError(cause instanceof Error ? cause.message : text.policyMissing)
    } finally {
      if (stillCurrent(token, generation.current, signal)) setBusy(false)
    }
  }

  if (enabled === false) {
    return <section className="model-center" aria-label={centerLabel(locale)}>
      <p role="status">{text.hostOff}</p>
    </section>
  }
  if (!policy && enabled === undefined) {
    return <section className="model-center" aria-label={centerLabel(locale)}>
      <p role="status">{error || text.loading}</p>
      <button type="button" onClick={() => {
        const token = generation.current.next()
        const controller = new AbortController()
        void action(() => load(token, controller.signal))
      }}>{text.reconnect}</button>
    </section>
  }

  const draft = policy
  const rows = draft ? purposeRows(draft, purposes) : []
  const saveDraft = () => {
    if (!draft) return
    void action(async () => {
      const token = generation.current.current()
      const result = await savePolicyUpdate(
        (channel, endpoint, payload, signal) => props.client.connection.rpc.call(channel, endpoint, payload, signal),
        { expectedRevision: draft.revision, policy: editablePolicy(draft) },
        () => generation.current.isCurrent(token),
      )
      if (!generation.current.isCurrent(token)) return
      if (!result.ok) {
        if (result.reason === 'stale') return
        throw new Error(result.reason === 'conflict' ? text.revisionConflict : result.error)
      }
      setPolicy(result.policy)
      const reload = generation.current.current()
      await load(reload, new AbortController().signal)
      if (!generation.current.isCurrent(reload)) return
      setNote(text.saved)
    })
  }

  return <section className="model-center" data-testid="model-center" aria-label={centerLabel(locale)}>
    <div className="model-center-tabs" role="tablist" aria-label={centerLabel(locale)} onKeyDown={event => {
      const next = tablistKey(tab, event.key)
      if (!next) return
      event.preventDefault()
      setTab(next)
      const button = event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
      button?.focus()
    }}>
      {(['policy', 'runtime', 'providers'] as const).map(key => (
        <button key={key} type="button" role="tab" data-tab={key} id={`${tabsId}-${key}-tab`}
          aria-controls={`${tabsId}-${key}-panel`} aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{tabLabel(key, locale)}</button>
      ))}
    </div>
    {storageFailed ? <p role="alert" className="model-center-error">{text.storageFailed}</p> : null}
    {error ? <p role="alert" className="model-center-error">{error}</p> : null}
    {note ? <p role="status">{note}</p> : null}
    <div role="tabpanel" id={`${tabsId}-providers-panel`} aria-labelledby={`${tabsId}-providers-tab`} hidden={tab !== 'providers'} tabIndex={0}>
      <ProvidersPanel
        locale={locale}
        busy={busy}
        providers={providers}
        discovered={discovered}
        renderProviders={props.renderProviders}
        canDiscover={canDiscoverModels(props.client.remote.llm)}
        canOpenNative={canOpenSettingsDocument(props.client.remote.settings)}
        onDiscover={row => void action(async () => {
          if (!props.client.remote.llm.discoverModels) throw new Error(text.noProviders)
          const token = generation.current.current()
          const result = unwrapRpc<DiscoveredModel[]>(await props.client.remote.llm.discoverModels(row.settingsNs, { provider: row.id }))
          if (!generation.current.isCurrent(token)) return
          setDiscovered(current => ({ ...current, [row.id]: Array.isArray(result) ? result : [] }))
        })}
        onOpenNative={() => void action(async () => {
          unwrapRpc(await props.client.remote.settings.openSettingsDocument?.())
        })}
      />
    </div>
    <div role="tabpanel" id={`${tabsId}-policy-panel`} aria-labelledby={`${tabsId}-policy-tab`} hidden={tab !== 'policy'} tabIndex={0}>
      {draft ? <PolicyPanel
        locale={locale}
        busy={busy}
        policy={draft}
        catalog={catalog}
        rows={rows}
        resolved={resolved}
        renderChatModel={props.renderChatModel}
        onRoles={roles => setPolicy({ ...draft, roles })}
        onPurpose={(id, target) => setPolicy({ ...draft, purposes: { ...draft.purposes, [id]: target } })}
        onSave={saveDraft}
      /> : <p role="alert">{text.policyMissing}</p>}
    </div>
    <div role="tabpanel" id={`${tabsId}-runtime-panel`} aria-labelledby={`${tabsId}-runtime-tab`} hidden={tab !== 'runtime'} tabIndex={0}>
      {draft ? <RuntimePanel locale={locale} busy={busy} limits={draft.limits}
        onLimits={limits => setPolicy({ ...draft, limits })} onSave={saveDraft} /> : <p role="alert">{text.policyMissing}</p>}
    </div>
  </section>
}

function ProvidersPanel(props: {
  locale: ModelCenterLocale
  busy: boolean
  providers: ProviderListing[]
  discovered: Record<string, DiscoveredModel[]>
  renderProviders?: (options?: { includeWritingRoutes?: boolean }) => unknown
  canDiscover: boolean
  canOpenNative: boolean
  onDiscover(row: ProviderListing): void
  onOpenNative(): void
}): ReactNode {
  const text = copy(props.locale)
  const hosted = typeof props.renderProviders === 'function'
    ? props.renderProviders({ includeWritingRoutes: false })
    : undefined
  return <div className="model-center-providers">
    {hosted !== undefined && hosted !== null ? hosted as ReactNode : <>
      <p className="model-center-meta">{nativeSettingsNote(props.locale)}</p>
      {props.providers.length === 0 ? <p className="model-center-meta">{text.noProviders}</p> : <ul className="model-center-list">
        {props.providers.map(row => {
          const models = props.discovered[row.id] ?? []
          return <li key={row.id}>
            <div className="model-center-provider-head">
              <strong>{row.displayName}</strong>
              <span>{row.live ? text.live : text.dormant}</span>
              <span>{authLabel(row.auth, props.locale)}</span>
            </div>
            {row.error ? <p role="alert" className="model-center-error">{row.error}</p> : null}
            {row.settingsNs ? <p className="model-center-meta">{row.settingsNs}{row.settingsPath.length ? ` / ${row.settingsPath.join('/')}` : ''}</p> : null}
            {row.credentialRef ? <p className="model-center-meta">{row.credentialRef}</p> : null}
            <div className="model-center-actions">
              {props.canDiscover && row.settingsNs ? <button type="button" disabled={props.busy}
                aria-label={`${text.discovery} ${row.displayName}`}
                onClick={() => props.onDiscover(row)}>{text.discovery}</button> : null}
            </div>
            {models.length ? <ul className="model-center-models" aria-label={`${row.displayName} ${text.model}`}>
              {models.map(model => <li key={model.id}>{model.name ? `${model.name} (${model.id})` : model.id}</li>)}
            </ul> : null}
          </li>
        })}
      </ul>}
      {props.canOpenNative ? <button type="button" disabled={props.busy} onClick={props.onOpenNative}>{text.openNative}</button> : null}
    </>}
  </div>
}

function RuntimePanel(props: {
  locale: ModelCenterLocale
  busy: boolean
  limits: AiPolicy['limits']
  onLimits(limits: AiPolicy['limits']): void
  onSave(): void
}): ReactNode {
  const text = copy(props.locale)
  const limits = [
    ['concurrency', text.concurrency, LIMIT_BOUNDS.concurrency.min, LIMIT_BOUNDS.concurrency.max],
    ['timeoutMs', text.timeout, LIMIT_BOUNDS.timeoutMs.min, LIMIT_BOUNDS.timeoutMs.max],
    ['maxInputChars', text.maxInput, LIMIT_BOUNDS.maxInputChars.min, LIMIT_BOUNDS.maxInputChars.max],
    ['maxOutputTokens', text.maxOutput, LIMIT_BOUNDS.maxOutputTokens.min, LIMIT_BOUNDS.maxOutputTokens.max],
    ['maxAttempts', text.retryLimit, LIMIT_BOUNDS.maxAttempts.min, LIMIT_BOUNDS.maxAttempts.max],
  ] as const
  return <div className="model-center-runtime">
    <fieldset className="model-center-limits" disabled={props.busy} aria-label={text.limits}>
      <legend>{text.limits}</legend>
      {limits.map(([key, label, min, max]) => (
        <label key={key}>{label}
          <input type="number" min={min} max={max} step={1} value={props.limits[key]}
            aria-label={label}
            onChange={event => props.onLimits({ ...props.limits, [key]: Number(event.target.value) })} />
        </label>
      ))}
    </fieldset>
    <button type="button" disabled={props.busy} onClick={props.onSave}>{text.save}</button>
  </div>
}

function PolicyPanel(props: {
  locale: ModelCenterLocale
  busy: boolean
  policy: AiPolicy
  catalog: SessionModelCatalog
  rows: ReturnType<typeof purposeRows>
  resolved: Record<string, ResolvedRoute | { error: string }>
  renderChatModel?: () => unknown
  onRoles(roles: AiPolicy['roles']): void
  onPurpose(id: string, target: ModelTarget): void
  onSave(): void
}): ReactNode {
  const text = copy(props.locale)
  const commonRows = props.rows.filter(row => COMMON_PURPOSES.has(row.id))
  const otherRows = props.rows.filter(row => !COMMON_PURPOSES.has(row.id))
  const purposeRow = (row: ReturnType<typeof purposeRows>[number]) => {
    const label = purposeLabel(row.id, row.label, props.locale)
    const choices = catalogChoices(props.catalog, row.target.kind === 'model' ? row.target : undefined)
    const value = purposeTargetValue(row.target)
    const options = [
      { value: 'session', label: text.followSession },
      { value: 'role:normal', label: text.followDefault },
      { value: 'role:weak', label: text.followEfficient },
      { value: 'role:strong', label: text.followQuality },
      ...choices.map(item => ({ value: `model:${routeKey(item.provider, item.model)}`, label: item.label })),
    ]
    if (row.target.kind === 'model' && !options.some(option => option.value === value)) {
      options.push({ value, label: formatRoute(row.target) })
    }
    return <div key={row.id} className="model-center-purpose-row">
      <label>
        <span>{label}</span>
        <select aria-label={`${label} ${text.useModel}`} value={value}
          onChange={event => props.onPurpose(row.id, purposeTargetFromValue(event.target.value))}>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {row.target.kind === 'model' ? <ReasoningField
        locale={props.locale}
        route={row.target}
        catalog={props.catalog}
        disabled={props.busy}
        ariaPrefix={label}
        onChange={next => props.onPurpose(row.id, { kind: 'model', ...next })} /> : null}
      <RouteProblem view={props.resolved[row.id]} fallbackPurpose={row.id}
        target={row.target} policy={props.policy} specs={props.rows} />
    </div>
  }
  return <div className="model-center-policy">
    <fieldset className="model-center-common" disabled={props.busy} aria-label={text.commonModels}>
      <legend>{text.commonModels}</legend>
      {typeof props.renderChatModel === 'function' ? props.renderChatModel() as ReactNode : null}
      {commonRows.map(purposeRow)}
    </fieldset>
    <details className="model-center-secondary">
      <summary>{text.otherModels}</summary>
      <fieldset disabled={props.busy} aria-label={text.otherModels}>
        <legend className="sr-only">{text.otherModels}</legend>
        {otherRows.length === 0 ? <p className="model-center-meta">{text.noPurposes}</p> : otherRows.map(purposeRow)}
      </fieldset>
    </details>
    <details className="model-center-advanced">
      <summary>{text.advanced}</summary>
      <div className="model-center-advanced-body">
        <fieldset disabled={props.busy} aria-label={text.roles}>
          <legend>{text.roles}</legend>
          {MODEL_ROLES.map(role => {
            const route = props.policy.roles[role] ?? { provider: '', model: '' }
            const label = presetLabel(role, props.locale)
            return <div key={role} className="model-center-role">
              <strong>{label}</strong>
              <RouteFields locale={props.locale} route={route} disabled={props.busy}
                catalog={props.catalog} ariaPrefix={label}
                emptyLabel={role === 'normal' ? text.chooseModel : text.followDefault}
                onChange={next => {
                  const roles = { ...props.policy.roles }
                  if (role !== 'normal' && (!next.provider.trim() || !next.model.trim())) delete roles[role]
                  else roles[role] = next
                  props.onRoles(roles)
                }} />
            </div>
          })}
        </fieldset>
      </div>
    </details>
    <button type="button" disabled={props.busy} onClick={props.onSave}>{text.save}</button>
  </div>
}

function withEffort(route: ModelRoute, reasoningEffort: string): ModelRoute {
  return reasoningEffort ? { ...route, reasoningEffort } : { provider: route.provider, model: route.model }
}

function RouteFields(props: {
  locale: ModelCenterLocale
  route: ModelRoute
  disabled: boolean
  catalog: SessionModelCatalog
  ariaPrefix: string
  emptyLabel?: string
  onChange(route: ModelRoute): void
}): ReactNode {
  const text = copy(props.locale)
  const choices = catalogChoices(props.catalog, props.route)
  const selected = choiceOf(choices, props.route.provider, props.route.model)
  const efforts = effortOptions(selected, props.route.reasoningEffort)
  const key = props.route.provider && props.route.model ? routeKey(props.route.provider, props.route.model) : ''
  const hasCatalog = choices.length > 0
  const defaultLabel = selected?.defaultEffort
    ? `${text.defaultEffort} (${selected.defaultEffort})`
    : text.defaultEffort
  const exactFields = <>
    {hasCatalog ? <>
      <label>{text.provider}
        <input value={props.route.provider} disabled={props.disabled}
          aria-label={`${props.ariaPrefix} ${text.provider}`}
          onChange={event => props.onChange({ ...props.route, provider: event.target.value })} />
      </label>
      <label>{text.exactModel}
        <input value={props.route.model} disabled={props.disabled}
          aria-label={`${props.ariaPrefix} ${text.exactModel}`}
          onChange={event => props.onChange({ ...props.route, model: event.target.value })} />
      </label>
    </> : null}
    <label>{text.exactEffort}
      <input value={props.route.reasoningEffort ?? ''} disabled={props.disabled}
        aria-label={`${props.ariaPrefix} ${text.exactEffort}`}
        onChange={event => props.onChange(withEffort(props.route, event.target.value))} />
    </label>
  </>
  return <div className="model-center-route">
    {hasCatalog ? <label>{text.catalog}
      <select value={key} disabled={props.disabled} aria-label={`${props.ariaPrefix} ${text.catalog}`}
        onChange={event => {
          const parsed = parseRouteKey(event.target.value)
          if (!parsed) {
            props.onChange({ provider: '', model: '' })
            return
          }
          props.onChange(withEffort({ provider: parsed.provider, model: parsed.model }, props.route.reasoningEffort ?? ''))
        }}>
        <option value="">{props.emptyLabel ?? text.chooseModel}</option>
        {choices.map(item => (
          <option key={routeKey(item.provider, item.model)} value={routeKey(item.provider, item.model)}>{item.label}</option>
        ))}
      </select>
    </label> : <>
      <label>{text.provider}
        <input value={props.route.provider} disabled={props.disabled}
          aria-label={`${props.ariaPrefix} ${text.provider}`}
          onChange={event => props.onChange({ ...props.route, provider: event.target.value })} />
      </label>
      <label>{text.model}
        <input value={props.route.model} disabled={props.disabled}
          aria-label={`${props.ariaPrefix} ${text.model}`}
          onChange={event => props.onChange({ ...props.route, model: event.target.value })} />
      </label>
    </>}
    <label>{text.effort}
      <select value={props.route.reasoningEffort ?? ''} disabled={props.disabled}
        aria-label={`${props.ariaPrefix} ${text.effort}`}
        onChange={event => props.onChange(withEffort(props.route, event.target.value))}>
        <option value="">{defaultLabel}</option>
        {efforts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <details className="model-center-exact">
      <summary>{text.exactIds}</summary>
      <div className="model-center-route">{exactFields}</div>
    </details>
  </div>
}

function ReasoningField(props: {
  locale: ModelCenterLocale
  route: ModelRoute
  disabled: boolean
  catalog: SessionModelCatalog
  ariaPrefix: string
  onChange(route: ModelRoute): void
}): ReactNode {
  const text = copy(props.locale)
  const selected = choiceOf(catalogChoices(props.catalog, props.route), props.route.provider, props.route.model)
  const efforts = effortOptions(selected, props.route.reasoningEffort)
  const defaultLabel = selected?.defaultEffort
    ? `${text.defaultEffort} (${selected.defaultEffort})`
    : text.defaultEffort
  return <label className="model-center-effort">{text.effort}
    <select value={props.route.reasoningEffort ?? ''} disabled={props.disabled}
      aria-label={`${props.ariaPrefix} ${text.effort}`}
      onChange={event => props.onChange(withEffort(props.route, event.target.value))}>
      <option value="">{defaultLabel}</option>
      {efforts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </label>
}

function RouteProblem(props: {
  view: ResolvedRoute | { error: string } | undefined
  fallbackPurpose: string
  target: ModelTarget
  policy: AiPolicy
  specs: ReturnType<typeof purposeRows>
}): ReactNode {
  if (props.target.kind !== 'model') return null
  const view = props.view ?? previewToView(previewResolve(props.policy, props.fallbackPurpose, { specs: props.specs }))
  if ('error' in view) return <p role="alert" className="model-center-error">{view.error}</p>
  const local = previewResolve(props.policy, props.fallbackPurpose, { specs: props.specs })
  const conflict = !local.ok ? local.error : local.conflict
  return conflict ? <p role="alert" className="model-center-error">{conflict}</p> : null
}

function previewToView(preview: ReturnType<typeof previewResolve>): ResolvedRoute | { error: string } {
  return preview.ok ? preview.route : { error: preview.error }
}

const styles = `
.model-center{max-width:760px;display:grid;gap:20px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.model-center p,.model-center h3{margin:0}
.model-center-meta,.model-center small{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.model-center-error{color:var(--red-11,#b42318)}
.model-center-tabs{display:flex;gap:20px;border-bottom:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.model-center-tabs button[role="tab"]{padding:8px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--gray-11,inherit);font:inherit;cursor:pointer}
.model-center-tabs button[aria-selected="true"]{border-bottom-color:var(--accent-9,#3b82f6);color:var(--accent-11,inherit);font-weight:600}
.model-center fieldset{margin:0;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:8px;padding:12px;display:grid;gap:12px}
.model-center label{display:grid;gap:6px}
.model-center input,.model-center select{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:6px;background:var(--color-surface,transparent);color:inherit;font:inherit}
.model-center button{min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start}
.model-center button:disabled{opacity:.45;cursor:not-allowed}
.model-center :focus-visible{outline:2px solid currentColor;outline-offset:3px}
.model-center-list,.model-center-models{margin:0;padding:0;list-style:none;display:grid;gap:12px}
.model-center-list>li{display:grid;gap:8px;padding:12px 0;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.model-center-provider-head,.model-center-actions,.model-center-route{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.model-center-route label{flex:1 1 160px}
.model-center-policy,.model-center-runtime,.model-center-advanced-body{display:grid;gap:16px}
.model-center-purpose-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 12px;padding:4px 0}
.model-center-purpose-row>label:first-child{flex:1 1 320px}
.model-center-purpose-row>.model-center-effort{flex:0 1 180px}
.model-center-purpose-row>.model-center-error{flex:1 1 100%}
.model-center-secondary>summary,.model-center-advanced>summary{cursor:pointer;font-weight:600;padding:6px 0}
.model-center-secondary>fieldset{margin-top:12px}
.model-center-advanced-body{padding-top:12px}
.model-center-limits{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px}
.model-center-role{display:grid;gap:8px}
.model-center-exact{flex:1 1 100%}
.model-center-exact summary{cursor:pointer}
@media(max-width:560px){.model-center-limits{grid-template-columns:minmax(0,1fr)}}
`
