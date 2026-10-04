import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Callout, Flex, Heading, Text, TextField } from '@radix-ui/themes'
import type { AiPolicy, ModelRole, ModelTarget, PurposeSpec, RpcResult } from '@klarkxy/dsh-ai-services/contracts'
import type { ConnectionHandle, SettingsScope } from '../dsh-compat.ts'
import {
  normalizeWritingModelRoute,
  type WritingModelRoute,
  type WritingPreferences,
} from '../writing-settings.tsx'
import { Select, type SelectOption } from './select.tsx'
import { effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'
import { ActivityText, Button } from './ui/index.ts'
import { t, useLocale } from '../i18n/index.ts'

function effortOptions(model: CatalogModelOption | undefined, current?: string): SelectOption[] {
  const options = (model?.efforts ?? []).map(item => ({ value: item.id, label: effortDisplay(item.id) || item.name }))
  if (current && !options.some(item => item.value === current)) options.push({ value: current, label: effortDisplay(current) || current })
  return options
}

export type CatalogModelOption = {
  provider: string
  model: string
  label: string
  efforts?: readonly { id: string; name: string }[]
}

const ROUTE_SEP = '\u001f'

export function mergeCatalogOptions(...lists: CatalogModelOption[][]): CatalogModelOption[] {
  const options: CatalogModelOption[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.provider}${ROUTE_SEP}${item.model}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push(item)
    }
  }
  return options
}

export function catalogFromSessionGroups(groups: ReadonlyArray<{ id: string; name: string; models: ReadonlyArray<{ id: string; name: string; reasoning?: { efforts: readonly { id: string; name: string }[] } }> }>): CatalogModelOption[] {
  return groups.flatMap((group) => group.models.map((model) => ({
    provider: group.id,
    model: model.id,
    efforts: model.reasoning?.efforts,
    label: `${group.name} · ${model.name}`,
  })))
}

/** First catalog model whose provider can actually serve requests. */
export function firstUsableCatalogModel(
  catalog: readonly CatalogModelOption[],
  usableProviders: Iterable<string>,
): CatalogModelOption | undefined {
  const usable = new Set(usableProviders)
  if (usable.size === 0) return undefined
  return catalog.find((item) => usable.has(item.provider))
}

function routeKey(route: WritingModelRoute): string {
  return `${route.provider}${ROUTE_SEP}${route.model}`
}

function parseRouteKey(value: string): WritingModelRoute | undefined {
  if (!value) return undefined
  const split = value.indexOf(ROUTE_SEP)
  if (split <= 0) return undefined
  return normalizeWritingModelRoute({
    provider: value.slice(0, split),
    model: value.slice(split + ROUTE_SEP.length),
  })
}

function optionFor(route: WritingModelRoute, catalog: CatalogModelOption[], fallbackLabel: string): SelectOption {
  const key = routeKey(route)
  const found = catalog.find((item) => item.provider === route.provider && item.model === route.model)
  if (found) return { value: key, label: found.label }
  const label = route.provider && route.model ? `${route.provider} · ${route.model}` : route.model || route.provider
  return { value: key, label: t('models.missingModel', { label: label || fallbackLabel }) }
}

export function WritingModelRoutes(props: {
  connection: ConnectionHandle
  scope: SettingsScope<WritingPreferences>
  catalog: CatalogModelOption[]
  writable: boolean
  showSharedPurposes?: boolean
}): ReactNode {
  return <SharedWritingRoutes connection={props.connection} catalog={props.catalog} writable={props.writable}
    chatOnly={props.showSharedPurposes === false} />
}


export const WRITING_PURPOSES = [
  { id: 'chat', label: 'models.chatModel' },
  { id: 'manuscript.completion', label: 'models.completionModel' },
  { id: 'manuscript.rewrite', label: 'models.rewriteModel' },
] as const

