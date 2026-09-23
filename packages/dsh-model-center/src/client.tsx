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
export const inject = ['slots', 'connection', 'remote', 'remote.llm', 'remote.settings', 'remote.session', 'remote.credentials', 'configForms', 'settingsSchema'] as const

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
  configForms?: { describe?: () => { getSnapshot?: () => unknown; ensure?: () => Promise<unknown> } }
  settingsSchema?: { getPath?(value: unknown, path: string[]): unknown }
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(spec: SlotSpec, render: unknown): () => void
  }
}

const COMMON_PURPOSES = ['chat', 'manuscript.completion', 'manuscript.rewrite']

export function presetLabel(role: ModelRole, locale: ModelCenterLocale): string {
  const text = copy(locale)
  return role === 'normal' ? text.defaultPreset : role === 'weak' ? text.efficientPreset : role === 'strong' ? text.qualityPreset : text.fantasyPreset
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
    if (MODEL_ROLES.includes(role)) return { kind: 'role', role }
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
  const [savedPolicy, setSavedPolicy] = useState('')
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
      configForms: props.client.configForms,
      settingsSchema: props.client.settingsSchema,
      signal,
    }, () => stillCurrent(token, gate, signal))
    if (!stillCurrent(token, gate, signal) || !snapshot) return
    setPolicy(snapshot.policy)
    setSavedPolicy(JSON.stringify(editablePolicy(snapshot.policy)))
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
        dirty={JSON.stringify(editablePolicy(draft)) !== savedPolicy}
        policy={draft}
        catalog={catalog}
        rows={rows}
        resolved={resolved}
        renderChatModel={props.renderChatModel}
        onRoles={roles => { setNote(''); setPolicy({ ...draft, roles }) }}
        onPurpose={(id, target) => { setNote(''); setPolicy({ ...draft, purposes: { ...draft.purposes, [id]: target } }) }}
        onSave={saveDraft}
      /> : <p role="alert">{text.policyMissing}</p>}
    </div>
    <div role="tabpanel" id={`${tabsId}-runtime-panel`} aria-labelledby={`${tabsId}-runtime-tab`} hidden={tab !== 'runtime'} tabIndex={0}>
      {draft ? <RuntimePanel locale={locale} busy={busy} limits={draft.limits}
        onLimits={limits => { setNote(''); setPolicy({ ...draft, limits }) }} onSave={saveDraft} /> : <p role="alert">{text.policyMissing}</p>}
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

