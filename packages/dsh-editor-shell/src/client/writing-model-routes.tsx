import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Box, Callout, Flex, Text } from '@radix-ui/themes'
import type { AiPolicy, ModelTarget, RpcResult } from '@klarkxy/dsh-ai-services/contracts'
import type { ConnectionHandle, SettingsScope } from '../dsh-compat.ts'
import {
  normalizeWritingEffort,
  normalizeWritingModelRoute,
  writingModelRouteValue,
  writingPreferences,
  type WritingModelRoute,
  type WritingPreferences,
} from '../writing-settings.tsx'
import { Select, type SelectOption } from './select.tsx'
import { effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'
import { STANDARD_REASONING_EFFORTS } from './settings-models-store.ts'
import { ActivityDots, ActivitySkeleton } from './ui/index.ts'
import { t, useLocale } from '../i18n/index.ts'

function effortOptions(): SelectOption[] {
  return Object.keys(STANDARD_REASONING_EFFORTS).map((id) => ({ value: id, label: effortDisplay(id) }))
}

export type CatalogModelOption = {
  provider: string
  model: string
  label: string
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

export function catalogFromSessionGroups(groups: ReadonlyArray<{ id: string; name: string; models: ReadonlyArray<{ id: string; name: string }> }>): CatalogModelOption[] {
  return groups.flatMap((group) => group.models.map((model) => ({
    provider: group.id,
    model: model.id,
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

const EMPTY = ''

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
  useLocale()
  const snapshot = useSyncExternalStore(
    props.scope.subscribe.bind(props.scope),
    props.scope.getSnapshot.bind(props.scope),
    props.scope.getSnapshot.bind(props.scope),
  )
  const values = writingPreferences(snapshot)
  const writable = props.writable && snapshot.status === 'ready' && snapshot.writable !== false
  const [saving, setSaving] = useState<keyof WritingPreferences | null>(null)
  const [failure, setFailure] = useState('')

  const save = async (field: 'chatModel', route: WritingModelRoute | undefined) => {
    setSaving(field)
    setFailure('')
    try {
      await props.scope.set(field, writingModelRouteValue(route))
      const committed = props.scope.getSnapshot()
      const user = committed.user && typeof committed.user === 'object' ? committed.user as Record<string, unknown> : undefined
      if (!user || !Object.prototype.hasOwnProperty.call(user, field)) throw new Error('write did not commit')
    } catch {
      setFailure(t('models.routeFailed'))
    } finally {
      setSaving(null)
    }
  }

  const updateModel = (field: 'chatModel', value: string) => {
    const parsed = parseRouteKey(value)
    const current = values[field]
    void save(field, parsed ? { ...parsed, reasoningEffort: current?.reasoningEffort } : undefined)
  }

  const updateEffort = (field: 'chatModel', value: string) => {
    const current = values[field]
    if (!current) return
    const reasoningEffort = normalizeWritingEffort(value)
    void save(field, reasoningEffort ? { ...current, reasoningEffort } : { provider: current.provider, model: current.model })
  }

  const rows: Array<{ field: 'chatModel'; label: 'models.chatModel'; empty?: string }> = [
    { field: 'chatModel', label: 'models.chatModel' },
  ]

  if (snapshot.status === 'loading') {
    return (
      <section className="models-writing-routes" aria-label={t('models.writingRoutes')}>
        <Box className="models-status" role="status" aria-live="polite">
          <ActivitySkeleton lines={3} />
          <span className="sr-only">
            {t('writing.loading')}
          </span>
        </Box>
      </section>
    );
  }
  if (snapshot.status === 'unavailable') {
    return (
      <section className="models-writing-routes" aria-label={t('models.writingRoutes')}>
        <Callout.Root color="red" role="alert" className="models-error">
          <Callout.Text>
            {t('writing.unavailable')}
          </Callout.Text>
        </Callout.Root>
      </section>
    );
  }

  return (
    <section className="models-writing-routes" aria-label={t('models.writingRoutes')}>
      {rows.map((row) => {
        const selected = values[row.field]
        const missing = Boolean(selected && !props.catalog.some((item) => item.provider === selected.provider && item.model === selected.model))
        const options: SelectOption[] = [
          ...(row.empty ? [{ value: EMPTY, label: row.empty }] : []),
          ...props.catalog.map((item) => ({ value: routeKey(item), label: item.label })),
        ]
        if (selected && !options.some((item) => item.value === routeKey(selected))) {
          options.push(optionFor(selected, props.catalog, row.empty ?? t(row.label)))
        }
        return (
          <Flex key={row.field} className="settings-row models-writing-route" align="center" justify="between" gap="4" minWidth="0" py="2">
            <Flex direction="column" className="settings-row-text" gap="1" minWidth="0">
              <Text size="2" weight="medium" className="settings-row-title">
                {t(row.label)}
              </Text>
              {missing ? <Text size="1" color="red" className="models-warning" role="status">
                {t('models.missingModelHint')}
              </Text> : null}
            </Flex>
            <Flex className="models-writing-route-controls" align="center" gap="2" minWidth="0">
              <Select
                value={selected ? routeKey(selected) : EMPTY}
                options={options}
                disabled={!writable || saving !== null}
                aria-label={t(row.label)}
                onChange={(value) => { void updateModel(row.field, value) }} />
              {selected ? <span className="model-effort">
                <Select
                  value={selected.reasoningEffort && effortOptions().some((item) => item.value === selected.reasoningEffort) ? selected.reasoningEffort : 'off'}
                  options={effortOptions()}
                  placeholder="none"
                  selectedLabel={effortTriggerLabel(selected.reasoningEffort ?? 'off')}
                  disabled={!writable || saving !== null}
                  aria-label={`${t(row.label)} · ${t('chat.reasoning')}`}
                  title={effortTriggerLabel(selected.reasoningEffort ?? 'off')}
                  align="end"
                  onChange={(value) => { void updateEffort(row.field, value) }} />
              </span> : null}
            </Flex>
            <span
              className="route-saving"
              role={saving === row.field ? 'status' : undefined}
              aria-hidden={saving === row.field ? undefined : 'true'}>
              {saving === row.field ? <ActivityDots /> : null}
              {saving === row.field ? <span className="sr-only">
                {t('common.saving')}
              </span> : null}
            </span>
          </Flex>
        );
      })}
      {props.showSharedPurposes === false ? null
        : <SharedWritingRoutes connection={props.connection} catalog={props.catalog} writable={props.writable} />}
      {failure ? <Callout.Root color="red" role="alert" className="models-warning">
        <Callout.Text>
          {failure}
        </Callout.Text>
      </Callout.Root> : null}
    </section>
  );
}


export const WRITING_PURPOSES = [
  { id: 'manuscript.completion', label: 'models.completionModel' },
  { id: 'manuscript.rewrite', label: 'models.rewriteModel' },
] as const

export function writingPurposeUpdate(policy: AiPolicy, purpose: string, target: ModelTarget) {
  const { revision, ...data } = policy
  return { expectedRevision: revision, policy: { ...data, purposes: { ...data.purposes, [purpose]: target } } }
}

function SharedWritingRoutes(props: { connection: ConnectionHandle; catalog: CatalogModelOption[]; writable: boolean }) {
  const locale = useLocale()
  const [policy, setPolicy] = useState<AiPolicy>()
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const generation = useRef(0)
  const pending = useRef(false)
  const rpc = async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    const result = await props.connection.rpc.call('/dsh-ai-services', endpoint, payload) as RpcResult<T>
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  useEffect(() => {
    let live = true
    const refresh = async () => {
      if (pending.current) return
      const token = ++generation.current
      try {
        const status = await rpc<{ policy: AiPolicy }>('status', {})
        if (live && token === generation.current) { setPolicy(status.policy); setFailure('') }
      } catch (error) {
        if (live && token === generation.current) { setPolicy(undefined); setFailure(error instanceof Error ? error.message : t('models.routeFailed')) }
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => { live = false; generation.current++; window.removeEventListener('focus', refresh) }
  }, [props.connection])
  const save = async (purpose: string, target: ModelTarget) => {
    if (!policy || pending.current) return
    pending.current = true
    const token = ++generation.current
    setSaving(true); setFailure('')
    try {
      const next = await rpc<AiPolicy>('update', writingPurposeUpdate(policy, purpose, target))
      if (token === generation.current) setPolicy(next)
    } catch (error) {
      if (token === generation.current) {
        setFailure(error instanceof Error ? error.message : t('models.routeFailed'))
        try { const status = await rpc<{ policy: AiPolicy }>('status', {}); if (token === generation.current) setPolicy(status.policy) } catch { if (token === generation.current) setPolicy(undefined) }
      }
    } finally {
      pending.current = false
      if (token === generation.current) setSaving(false)
    }
  }
  const zh = locale !== 'en'
  return <>
    {WRITING_PURPOSES.map(row => {
      const target = policy?.purposes[row.id] ?? { kind: 'session' as const }
      const value = target.kind === 'model' ? routeKey(target) : target.kind === 'role' ? 'role:' + target.role : ''
      const options: SelectOption[] = [
        { value: '', label: t('models.followChat') },
        { value: 'role:normal', label: zh ? '普通模型' : 'Normal model' },
        { value: 'role:weak', label: zh ? '弱模型' : 'Weak model' },
        { value: 'role:strong', label: zh ? '强模型' : 'Strong model' },
        ...props.catalog.map(item => ({ value: routeKey(item), label: item.label })),
      ]
      if (target.kind === 'model' && !options.some(item => item.value === value)) options.push(optionFor(target, props.catalog, ''))
      return <Flex key={row.id} className="settings-row models-writing-route" align="center" justify="between" gap="4" minWidth="0" py="2">
        <Text size="2" weight="medium">{t(row.label)}</Text>
        <Flex className="models-writing-route-controls" align="center" gap="2" minWidth="0">
          <Select value={value} options={options} disabled={!props.writable || !policy || saving} aria-label={t(row.label)} onChange={value => {
            const route = parseRouteKey(value)
            const next: ModelTarget = value.startsWith('role:') ? { kind: 'role', role: value.slice(5) as 'normal' | 'weak' | 'strong' }
              : route ? { kind: 'model', ...route, ...(target.kind === 'model' && target.reasoningEffort ? { reasoningEffort: target.reasoningEffort } : {}) } : { kind: 'session' }
            void save(row.id, next)
          }} />
          {target.kind === 'model' ? <span className="model-effort"><Select value={target.reasoningEffort ?? 'off'} options={effortOptions()}
            disabled={!props.writable || !policy || saving} aria-label={t(row.label) + ' · ' + t('chat.reasoning')}
            selectedLabel={effortTriggerLabel(target.reasoningEffort ?? 'off')} onChange={value => {
              const { reasoningEffort: _old, ...route } = target
              const effort = normalizeWritingEffort(value)
              void save(row.id, effort && effort !== 'off' ? { ...route, reasoningEffort: effort } : route)
            }} /></span> : null}
        </Flex>
      </Flex>
    })}
    {!policy && !failure ? <ActivityDots /> : null}
    {failure ? <Callout.Root color="red" role="alert"><Callout.Text>{failure}</Callout.Text></Callout.Root> : null}
  </>
}