export function writingPurposeUpdate(policy: AiPolicy, purpose: string, target: ModelTarget) {
  const { revision, ...data } = policy
  return { expectedRevision: revision, policy: { ...data, purposes: { ...data.purposes, [purpose]: target } } }
}

/** CAS payload for a role (tier) edit; purposes and limits pass through untouched. */
export function writingRolesUpdate(policy: AiPolicy, roles: AiPolicy['roles']) {
  const { revision, ...data } = policy
  return { expectedRevision: revision, policy: { ...data, roles } }
}

/** CAS payload for a runtime-limits edit; roles and purposes pass through untouched. */
export function writingLimitsUpdate(policy: AiPolicy, limits: AiPolicy['limits']) {
  const { revision, ...data } = policy
  return { expectedRevision: revision, policy: { ...data, limits } }
}

/** Keep unrelated limit edits while rejecting a newer conflicting value in an edited field. */
export function runtimeLimitsUpdate(policy: AiPolicy, desired: AiPolicy['limits'], base: AiPolicy['limits']) {
  const merged = { ...policy.limits }
  for (const key of Object.keys(desired) as Array<keyof AiPolicy['limits']>) {
    if (desired[key] === base[key]) continue
    if (policy.limits[key] !== base[key] && policy.limits[key] !== desired[key]) throw new Error('运行设置已被其他窗口修改。请选择使用最新设置或保留草稿。')
    merged[key] = desired[key]
  }
  return writingLimitsUpdate(policy, merged)
}

/**
 * Reasoning effort carried onto a route the target dropdown just moved to.
 * Re-picking the same provider+model keeps the stored effort untouched; a
 * different model only keeps an effort its catalog entry advertises, so a
 * previous model's effort is never carried blindly, including explicit
 * `off`/`none` ids that the destination must support.
 */
export function carriedReasoningEffort(
  previous: ModelTarget,
  next: WritingModelRoute,
  catalog: readonly CatalogModelOption[],
): string | undefined {
  if (previous.kind !== 'model') return undefined
  const effort = previous.reasoningEffort
  if (!effort) return undefined
  if (previous.provider === next.provider && previous.model === next.model) return effort
  const entry = catalog.find((item) => item.provider === next.provider && item.model === next.model)
  return entry?.efforts?.some((item) => item.id === effort) ? effort : undefined
}

/** A purpose registered through ai-services (`status.purposes`). */
export type RegisteredPurpose = PurposeSpec & { plugin: string }

export type WritingPolicySnapshot = {
  policy: AiPolicy | undefined
  purposes: RegisteredPurpose[]
  storageFailed: boolean
  failure: string
  saving: boolean
}

type PolicyCall = <T>(endpoint: string, payload: unknown) => Promise<T>

type PolicyStatus = { policy: AiPolicy; purposes?: RegisteredPurpose[]; storageFailed?: boolean }

type PolicyUpdatePayload = { expectedRevision: number; policy: Omit<AiPolicy, 'revision'> }

/**
 * Projection of the authoritative `/dsh-ai-services` policy plus the pending
 * CAS save, owned per connection. Lifecycle guarantees:
 * - every in-flight load/save carries a generation token; `invalidate()`
 *   (effect cleanup on unmount or connection swap) makes old continuations
 *   lose, so a stale connection never writes the live view;
 * - loads started while a save is pending are deferred, then re-run after the
 *   save settles — recovery always converges on the backend truth;
 * - a failed refresh never erases the last good projection, so a successful
 *   save stays successful even when a later projection read fails;
 * - `saving` is cleared unconditionally in the save's `finally`: an old save
 *   can never leave a newer view permanently saving.
 */
export class WritingPolicyStore {
  private snapshot: WritingPolicySnapshot = { policy: undefined, purposes: [], storageFailed: false, failure: '', saving: false }
  private listeners = new Set<() => void>()
  private generation = 0
  private pending = false
  private queuedRefresh = false

  constructor(
    private readonly call: PolicyCall,
    private readonly fallbackMessage: () => string,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): WritingPolicySnapshot => this.snapshot