export function PolicyPanel(props: {
  locale: ModelCenterLocale
  busy: boolean
  dirty?: boolean
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
  const rows = [...COMMON_PURPOSES.flatMap(id => props.rows.filter(row => row.id === id)), ...props.rows.filter(row => !COMMON_PURPOSES.includes(row.id))]
  const describe = (route: ModelRoute) => {
    const selected = choiceOf(catalogChoices(props.catalog, route), route.provider, route.model)
    const effort = route.reasoningEffort ?? selected?.defaultEffort
    return (selected?.label ?? formatRoute(route)) + (effort ? ' · ' + reasoningLabel(effort, selected?.efforts.find(item => item.id === effort)?.name ?? effort, props.locale) : '')
  }
  return <div className="model-center-policy">
    <section className="model-center-tier-section" aria-label={text.roles}>
      <header><h3>{text.roles}</h3></header>
      <fieldset className="model-center-tiers" disabled={props.busy} aria-label={text.roles}>
        {props.catalog.groups.length ? <div className="model-center-tier-head" aria-hidden="true"><span /><span>{text.model}</span><span>{text.effort}</span></div> : null}
        {MODEL_ROLES.map(role => {
          const route = props.policy.roles[role] ?? { provider: '', model: '' }
          const label = presetLabel(role, props.locale)
          return <div key={role} className="model-center-tier" data-tier={role}>
            <div className="model-center-tier-name"><strong>{label}</strong></div>
            <RouteFields locale={props.locale} route={route} disabled={props.busy}
              catalog={props.catalog} ariaPrefix={label}
              emptyLabel={role === 'normal' ? text.chooseModel : text.followDefault}
              onChange={next => {
                const roles = { ...props.policy.roles }
                if (!next.provider && !next.model && !next.reasoningEffort) delete roles[role]
                else roles[role] = next
                props.onRoles(roles)
              }} />
          </div>
        })}
      </fieldset>
    </section>
    <section className="model-center-capabilities" aria-label={text.capabilities}>
      <header><h3>{text.capabilities}</h3><p className="model-center-meta">{text.capabilityHint}</p></header>
      <fieldset disabled={props.busy} aria-label={text.capabilities}>
        {rows.length === 0 ? <p className="model-center-meta">{text.noPurposes}</p> : rows.map(row => {
          const label = purposeLabel(row.id, row.label, props.locale)
          const preview = previewResolve(props.policy, row.id, { specs: props.rows })
          const custom = row.target.kind === 'model'
          const value = custom ? 'custom' : purposeTargetValue(row.target)
          return <div key={row.id} className="model-center-capability" data-purpose={row.id}>
            <div className="model-center-capability-heading">
              <label htmlFor={'capability-' + row.id}>{label}</label>
              <select id={'capability-' + row.id} aria-label={label + ' ' + text.useModel} value={value}
                onChange={event => {
                  if (event.target.value === 'custom') {
                    const route = preview.ok ? preview.route : props.policy.roles.normal ?? props.catalog.default ?? { provider: '', model: '' }
                    props.onPurpose(row.id, { kind: 'model', provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) })
                  } else props.onPurpose(row.id, purposeTargetFromValue(event.target.value))
                }}>
                {MODEL_ROLES.map(role => <option key={role} value={'role:' + role}>{presetLabel(role, props.locale)}</option>)}
                <option value="custom">{text.explicit}</option>
                {row.id !== 'chat' ? <option value="session">{text.followSession}</option> : null}
              </select>
            </div>
            {custom ? <RouteFields locale={props.locale} route={row.target as ModelRoute} disabled={props.busy}
              catalog={props.catalog} ariaPrefix={label} onChange={route => props.onPurpose(row.id, { kind: 'model', ...route })} />
              : row.target.kind === 'role' ? <p className="model-center-meta model-center-route-summary">{preview.ok ? describe(preview.route) : text.notConfigured}</p> : null}
          </div>
        })}
      </fieldset>
    </section>
    <div className="model-center-savebar">
      <button type="button" disabled={props.busy || props.dirty === false} onClick={props.onSave}>{text.save}</button>
      {props.dirty ? <span className="model-center-meta" role="status">{text.unsaved}</span> : null}
    </div>
  </div>
}

