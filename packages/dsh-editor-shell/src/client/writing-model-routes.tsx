import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Callout, Flex, Text, Button } from '@radix-ui/themes'
import type { AiPolicy, ModelTarget, RpcResult } from '@klarkxy/dsh-ai-services/contracts'
import type { ConnectionHandle, SettingsScope } from '../dsh-compat.ts'
import {
  normalizeWritingModelRoute,
  type WritingModelRoute,
  type WritingPreferences,
} from '../writing-settings.tsx'
import { Select, type SelectOption } from './select.tsx'
import { effortDisplay, effortTriggerLabel } from './chat-model-picker.tsx'
import { ActivityText } from './ui/index.ts'
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

function SharedWritingRoutes(props: { connection: ConnectionHandle; catalog: CatalogModelOption[]; writable: boolean; chatOnly?: boolean }) {
  const locale = useLocale()
  const [policy, setPolicy] = useState<AiPolicy>()
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
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
  }, [props.connection, reloadToken])
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
    {WRITING_PURPOSES.filter(row => !props.chatOnly || row.id === 'chat').map(row => {
      const target = policy?.purposes[row.id] ?? { kind: 'role' as const, role: row.id === 'manuscript.completion' ? 'weak' as const : 'normal' as const }
      const value = target.kind === 'model' ? routeKey(target) : target.kind === 'role' ? 'role:' + target.role : ''
      const options: SelectOption[] = [
        ...(row.id === 'chat' ? [] : [{ value: '', label: t('models.followChat') }]),
        { value: 'role:normal', label: zh ? '对话' : 'Chat' },
        { value: 'role:weak', label: zh ? '快速' : 'Quick' },
        { value: 'role:strong', label: zh ? '思考' : 'Thinking' },
        { value: 'role:fantasy', label: zh ? '幻想' : 'Fantasy' },
        ...props.catalog.map(item => ({ value: routeKey(item), label: item.label })),
      ]
      if (target.kind === 'model' && !options.some(item => item.value === value)) options.push(optionFor(target, props.catalog, ''))
      return <Flex key={row.id} className="settings-row models-writing-route" align="center" justify="between" gap="4" minWidth="0" py="2">
        <Text size="2" weight="medium">{t(row.label)}</Text>
        <Flex className="models-writing-route-controls" align="center" gap="2" minWidth="0">
          <Select value={value} options={options} disabled={!props.writable || !policy || saving} aria-label={t(row.label)} onChange={value => {
            const route = parseRouteKey(value)
            const next: ModelTarget = value.startsWith('role:') ? { kind: 'role', role: value.slice(5) as 'normal' | 'weak' | 'strong' | 'fantasy' }
              : route ? { kind: 'model', ...route, ...(target.kind === 'model' && target.reasoningEffort ? { reasoningEffort: target.reasoningEffort } : {}) } : { kind: 'session' }
            void save(row.id, next)
          }} />
          {target.kind === 'model' ? <span className="model-effort"><Select value={target.reasoningEffort ?? ''} options={[{ value: '', label: zh ? '模型默认' : 'Model default' }, ...effortOptions(props.catalog.find(item => item.provider === target.provider && item.model === target.model), target.reasoningEffort)]}
            disabled={!props.writable || !policy || saving} aria-label={t(row.label) + ' · ' + t('chat.reasoning')}
            selectedLabel={target.reasoningEffort ? effortTriggerLabel(target.reasoningEffort) : (zh ? '模型默认' : 'Model default')} onChange={value => {
              const { reasoningEffort: _old, ...route } = target
              const effort = value.trim() || undefined
              void save(row.id, effort ? { ...route, reasoningEffort: effort } : route)
            }} /></span> : null}
        </Flex>
      </Flex>
    })}
    {!policy && !failure ? <ActivityText>
      {t('common.loading')}
    </ActivityText> : null}
    {failure ? <Callout.Root color="red" role="alert">
      <Callout.Text>{failure}</Callout.Text>
      <Button onClick={() => { setFailure(''); setReloadToken((n) => n + 1) }}>
        {t('common.retry')}
      </Button>
    </Callout.Root> : null}
  </>
}