  private emit(patch: Partial<WritingPolicySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private message(error: unknown): string {
    return error instanceof Error && error.message ? error.message : this.fallbackMessage()
  }

  private applyStatus(status: PolicyStatus): void {
    this.emit({ policy: status.policy, purposes: status.purposes ?? [], storageFailed: status.storageFailed === true })
  }

  async load(): Promise<void> {
    if (this.pending) {
      this.queuedRefresh = true
      return
    }
    const token = ++this.generation
    try {
      const status = await this.call<PolicyStatus>('status', {})
      if (token !== this.generation) return
      this.applyStatus(status)
      this.emit({ failure: '' })
    } catch (error) {
      if (token !== this.generation) return
      this.emit({ failure: this.message(error) })
    }
  }

  /**
   * The single CAS path. `build` derives the payload from the live projection;
   * the backend owns conflict rejection, and a rejected save resyncs from
   * `status` so the projection converges without losing the failure message.
   */
  async update(build: (policy: AiPolicy) => PolicyUpdatePayload): Promise<boolean> {
    const policy = this.snapshot.policy
    if (this.pending || !policy) return false
    this.pending = true
    const token = ++this.generation
    this.emit({ saving: true, failure: '' })
    try {
      const next = await this.call<AiPolicy>('update', build(policy))
      if (token !== this.generation) return false
      this.emit({ policy: next })
      return true
    } catch (error) {
      if (token === this.generation) {
        this.emit({ failure: this.message(error) })
        try {
          const status = await this.call<PolicyStatus>('status', {})
          if (token === this.generation) this.applyStatus(status)
        } catch { /* resync failed: keep the last projection; the failure and retry stay visible */ }
      }
      return false
    } finally {
      this.pending = false
      this.emit({ saving: false })
      if (this.queuedRefresh) {
        this.queuedRefresh = false
        void this.load()
      }
    }
  }

  async save(purpose: string, target: ModelTarget): Promise<void> {
    await this.update((policy) => writingPurposeUpdate(policy, purpose, target))
  }

  async saveRoles(roles: AiPolicy['roles']): Promise<void> {
    await this.update((policy) => writingRolesUpdate(policy, roles))
  }

  async saveLimits(limits: AiPolicy['limits'], base?: AiPolicy['limits']): Promise<boolean> {
    return this.update((policy) => runtimeLimitsUpdate(policy, limits, base ?? policy.limits))
  }

  reload(): void {
    this.emit({ failure: '' })
    void this.load()
  }

  invalidate(): void {
    this.generation++
    this.queuedRefresh = false
  }
}

/** One policy store per mounted surface; load on mount, refresh on focus, invalidate on cleanup. */
export function useWritingPolicy(connection: ConnectionHandle): { store: WritingPolicyStore; snapshot: WritingPolicySnapshot } {
  const store = useMemo(() => new WritingPolicyStore(
    async <T,>(endpoint: string, payload: unknown): Promise<T> => {
      const result = await connection.rpc.call('/dsh-ai-services', endpoint, payload) as RpcResult<T>
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    () => t('models.routeFailed'),
  ), [connection])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    void store.load()
    const onFocus = () => { void store.load() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      store.invalidate()
    }
  }, [store])
  return { store, snapshot }
}

const ROLE_OPTION_ORDER: readonly ModelRole[] = ['normal', 'weak', 'strong', 'fantasy']
const TIER_ROW_ORDER: readonly ModelRole[] = ['weak', 'normal', 'strong', 'fantasy']
const ROLE_LABELS_ZH: Record<ModelRole, string> = { weak: '快速', normal: '对话', strong: '思考', fantasy: '幻想' }
const ROLE_LABELS_EN: Record<ModelRole, string> = { weak: 'Quick', normal: 'Chat', strong: 'Thinking', fantasy: 'Fantasy' }