function reasoningLabel(id: string, name: string, locale: ModelCenterLocale): string {
  if (locale === 'en') return name
  return ({ off: '关', none: '关', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' } as Record<string, string>)[id] ?? name
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
  return <div className="model-center-route" data-catalog={hasCatalog}>
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
      <select value={props.route.reasoningEffort ?? ''} disabled={props.disabled || !key}
        aria-label={`${props.ariaPrefix} ${text.effort}`}
        onChange={event => props.onChange(withEffort(props.route, event.target.value))}>
        <option value="">{defaultLabel}</option>
        {efforts.map(item => <option key={item.id} value={item.id}>{reasoningLabel(item.id, item.name, props.locale)}</option>)}
      </select>
    </label>
  </div>
}


export const styles = `
.model-center{max-width:760px;display:grid;gap:20px;color:inherit;font:400 var(--font-size-2,14px)/1.5 var(--default-font-family,system-ui,sans-serif)}
.model-center p,.model-center h3{margin:0}
.model-center-meta,.model-center small{font-size:var(--font-size-1,13px);color:var(--gray-11,inherit)}
.model-center-error{color:var(--red-11,#b42318)}
.model-center-tabs{display:flex;gap:20px;border-bottom:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent))}
.model-center-tabs button[role="tab"]{padding:8px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--gray-11,inherit);font:inherit;cursor:pointer;transition:color 150ms ease,border-color 150ms ease}
.model-center-tabs button[role="tab"]:hover{color:inherit}
.model-center-tabs button[aria-selected="true"]{border-bottom-color:var(--accent-9,#3b82f6);color:var(--accent-11,inherit);font-weight:600}
.model-center [role="tabpanel"]{border-radius:12px}
.model-center fieldset{margin:0;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:10px;padding:12px;display:grid;gap:12px}
.model-center label{display:grid;gap:6px}
.model-center input,.model-center select{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--gray-6,color-mix(in srgb,currentColor 22%,transparent));border-radius:8px;background:var(--color-surface,transparent);color:inherit;font:inherit;transition:border-color 150ms ease,box-shadow 150ms ease}
.model-center input:focus,.model-center select:focus{border-color:var(--accent-9,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent-9,#3b82f6) 25%,transparent)}
.model-center button{min-height:34px;padding:6px 12px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font:inherit;justify-self:start;transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease,box-shadow 150ms ease,transform 150ms ease}
.model-center button:not([role="tab"]):hover:not(:disabled){background:var(--gray-3,color-mix(in srgb,currentColor 6%,transparent));border-color:color-mix(in srgb,currentColor 35%,transparent)}
.model-center button:not([role="tab"]):active:not(:disabled){transform:scale(.97)}
.model-center button:disabled{opacity:.45;cursor:not-allowed}
.model-center :focus-visible{outline:2px solid var(--accent-9,currentColor);outline-offset:3px}
.model-center-list,.model-center-models{margin:0;padding:0;list-style:none;display:grid;gap:12px}
.model-center-list>li{display:grid;gap:8px;padding:12px 4px;border-top:1px solid var(--gray-6,color-mix(in srgb,currentColor 15%,transparent));border-radius:10px}
.model-center-provider-head,.model-center-actions,.model-center-route{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.model-center-route label{flex:1 1 160px}
.model-center-policy,.model-center-runtime{display:grid;gap:24px}
.model-center-limits{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px}
.model-center-tier-section,.model-center-capabilities{display:grid;gap:14px}
.model-center header{display:grid;gap:4px}
.model-center h3{font-size:16px;font-weight:600}
.model-center .model-center-tiers,.model-center-capabilities>fieldset{padding:0;border:0;border-radius:0;gap:0;min-width:0}
.model-center-tier{display:grid;grid-template-columns:68px minmax(0,1fr);gap:4px 14px;padding:8px 0;border-bottom:1px solid var(--gray-6)}
.model-center-tier-name{padding-top:9px}
.model-center-tier .model-center-route{display:grid;grid-template-columns:minmax(0,1fr) 132px;align-items:start}
.model-center-tier .model-center-route label{font-size:12px;color:var(--gray-11)}
.model-center-tier-head{display:grid;grid-template-columns:68px minmax(0,1fr) 132px;gap:14px;font-size:12px;color:var(--gray-11)}
.model-center-tier .model-center-route[data-catalog="true"]>label{font-size:0;gap:0}
.model-center-tier .model-center-route select,.model-center-tier .model-center-route input{font-size:14px;color:var(--gray-12)}
.model-center-capability{display:grid;gap:10px;padding:14px 0;border-bottom:1px solid var(--gray-6)}
.model-center-capability-heading{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:16px;align-items:center}
.model-center-capability-heading>label{font-weight:500}
.model-center-route-summary{overflow-wrap:anywhere}
.model-center-savebar{position:sticky;bottom:0;display:flex;align-items:center;gap:14px;padding:12px 0;background:var(--color-panel-solid,var(--gray-1));border-top:1px solid var(--gray-6);z-index:1}
.model-center-savebar button{background:var(--accent-9);color:var(--accent-contrast,white);border-color:transparent;min-width:80px}
.model-center .model-center-savebar button:hover:not(:disabled){background:var(--accent-10,var(--accent-9,#3b82f6))}
@media(max-width:560px){.model-center-tier-head{display:none}.model-center-tier .model-center-route[data-catalog="true"]>label{font-size:12px;gap:6px}.model-center-tier{grid-template-columns:1fr}.model-center-tier-name{padding-top:0}.model-center-capability-heading{grid-template-columns:minmax(0,1fr) 150px}}
@media(max-width:560px){.model-center-limits{grid-template-columns:minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.model-center button,.model-center input,.model-center select,.model-center-tabs button[role="tab"]{transition:none}}
`