function roleOptions(zh: boolean): { role: ModelRole; label: string }[] {
  const labels = zh ? ROLE_LABELS_ZH : ROLE_LABELS_EN
  return ROLE_OPTION_ORDER.map((role) => ({ role, label: labels[role] }))
}

/**
 * One route row: the shared markup for purpose routes and tier bindings.
 * Select values are `role:<name>`, catalog `\u001f` route keys, or '' for the
 * row-specific fallback (follow chat/session/default).
 */
function RouteTargetRow(props: {
  label: string
  target: ModelTarget
  disabled: boolean
  catalog: CatalogModelOption[]
  emptyOption?: string
  roles?: readonly { role: ModelRole; label: string }[]
  modelAriaLabel: string
  effortAriaLabel: string
  zh: boolean
  dataTier?: ModelRole
  onSelect(value: string): void
  onEffort(effort: string | undefined): void
}) {
  const { target } = props
  const value = target.kind === 'model' ? routeKey(target) : target.kind === 'role' ? `role:${target.role}` : ''
  const options: SelectOption[] = [
    ...(props.emptyOption !== undefined ? [{ value: '', label: props.emptyOption }] : []),
    ...(props.roles ?? []).map((item) => ({ value: `role:${item.role}`, label: item.label })),
    ...props.catalog.map(item => ({ value: routeKey(item), label: item.label })),
  ]
  if (target.kind === 'model' && !options.some(item => item.value === value)) options.push(optionFor(target, props.catalog, ''))
  return <Flex className="settings-row models-writing-route" align="center" justify="between" gap="4" minWidth="0" py="2"
    {...(props.dataTier ? { 'data-tier': props.dataTier } : {})}>
    <Text size="2" weight="medium">{props.label}</Text>
    <Flex className="models-writing-route-controls" align="center" gap="2" minWidth="0">
      <Select value={value} options={options} disabled={props.disabled} aria-label={props.modelAriaLabel} onChange={props.onSelect} />
      {target.kind === 'model' ? <span className="model-effort"><Select value={target.reasoningEffort ?? ''} options={[{ value: '', label: props.zh ? '模型默认' : 'Model default' }, ...effortOptions(props.catalog.find(item => item.provider === target.provider && item.model === target.model), target.reasoningEffort)]}
        disabled={props.disabled} aria-label={props.effortAriaLabel}
        selectedLabel={target.reasoningEffort ? effortTriggerLabel(target.reasoningEffort) : (props.zh ? '模型默认' : 'Model default')} onChange={value => props.onEffort(value.trim() || undefined)} /></span> : null}
    </Flex>
  </Flex>
}

/** Purpose-targeted row: resolves the stored target, saves through the policy store. */
function PurposeRouteRow(props: {
  store: WritingPolicyStore
  snapshot: WritingPolicySnapshot
  purposeId: string
  label: string
  defaultTarget: ModelTarget
  emptyOption?: string
  disabled: boolean
  catalog: CatalogModelOption[]
  zh: boolean
}) {
  const { store } = props
  const target = props.snapshot.policy?.purposes[props.purposeId] ?? props.defaultTarget
  return <RouteTargetRow
    label={props.label}
    target={target}
    disabled={props.disabled}
    catalog={props.catalog}
    emptyOption={props.emptyOption}
    roles={roleOptions(props.zh)}
    modelAriaLabel={props.label}
    effortAriaLabel={`${props.label} · ${t('chat.reasoning')}`}
    zh={props.zh}
    onSelect={value => {
      const route = parseRouteKey(value)
      let next: ModelTarget
      if (value.startsWith('role:')) next = { kind: 'role', role: value.slice(5) as ModelRole }
      else if (route) {
        const effort = carriedReasoningEffort(target, route, props.catalog)
        next = effort ? { kind: 'model', ...route, reasoningEffort: effort } : { kind: 'model', ...route }
      }
      else next = { kind: 'session' }
      void store.save(props.purposeId, next)
    }}
    onEffort={effort => {
      if (target.kind !== 'model') return
      const { reasoningEffort: _old, ...route } = target
      void store.save(props.purposeId, effort ? { ...route, reasoningEffort: effort } : route)
    }} />
}

function PolicyFeedback(props: { store: WritingPolicyStore; snapshot: WritingPolicySnapshot }) {
  const { store, snapshot } = props
  return <>
    {!snapshot.policy && !snapshot.failure ? <ActivityText>
      {t('common.loading')}
    </ActivityText> : null}
    {snapshot.failure ? <Callout.Root color="red" role="alert">
      <Callout.Text>{snapshot.failure}</Callout.Text>
      <Button onClick={() => store.reload()}>
        {t('common.retry')}
      </Button>
    </Callout.Root> : null}
  </>
}

function SharedWritingRoutes(props: { connection: ConnectionHandle; catalog: CatalogModelOption[]; writable: boolean; chatOnly?: boolean }) {
  const locale = useLocale()
  const { store, snapshot } = useWritingPolicy(props.connection)
  const zh = locale !== 'en'
  return <>
    {WRITING_PURPOSES.filter(row => !props.chatOnly || row.id === 'chat').map(row => <PurposeRouteRow
      key={row.id}
      store={store}
      snapshot={snapshot}
      purposeId={row.id}
      label={t(row.label)}
      defaultTarget={{ kind: 'role', role: row.id === 'manuscript.completion' ? 'weak' : 'normal' }}
      emptyOption={row.id === 'chat' ? undefined : t('models.followChat')}
      disabled={!props.writable || !snapshot.policy || snapshot.saving || snapshot.storageFailed}
      catalog={props.catalog}
      zh={zh} />)}
    <PolicyFeedback store={store} snapshot={snapshot} />
  </>
}

/**
 * Tier binding edit: `undefined` unbinds the tier back to its fallback; a new
 * route keeps the stored effort only when the destination advertises it.
 */
export function tierRolesUpdate(
  roles: AiPolicy['roles'],
  role: ModelRole,
  route: WritingModelRoute | undefined,
  catalog: readonly CatalogModelOption[],
): AiPolicy['roles'] {
  const next: AiPolicy['roles'] = { ...roles }
  if (!route) {
    delete next[role]
    return next
  }
  const bound = roles[role]
  const previous: ModelTarget = bound
    ? { kind: 'model', provider: bound.provider, model: bound.model, ...(bound.reasoningEffort ? { reasoningEffort: bound.reasoningEffort } : {}) }
    : { kind: 'role', role }
  const effort = carriedReasoningEffort(previous, route, catalog)
  next[role] = effort
    ? { provider: route.provider, model: route.model, reasoningEffort: effort }
    : { provider: route.provider, model: route.model }
  return next
}

function ModelTiers(props: {
  store: WritingPolicyStore
  snapshot: WritingPolicySnapshot
  catalog: CatalogModelOption[]
  disabled: boolean
  zh: boolean
}) {
  const { store, snapshot } = props
  const policy = snapshot.policy
  const labels = props.zh ? ROLE_LABELS_ZH : ROLE_LABELS_EN
  return <section className="editor-model-tiers" aria-label={props.zh ? '模型档位' : 'Model tiers'}>
    <Heading as="h3" size="2">{props.zh ? '模型档位' : 'Model tiers'}</Heading>
    <Text as="p" size="1" color="gray">
      {props.zh
        ? '档位是各用途可跟随的模型预设；不绑定的档位跟随默认。'
        : 'Tiers are model presets purposes can follow; an unbound tier falls back to the default.'}
    </Text>
    {TIER_ROW_ORDER.map(role => {
      const bound = policy?.roles[role]
      const target: ModelTarget = bound
        ? { kind: 'model', provider: bound.provider, model: bound.model, ...(bound.reasoningEffort ? { reasoningEffort: bound.reasoningEffort } : {}) }
        : { kind: 'session' }
      const name = labels[role]
      return <RouteTargetRow
        key={role}
        dataTier={role}
        label={name}
        target={target}
        disabled={props.disabled}
        catalog={props.catalog}
        emptyOption={role === 'normal'
          ? (props.zh ? '使用默认模型' : 'Use the default model')
          : (props.zh ? '跟随对话档' : 'Follow the Chat tier')}
        modelAriaLabel={props.zh ? `${name} 模型` : `${name} model`}
        effortAriaLabel={props.zh ? `${name} 思考强度` : `${name} reasoning effort`}
        zh={props.zh}
        onSelect={value => {
          if (!policy) return
          void store.saveRoles(tierRolesUpdate(policy.roles, role, parseRouteKey(value), props.catalog))
        }}
        onEffort={effort => {
          if (!policy || !bound) return
          const roles: AiPolicy['roles'] = { ...policy.roles }
          roles[role] = effort
            ? { provider: bound.provider, model: bound.model, reasoningEffort: effort }
            : { provider: bound.provider, model: bound.model }
          void store.saveRoles(roles)
        }} />
    })}
  </section>
}

/** Runtime bounds mirror the backend policy parser; the backend stays the authority on rejection. */
export const POLICY_LIMIT_FIELDS = [
  { key: 'concurrency', min: 1, max: 8, zh: '并发数', en: 'Concurrency' },
  { key: 'timeoutMs', min: 1000, max: 300000, zh: '超时（毫秒）', en: 'Timeout (ms)' },
  { key: 'maxInputChars', min: 1, max: 200000, zh: '最大输入字符', en: 'Max input characters' },
  { key: 'maxOutputTokens', min: 1, max: 8192, zh: '最大输出 tokens', en: 'Max output tokens' },
  { key: 'maxAttempts', min: 1, max: 5, zh: '尝试次数（仅辅助调用）', en: 'Attempts (auxiliary calls only)' },
] as const

export type PolicyLimitKey = (typeof POLICY_LIMIT_FIELDS)[number]['key']

export function parseLimitsDraft(values: Record<PolicyLimitKey, string>): { ok: true; limits: AiPolicy['limits'] } | { ok: false; field: PolicyLimitKey } {
  const limits = {} as Record<PolicyLimitKey, number>
  for (const field of POLICY_LIMIT_FIELDS) {
    const raw = (values[field.key] ?? '').trim()
    const value = Number(raw)
    if (raw === '' || !Number.isInteger(value) || value < field.min || value > field.max) return { ok: false, field: field.key }
    limits[field.key] = value
  }
  return { ok: true, limits: limits as AiPolicy['limits'] }
}

function limitsDraftOf(limits: AiPolicy['limits'] | undefined): Record<PolicyLimitKey, string> {
  const draft = {} as Record<PolicyLimitKey, string>
  for (const field of POLICY_LIMIT_FIELDS) draft[field.key] = limits ? String(limits[field.key]) : ''
  return draft
}

function RuntimeLimits(props: {
  store: WritingPolicyStore
  snapshot: WritingPolicySnapshot
  writable: boolean
  zh: boolean
}) {
  const { store, snapshot } = props
  const policy = snapshot.policy
  const limits = policy?.limits
  const [owner, setOwner] = useState(store)
  const ownerRef = useRef(store)
  ownerRef.current = store
  const [draft, setDraft] = useState<Record<PolicyLimitKey, string>>(() => limitsDraftOf(limits))
  const [dirty, setDirty] = useState(false)
  const [base, setBase] = useState<AiPolicy['limits'] | undefined>(limits)
  // A connection swap must discard drafts before the new host can receive a save.
  if (owner !== store) {
    setOwner(store)
    setDraft(limitsDraftOf(limits))
    setBase(limits)
    setDirty(false)
  }
  /* External refreshes (focus, resync) only replace an untouched draft. */
  useEffect(() => { if (!dirty) { setDraft(limitsDraftOf(limits)); setBase(limits) } }, [limits, dirty])
  const parsed = parseLimitsDraft(draft)
  const invalid = !parsed.ok ? POLICY_LIMIT_FIELDS.find(field => field.key === parsed.field) : undefined
  const busy = snapshot.saving || !policy || snapshot.storageFailed
  return <section className="editor-model-runtime" data-testid="editor-model-runtime" aria-label={props.zh ? '限额与超时' : 'Limits and timeouts'}>
    <Heading as="h3" size="2">{props.zh ? '限额与超时' : 'Limits and timeouts'}</Heading>
    <Text as="p" size="1" color="gray">
      {props.zh
        ? '写作与插件按供应商分别计算并发额度；补全与改写只尝试一次。'
        : 'These bounds govern background model calls from writing assistants and plugins; direct writing requests such as inline completion and selection rewrite always run as a single attempt.'}
    </Text>
    {POLICY_LIMIT_FIELDS.map(field => <Flex key={field.key} className="settings-row models-writing-route" align="center" justify="between" gap="4" minWidth="0" py="2">
      <Text size="2" weight="medium">{props.zh ? field.zh : field.en}</Text>
      <Flex className="models-writing-route-controls" align="center" gap="2" minWidth="0">
        <TextField.Root
          type="number"
          min={field.min}
          max={field.max}
          step={1}
          value={draft[field.key]}
          aria-label={props.zh ? field.zh : field.en}
          aria-invalid={invalid?.key === field.key}
          disabled={!props.writable || busy}
          onChange={(event: { target: { value: string } }) => {
            setDirty(true)
            setDraft(current => ({ ...current, [field.key]: event.target.value }))
          }} />
      </Flex>
    </Flex>)}
    {dirty && invalid ? <Callout.Root color="red" role="alert">
      <Callout.Text>
        {props.zh ? `需为 ${invalid.min}–${invalid.max} 的整数` : `Enter an integer from ${invalid.min} to ${invalid.max}`}
      </Callout.Text>
    </Callout.Root> : null}
    {dirty && snapshot.failure ? <Flex gap="2" wrap="wrap">
      <Button disabled={busy} onClick={() => { setDirty(false); store.reload() }}>{props.zh ? '使用最新设置' : 'Use latest settings'}</Button>
      <Button disabled={busy} onClick={() => {
        if (!limits || !base) return
        const latest = limitsDraftOf(limits)
        for (const field of POLICY_LIMIT_FIELDS) if (draft[field.key] !== String(base[field.key])) latest[field.key] = draft[field.key]
        setDraft(latest)
        setBase(limits)
      }}>{props.zh ? '保留草稿' : 'Keep draft'}</Button>
    </Flex> : null}
    <Flex gap="2" justify="end">
      <Button
        variant="primary"
        disabled={!props.writable || busy || !dirty || !parsed.ok}
        onClick={() => {
          if (!parsed.ok) return
          void store.saveLimits(parsed.limits, base).then(saved => { if (saved && ownerRef.current === store) setDirty(false) })
        }}>
        {snapshot.saving ? t('common.saving') : t('common.save')}
      </Button>
    </Flex>
  </section>
}

/**
 * The permanent Editor-owned model settings: fixed chat/completion/rewrite
 * routes, the four tier bindings, and the shared runtime bounds. Rendered
 * regardless of any plugin contribution; one policy store per surface.
 */
export function EditorModelSettings(props: {
  connection: ConnectionHandle
  catalog: CatalogModelOption[]
  writable: boolean
}): ReactNode {
  const { store, snapshot } = useWritingPolicy(props.connection)
  return <EditorModelSettingsView store={store} snapshot={snapshot} catalog={props.catalog} writable={props.writable} />
}

export function EditorModelSettingsView(props: {
  store: WritingPolicyStore
  snapshot: WritingPolicySnapshot
  catalog: CatalogModelOption[]
  writable: boolean
}): ReactNode {
  const locale = useLocale()
  const zh = locale !== 'en'
  const { store, snapshot } = props
  const disabled = !props.writable || !snapshot.policy || snapshot.saving || snapshot.storageFailed
  return <section className="editor-model-settings" data-testid="editor-model-settings" aria-label={zh ? '模型设置' : 'Model settings'}>
    {WRITING_PURPOSES.map(row => <PurposeRouteRow
      key={row.id}
      store={store}
      snapshot={snapshot}
      purposeId={row.id}
      label={t(row.label)}
      defaultTarget={{ kind: 'role', role: row.id === 'manuscript.completion' ? 'weak' : 'normal' }}
      emptyOption={row.id === 'chat' ? undefined : t('models.followChat')}
      disabled={disabled}
      catalog={props.catalog}
      zh={zh} />)}
    <ModelTiers store={store} snapshot={snapshot} catalog={props.catalog} disabled={disabled} zh={zh} />
    <RuntimeLimits store={store} snapshot={snapshot} writable={props.writable} zh={zh} />
    <PolicyFeedback store={store} snapshot={snapshot} />
  </section>
}

/** Built-in routes the permanent page owns; plugin purposes never duplicate them. */
export const PLUGIN_ROUTE_EXCLUSIONS: readonly string[] = ['chat', 'manuscript.completion', 'manuscript.rewrite']

export function pluginPurposeRows(purposes: readonly RegisteredPurpose[], exclusions: readonly string[] = PLUGIN_ROUTE_EXCLUSIONS): RegisteredPurpose[] {
  return purposes.filter(spec => !exclusions.includes(spec.id))
}

/**
 * The plugin page's model routes: only purposes registered by plugins through
 * ai-services, never the built-in chat/manuscript routes, tiers, providers,
 * or runtime bounds (those stay on the permanent Editor page).
 */
export function PluginModelRoutes(props: {
  connection: ConnectionHandle
  catalog: CatalogModelOption[]
  writable: boolean
}): ReactNode {
  const { store, snapshot } = useWritingPolicy(props.connection)
  return <PluginModelRoutesView store={store} snapshot={snapshot} catalog={props.catalog} writable={props.writable} />
}

export function PluginModelRoutesView(props: {
  store: WritingPolicyStore
  snapshot: WritingPolicySnapshot
  catalog: CatalogModelOption[]
  writable: boolean
}): ReactNode {
  const locale = useLocale()
  const zh = locale !== 'en'
  const { store, snapshot } = props
  const rows = pluginPurposeRows(snapshot.purposes)
  return <section className="plugin-model-settings" data-testid="plugin-model-settings" aria-label={zh ? '插件模型' : 'Plugin models'}>
    <Heading as="h3" size="2">{zh ? '插件模型' : 'Plugin models'}</Heading>
    <Text as="p" size="1" color="gray">
      {zh
        ? '插件注册的模型用途；可跟随档位、指定模型，或跟随当前会话。'
        : 'Model purposes registered by plugins: follow a tier, pin a model, or follow the current session.'}
    </Text>
    {rows.map(spec => {
      const label = spec.label || spec.id
      return <PurposeRouteRow
        key={spec.id}
        store={store}
        snapshot={snapshot}
        purposeId={spec.id}
        label={label}
        defaultTarget={spec.defaultTarget}
        emptyOption={zh ? '跟随当前会话' : 'Follow the current session'}
        disabled={!props.writable || !snapshot.policy || snapshot.saving || snapshot.storageFailed}
        catalog={props.catalog}
        zh={zh} />
    })}
    {snapshot.policy && rows.length === 0 ? <Text size="1" color="gray">
      {zh ? '暂无插件注册的模型用途。' : 'No plugin-registered model purposes.'}
    </Text> : null}
    <PolicyFeedback store={store} snapshot={snapshot} />
  </section>
}
